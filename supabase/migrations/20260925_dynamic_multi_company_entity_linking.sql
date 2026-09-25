-- Migration: 20260925_dynamic_multi_company_entity_linking.sql
-- Description: Entity-First Multi-Company Architecture
-- Links public.profiles to public.entities via primary_entity_id,
-- backfills existing company_name values to public.entities,
-- sets up bidirectional synchronization triggers, and provides RPCs.

-- ============================================================================
-- 1. ADD PRIMARY_ENTITY_ID TO PUBLIC.PROFILES
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_primary_entity ON public.profiles(primary_entity_id);

-- ============================================================================
-- 2. BACKFILL: MIGRATE EXISTING COMPANY_NAME VALUES INTO PUBLIC.ENTITIES
-- ============================================================================
DO $$
DECLARE
  r RECORD;
  v_entity_id UUID;
  v_comp_name TEXT;
BEGIN
  FOR r IN 
    SELECT id, company_name 
    FROM public.profiles 
    WHERE company_name IS NOT NULL AND TRIM(company_name) != ''
  LOOP
    v_comp_name := TRIM(r.company_name);
    
    -- Check if an entity already exists for this user with this exact name
    SELECT id INTO v_entity_id
    FROM public.entities
    WHERE user_id = r.id AND LOWER(TRIM(name)) = LOWER(v_comp_name)
    LIMIT 1;

    -- If no entity exists, create one
    IF v_entity_id IS NULL THEN
      INSERT INTO public.entities (
        user_id,
        name,
        entity_type,
        formation_state,
        notes,
        created_at,
        updated_at
      ) VALUES (
        r.id,
        v_comp_name,
        'llc',
        NULL,
        'Auto-migrated primary company from profile',
        now(),
        now()
      )
      RETURNING id INTO v_entity_id;
    END IF;

    -- Link profile to this primary entity
    UPDATE public.profiles
    SET primary_entity_id = v_entity_id
    WHERE id = r.id AND (primary_entity_id IS NULL OR primary_entity_id != v_entity_id);
  END LOOP;
END $$;

-- ============================================================================
-- 3. BIDIRECTIONAL SYNCHRONIZATION TRIGGERS
-- ============================================================================

-- Function 3A: When profiles.primary_entity_id is set/changed, update profiles.company_name
CREATE OR REPLACE FUNCTION public.sync_profile_from_primary_entity()
RETURNS TRIGGER AS $$
DECLARE
  v_entity_name TEXT;
BEGIN
  IF NEW.primary_entity_id IS NOT NULL THEN
    SELECT name INTO v_entity_name
    FROM public.entities
    WHERE id = NEW.primary_entity_id;

    IF v_entity_name IS NOT NULL THEN
      NEW.company_name := v_entity_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_profile_from_primary_entity ON public.profiles;
CREATE TRIGGER trg_sync_profile_from_primary_entity
BEFORE INSERT OR UPDATE OF primary_entity_id
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_from_primary_entity();

-- Function 3B: When an entity name is renamed, update corresponding profiles.company_name
CREATE OR REPLACE FUNCTION public.sync_profile_on_entity_rename()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.profiles
    SET company_name = NEW.name
    WHERE primary_entity_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_profile_on_entity_rename ON public.entities;
CREATE TRIGGER trg_sync_profile_on_entity_rename
AFTER UPDATE OF name
ON public.entities
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_on_entity_rename();

-- ============================================================================
-- 4. RPC: GET INVESTOR PROFILE WITH ALL ASSOCIATED COMPANIES
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_get_user_profile_with_companies()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_companies JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- 1. Fetch Profile
  SELECT 
    p.id,
    p.email,
    p.full_name,
    p.company_name,
    p.primary_entity_id,
    p.discount_rate,
    p.exit_year,
    p.exit_cap_timing,
    p.market_tier,
    p.property_class,
    p.notification_email,
    p.alert_preferences,
    p.preferences
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_user_id;

  -- 2. Fetch all entities belonging to this user
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'name', e.name,
        'entity_type', COALESCE(e.entity_type, 'llc'),
        'formation_state', e.formation_state,
        'notes', e.notes,
        'is_primary', (e.id = v_profile.primary_entity_id),
        'deals_count', COUNT(d.id),
        'created_at', e.created_at,
        'updated_at', e.updated_at
      ) ORDER BY (e.id = v_profile.primary_entity_id) DESC, e.name ASC
    ),
    '[]'::jsonb
  ) INTO v_companies
  FROM public.entities e
  LEFT JOIN public.deals d ON d.entity_id = e.id AND d.user_id = v_user_id
  WHERE e.user_id = v_user_id
  GROUP BY e.id, e.name, e.entity_type, e.formation_state, e.notes, e.created_at, e.updated_at;

  -- 3. Return Combined Payload
  RETURN jsonb_build_object(
    'id', v_profile.id,
    'email', v_profile.email,
    'fullName', COALESCE(v_profile.full_name, 'Investor'),
    'companyName', COALESCE(v_profile.company_name, 'MathTree Capital'),
    'primaryEntityId', v_profile.primary_entity_id,
    'discountRate', COALESCE(v_profile.discount_rate, 8.0),
    'exitYear', COALESCE(v_profile.exit_year, 10),
    'exitCapTiming', COALESCE(v_profile.exit_cap_timing, 'amortized'),
    'marketTier', COALESCE(v_profile.market_tier, 'Tier 2'),
    'propertyClass', COALESCE(v_profile.property_class, 'Class B'),
    'notification_email', v_profile.notification_email,
    'alert_preferences', v_profile.alert_preferences,
    'associatedCompanies', v_companies
  );
END;
$$;
