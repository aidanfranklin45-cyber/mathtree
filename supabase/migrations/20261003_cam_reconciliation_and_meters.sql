-- CAM year-end reconciliation and submetered utilities (builds on 20261002_nnn_recovery_tracking.sql).
-- Tracking only: nothing here feeds underwriting or the math engine.
--   cam_reconciliations : one row per lease per year with the true-up the tenant owes (or is owed)
--   utility_meters      : a tenant's submeter and its rate
--   meter_readings      : a reading, the usage/charge it produced, and the recovery item it billed

CREATE TABLE IF NOT EXISTS public.cam_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  total_expenses NUMERIC NOT NULL DEFAULT 0,
  share_pct NUMERIC NOT NULL DEFAULT 0 CHECK (share_pct >= 0 AND share_pct <= 100),
  estimates_paid NUMERIC NOT NULL DEFAULT 0,
  cap_pct NUMERIC CHECK (cap_pct IS NULL OR cap_pct >= 0),
  prior_year_billed NUMERIC,
  admin_fee_pct NUMERIC CHECK (admin_fee_pct IS NULL OR admin_fee_pct >= 0),
  charge NUMERIC NOT NULL DEFAULT 0,
  true_up NUMERIC NOT NULL DEFAULT 0, -- positive: tenant owes landlord; negative: refund owed to tenant
  cap_applied BOOLEAN NOT NULL DEFAULT false,
  -- draft: still working it out. billed: true-up sent to the tenant. settled: paid / refunded.
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','billed','settled')),
  settled_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cam_recon_year UNIQUE (lease_id, year)
);
CREATE INDEX IF NOT EXISTS idx_cam_recon_lease_id ON public.cam_reconciliations(lease_id);
CREATE INDEX IF NOT EXISTS idx_cam_recon_deal_id ON public.cam_reconciliations(deal_id);

CREATE TABLE IF NOT EXISTS public.utility_meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  term_id UUID REFERENCES public.lease_recovery_terms(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  utility_type TEXT NOT NULL DEFAULT 'electric' CHECK (utility_type IN ('electric','water','gas','sewer','other')),
  unit_of_measure TEXT NOT NULL DEFAULT 'kWh',
  rate_per_unit NUMERIC NOT NULL DEFAULT 0 CHECK (rate_per_unit >= 0),
  multiplier NUMERIC NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  base_charge NUMERIC NOT NULL DEFAULT 0 CHECK (base_charge >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_utility_meters_lease_id ON public.utility_meters(lease_id);
CREATE INDEX IF NOT EXISTS idx_utility_meters_deal_id ON public.utility_meters(deal_id);

CREATE TABLE IF NOT EXISTS public.meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meter_id UUID NOT NULL REFERENCES public.utility_meters(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.lease_recovery_items(id) ON DELETE SET NULL,
  reading_date DATE NOT NULL,
  previous_reading NUMERIC NOT NULL,
  current_reading NUMERIC NOT NULL,
  usage NUMERIC NOT NULL DEFAULT 0,
  charge NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_meter_reading_order CHECK (current_reading >= previous_reading),
  CONSTRAINT uq_meter_reading_date UNIQUE (meter_id, reading_date)
);
CREATE INDEX IF NOT EXISTS idx_meter_readings_meter_id ON public.meter_readings(meter_id);
CREATE INDEX IF NOT EXISTS idx_meter_readings_lease_id ON public.meter_readings(lease_id);

REVOKE ALL ON TABLE public.cam_reconciliations FROM anon;
REVOKE ALL ON TABLE public.utility_meters FROM anon;
REVOKE ALL ON TABLE public.meter_readings FROM anon;
GRANT ALL ON TABLE public.cam_reconciliations TO authenticated, service_role;
GRANT ALL ON TABLE public.utility_meters TO authenticated, service_role;
GRANT ALL ON TABLE public.meter_readings TO authenticated, service_role;

ALTER TABLE public.cam_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cam_reconciliations','utility_meters','meter_readings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Users can view own %1$s" ON public.%1$s', t);
    EXECUTE format('CREATE POLICY "Users can view own %1$s" ON public.%1$s FOR SELECT TO authenticated USING (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can insert own %1$s" ON public.%1$s', t);
    EXECUTE format('CREATE POLICY "Users can insert own %1$s" ON public.%1$s FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update own %1$s" ON public.%1$s', t);
    EXECUTE format('CREATE POLICY "Users can update own %1$s" ON public.%1$s FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete own %1$s" ON public.%1$s', t);
    EXECUTE format('CREATE POLICY "Users can delete own %1$s" ON public.%1$s FOR DELETE TO authenticated USING (auth.uid() = user_id)', t);
  END LOOP;
END $$;
