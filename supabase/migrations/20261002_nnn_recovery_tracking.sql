-- NNN recovery tracking (opt-in per lease).
-- Tracks tenant-paid property tax, insurance, CAM and submetered utilities for commercial leases.
-- Tracking only: nothing here feeds underwriting or the math engine.
--   leases.track_recoveries   : per-lease opt-in (default off, so gross/residential leases are untouched)
--   lease_recovery_terms      : what the tenant owes, per category, and who pays the vendor
--   lease_recovery_items      : one row per term per due date, marked paid / verified

ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS track_recoveries BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.lease_recovery_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('property_tax','insurance','cam','utilities_submetered','other')),
  -- direct_pay: tenant pays the vendor (county, carrier) and we confirm it happened.
  -- reimburse:  landlord pays/bills and the tenant repays, tracked like rent.
  mode TEXT NOT NULL DEFAULT 'reimburse' CHECK (mode IN ('direct_pay','reimburse')),
  basis TEXT NOT NULL DEFAULT 'fixed_amount' CHECK (basis IN ('pro_rata_share','fixed_amount','actual_metered')),
  share_pct NUMERIC CHECK (share_pct IS NULL OR (share_pct >= 0 AND share_pct <= 100)),
  expected_amount NUMERIC,
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','semiannual','annual')),
  first_due_date DATE NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_recovery_term UNIQUE (lease_id, category, label)
);
CREATE INDEX IF NOT EXISTS idx_recovery_terms_lease_id ON public.lease_recovery_terms(lease_id);
CREATE INDEX IF NOT EXISTS idx_recovery_terms_deal_id ON public.lease_recovery_terms(deal_id);
CREATE INDEX IF NOT EXISTS idx_recovery_terms_user_id ON public.lease_recovery_terms(user_id);

CREATE TABLE IF NOT EXISTS public.lease_recovery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES public.lease_recovery_terms(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  due_date DATE NOT NULL,
  amount_expected NUMERIC,
  amount_actual NUMERIC,
  paid_date DATE,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_date DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_recovery_item_period UNIQUE (term_id, due_date)
);
CREATE INDEX IF NOT EXISTS idx_recovery_items_lease_id ON public.lease_recovery_items(lease_id);
CREATE INDEX IF NOT EXISTS idx_recovery_items_deal_id ON public.lease_recovery_items(deal_id);
CREATE INDEX IF NOT EXISTS idx_recovery_items_due ON public.lease_recovery_items(due_date);

REVOKE ALL ON TABLE public.lease_recovery_terms FROM anon;
REVOKE ALL ON TABLE public.lease_recovery_items FROM anon;
GRANT ALL ON TABLE public.lease_recovery_terms TO authenticated, service_role;
GRANT ALL ON TABLE public.lease_recovery_items TO authenticated, service_role;

ALTER TABLE public.lease_recovery_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_recovery_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lease_recovery_terms','lease_recovery_items'] LOOP
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
