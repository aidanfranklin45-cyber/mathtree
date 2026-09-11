-- Migration: 20260912_parcels_and_packages.sql
-- Description: Create public.parcels relational table, view_deal_parcel_packages view, and backfill from JSONB.

-- 1. Create parcels table
CREATE TABLE IF NOT EXISTS public.parcels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  apn TEXT NOT NULL,
  formatted_apn TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  included BOOLEAN NOT NULL DEFAULT true,
  situs_address TEXT,
  legal_description TEXT,
  use_code TEXT,
  zoning TEXT,
  acres NUMERIC(10, 4) NOT NULL DEFAULT 0,
  sqft NUMERIC(12, 2) GENERATED ALWAYS AS (acres * 43560) STORED,
  market_land_val NUMERIC(14, 2) NOT NULL DEFAULT 0,
  market_imp_val NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_assessed_val NUMERIC(14, 2) GENERATED ALWAYS AS (market_land_val + market_imp_val) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_deal_apn UNIQUE (deal_id, apn)
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_parcels_deal_id ON public.parcels(deal_id);
CREATE INDEX IF NOT EXISTS idx_parcels_user_id ON public.parcels(user_id);
CREATE INDEX IF NOT EXISTS idx_parcels_apn ON public.parcels(apn);

-- 3. Grants
GRANT ALL ON TABLE public.parcels TO authenticated;
GRANT ALL ON TABLE public.parcels TO service_role;
REVOKE ALL ON TABLE public.parcels FROM anon;

-- 4. Enable RLS
ALTER TABLE public.parcels ENABLE ROW LEVEL SECURITY;

-- 5. Multi-Tenant RLS Policies
DROP POLICY IF EXISTS "Users can view own or demo parcels" ON public.parcels;
CREATE POLICY "Users can view own or demo parcels" ON public.parcels 
FOR SELECT TO authenticated 
USING (
  auth.uid() = user_id 
  OR deal_id IN (SELECT id FROM public.deals WHERE is_demo = true)
);

DROP POLICY IF EXISTS "Users can insert own parcels" ON public.parcels;
CREATE POLICY "Users can insert own parcels" ON public.parcels 
FOR INSERT TO authenticated 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own parcels" ON public.parcels;
CREATE POLICY "Users can update own parcels" ON public.parcels 
FOR UPDATE TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own parcels" ON public.parcels;
CREATE POLICY "Users can delete own parcels" ON public.parcels 
FOR DELETE TO authenticated 
USING (auth.uid() = user_id);

-- 6. Create Aggregation View: view_deal_parcel_packages
CREATE OR REPLACE VIEW public.view_deal_parcel_packages AS
SELECT 
  d.id AS deal_id,
  d.user_id,
  d.title AS deal_title,
  COUNT(p.id)::int AS total_parcels,
  COUNT(p.id) FILTER (WHERE NOT p.is_primary AND p.included)::int AS adjacent_parcel_count,
  COALESCE(SUM(p.acres) FILTER (WHERE p.included), 0)::numeric(10, 4) AS total_package_acres,
  COALESCE(SUM(p.sqft) FILTER (WHERE p.included), 0)::numeric(12, 2) AS total_package_sqft,
  COALESCE(SUM(p.market_land_val) FILTER (WHERE p.included), 0)::numeric(14, 2) AS total_land_value,
  COALESCE(SUM(p.market_imp_val) FILTER (WHERE p.included), 0)::numeric(14, 2) AS total_improvement_value,
  COALESCE(SUM(p.total_assessed_val) FILTER (WHERE p.included), 0)::numeric(14, 2) AS combined_assessed_value,
  (
    SELECT jsonb_build_object(
      'apn', prim.apn,
      'formatted_apn', prim.formatted_apn,
      'situs_address', prim.situs_address,
      'acres', prim.acres,
      'sqft', prim.sqft,
      'total_assessed_val', prim.total_assessed_val,
      'market_land_val', prim.market_land_val,
      'market_imp_val', prim.market_imp_val,
      'legal_description', prim.legal_description,
      'use_code', prim.use_code,
      'zoning', prim.zoning
    )
    FROM public.parcels prim
    WHERE prim.deal_id = d.id AND prim.is_primary = true
    LIMIT 1
  ) AS primary_parcel,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'apn', p.apn,
        'formatted_apn', p.formatted_apn,
        'is_primary', p.is_primary,
        'included', p.included,
        'situs_address', p.situs_address,
        'legal_description', p.legal_description,
        'use_code', p.use_code,
        'zoning', p.zoning,
        'acres', p.acres,
        'sqft', p.sqft,
        'market_land_val', p.market_land_val,
        'market_imp_val', p.market_imp_val,
        'total_assessed_val', p.total_assessed_val
      ) ORDER BY p.is_primary DESC, p.apn ASC
    ) FILTER (WHERE p.id IS NOT NULL),
    '[]'::jsonb
  ) AS parcels
FROM public.deals d
LEFT JOIN public.parcels p ON p.deal_id = d.id
GROUP BY d.id, d.user_id, d.title;

GRANT SELECT ON public.view_deal_parcel_packages TO authenticated;
GRANT SELECT ON public.view_deal_parcel_packages TO service_role;

-- 7. Backfill existing parcel data from deals.inputs->'parcels'
INSERT INTO public.parcels (
  deal_id,
  user_id,
  apn,
  formatted_apn,
  is_primary,
  included,
  situs_address,
  legal_description,
  use_code,
  acres,
  market_land_val,
  market_imp_val
)
SELECT 
  d.id AS deal_id,
  d.user_id,
  COALESCE(p->>'apn', 'PENDING')::TEXT,
  COALESCE(p->>'formattedApn', p->>'apn')::TEXT,
  COALESCE((p->>'isPrimary')::BOOLEAN, false),
  COALESCE((p->>'included')::BOOLEAN, true),
  COALESCE(p->>'address', p->>'street', d.location)::TEXT,
  (p->>'legalDescription')::TEXT,
  (p->>'useCode')::TEXT,
  COALESCE((p->>'acres')::NUMERIC, 0),
  COALESCE((p->>'marketLandValue')::NUMERIC, 0),
  COALESCE((p->>'marketImprovementValue')::NUMERIC, 0)
FROM public.deals d,
jsonb_array_elements(d.inputs->'parcels') AS p
WHERE jsonb_typeof(d.inputs->'parcels') = 'array'
ON CONFLICT (deal_id, apn) DO UPDATE SET
  formatted_apn = EXCLUDED.formatted_apn,
  is_primary = EXCLUDED.is_primary,
  included = EXCLUDED.included,
  situs_address = EXCLUDED.situs_address,
  legal_description = EXCLUDED.legal_description,
  use_code = EXCLUDED.use_code,
  acres = EXCLUDED.acres,
  market_land_val = EXCLUDED.market_land_val,
  market_imp_val = EXCLUDED.market_imp_val;
