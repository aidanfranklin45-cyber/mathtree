-- 20260925_normalize_profile_preferences.sql
-- Promotes core investor hurdle rate and underwriting preferences from preferences JSONB
-- to dedicated, first-class typed columns on public.profiles.
-- Maintains bidirectional automatic synchronization between preferences JSONB and dedicated columns.

-- 1. Add dedicated columns with institutional defaults
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discount_rate NUMERIC(5, 2) DEFAULT 8.00,
  ADD COLUMN IF NOT EXISTS exit_year INT DEFAULT 10,
  ADD COLUMN IF NOT EXISTS exit_cap_timing TEXT DEFAULT 'amortized',
  ADD COLUMN IF NOT EXISTS market_tier TEXT DEFAULT 'Tier 2',
  ADD COLUMN IF NOT EXISTS property_class TEXT DEFAULT 'Class B';

-- 2. Backfill existing rows from preferences JSONB
UPDATE public.profiles
SET
  discount_rate = COALESCE((preferences->>'discountRate')::numeric, 8.00),
  exit_year = COALESCE((preferences->>'exitYear')::int, 10),
  exit_cap_timing = COALESCE(NULLIF(preferences->>'exitCapTiming', ''), 'amortized'),
  market_tier = COALESCE(NULLIF(preferences->>'marketTier', ''), 'Tier 2'),
  property_class = COALESCE(NULLIF(preferences->>'propertyClass', ''), 'Class B')
WHERE preferences IS NOT NULL;

-- 3. Bi-directional synchronization trigger function
CREATE OR REPLACE FUNCTION public.sync_profile_preferences()
RETURNS TRIGGER AS $$
BEGIN
  -- A. If preferences JSONB was modified (or on INSERT), sync keys down to dedicated columns
  IF TG_OP = 'INSERT' OR (NEW.preferences IS DISTINCT FROM OLD.preferences) THEN
    IF NEW.preferences IS NOT NULL THEN
      IF (NEW.preferences ? 'discountRate') AND (TG_OP = 'INSERT' OR NEW.discount_rate IS NOT DISTINCT FROM OLD.discount_rate) THEN
        NEW.discount_rate := COALESCE((NEW.preferences->>'discountRate')::numeric, NEW.discount_rate, 8.00);
      END IF;
      IF (NEW.preferences ? 'exitYear') AND (TG_OP = 'INSERT' OR NEW.exit_year IS NOT DISTINCT FROM OLD.exit_year) THEN
        NEW.exit_year := COALESCE((NEW.preferences->>'exitYear')::int, NEW.exit_year, 10);
      END IF;
      IF (NEW.preferences ? 'exitCapTiming') AND (TG_OP = 'INSERT' OR NEW.exit_cap_timing IS NOT DISTINCT FROM OLD.exit_cap_timing) THEN
        NEW.exit_cap_timing := COALESCE(NULLIF(NEW.preferences->>'exitCapTiming', ''), NEW.exit_cap_timing, 'amortized');
      END IF;
      IF (NEW.preferences ? 'marketTier') AND (TG_OP = 'INSERT' OR NEW.market_tier IS NOT DISTINCT FROM OLD.market_tier) THEN
        NEW.market_tier := COALESCE(NULLIF(NEW.preferences->>'marketTier', ''), NEW.market_tier, 'Tier 2');
      END IF;
      IF (NEW.preferences ? 'propertyClass') AND (TG_OP = 'INSERT' OR NEW.property_class IS NOT DISTINCT FROM OLD.property_class) THEN
        NEW.property_class := COALESCE(NULLIF(NEW.preferences->>'propertyClass', ''), NEW.property_class, 'Class B');
      END IF;
    END IF;
  END IF;

  -- B. Ensure preferences JSONB reflects any direct column changes or defaults
  NEW.preferences := COALESCE(NEW.preferences, '{}'::jsonb) || jsonb_build_object(
    'discountRate', COALESCE(NEW.discount_rate, 8.00),
    'exitYear', COALESCE(NEW.exit_year, 10),
    'exitCapTiming', COALESCE(NEW.exit_cap_timing, 'amortized'),
    'marketTier', COALESCE(NEW.market_tier, 'Tier 2'),
    'propertyClass', COALESCE(NEW.property_class, 'Class B')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach trigger to public.profiles
DROP TRIGGER IF EXISTS trg_sync_profile_preferences ON public.profiles;

CREATE TRIGGER trg_sync_profile_preferences
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_preferences();
