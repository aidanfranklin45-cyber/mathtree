-- FourLeaf Operations & Rent Roll Migration
-- Tables: entities, units, leases, rent_payments, rent_increases
-- Deals Foreign Key: deals.entity_id
-- Strict Multi-Tenant Row Level Security (RLS) restricted exclusively to authenticated users

-- 1. Entities (LLC / Ownership Vehicles)
CREATE TABLE IF NOT EXISTS public.entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ein TEXT,
  formation_state TEXT,
  formation_date DATE,
  bank_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Link Deals to Entities
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_deals_entity_id ON public.deals(entity_id);
CREATE INDEX IF NOT EXISTS idx_entities_user_id ON public.entities(user_id);

-- 3. Units (Suites, Bays, Apartments)
CREATE TABLE IF NOT EXISTS public.units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  unit_number TEXT NOT NULL,
  unit_type TEXT,
  sqft NUMERIC,
  market_rent NUMERIC,
  status TEXT NOT NULL DEFAULT 'occupied',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_units_deal_id ON public.units(deal_id);
CREATE INDEX IF NOT EXISTS idx_units_user_id ON public.units(user_id);

-- 4. Leases
CREATE TABLE IF NOT EXISTS public.leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  tenant_name TEXT NOT NULL,
  tenant_email TEXT,
  tenant_phone TEXT,
  lease_type TEXT DEFAULT 'gross',
  monthly_rent NUMERIC NOT NULL,
  security_deposit NUMERIC DEFAULT 0,
  lease_start_date DATE NOT NULL,
  lease_end_date DATE,
  payment_due_day INTEGER DEFAULT 1,
  grace_period_days INTEGER DEFAULT 5,
  last_rent_increase_date DATE,
  previous_rent_amount NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leases_deal_id ON public.leases(deal_id);
CREATE INDEX IF NOT EXISTS idx_leases_unit_id ON public.leases(unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_user_id ON public.leases(user_id);

-- 5. Rent Payments (Monthly Billing Ledger)
CREATE TABLE IF NOT EXISTS public.rent_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  due_date DATE NOT NULL,
  amount_due NUMERIC NOT NULL,
  amount_paid NUMERIC DEFAULT 0,
  paid_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  reference_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lease_period UNIQUE (lease_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_rent_payments_lease_id ON public.rent_payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_deal_id ON public.rent_payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_period ON public.rent_payments(period_month);

-- 6. Rent Increases (Historical Audit Trail)
CREATE TABLE IF NOT EXISTS public.rent_increases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  old_rent NUMERIC NOT NULL,
  new_rent NUMERIC NOT NULL,
  increase_amount NUMERIC GENERATED ALWAYS AS (new_rent - old_rent) STORED,
  percentage_change NUMERIC GENERATED ALWAYS AS (ROUND(((new_rent - old_rent) / NULLIF(old_rent, 0)) * 100, 2)) STORED,
  reason TEXT,
  notice_sent_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rent_increases_lease_id ON public.rent_increases(lease_id);
CREATE INDEX IF NOT EXISTS idx_rent_increases_deal_id ON public.rent_increases(deal_id);

-- 7. Revoke Public Permissions from Anon
REVOKE ALL ON TABLE public.entities FROM anon;
REVOKE ALL ON TABLE public.units FROM anon;
REVOKE ALL ON TABLE public.leases FROM anon;
REVOKE ALL ON TABLE public.rent_payments FROM anon;
REVOKE ALL ON TABLE public.rent_increases FROM anon;

-- 8. Grant Table Permissions Strictly to Authenticated & Service Role
GRANT ALL ON TABLE public.entities TO authenticated;
GRANT ALL ON TABLE public.units TO authenticated;
GRANT ALL ON TABLE public.leases TO authenticated;
GRANT ALL ON TABLE public.rent_payments TO authenticated;
GRANT ALL ON TABLE public.rent_increases TO authenticated;

GRANT ALL ON TABLE public.entities TO service_role;
GRANT ALL ON TABLE public.units TO service_role;
GRANT ALL ON TABLE public.leases TO service_role;
GRANT ALL ON TABLE public.rent_payments TO service_role;
GRANT ALL ON TABLE public.rent_increases TO service_role;

-- 9. Enable Row Level Security (RLS)
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_increases ENABLE ROW LEVEL SECURITY;

-- 10. Strict RLS Policies (auth.uid() = user_id)

-- Entities
DROP POLICY IF EXISTS "Users can view own entities" ON public.entities;
CREATE POLICY "Users can view own entities" ON public.entities FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own entities" ON public.entities;
CREATE POLICY "Users can insert own entities" ON public.entities FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own entities" ON public.entities;
CREATE POLICY "Users can update own entities" ON public.entities FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own entities" ON public.entities;
CREATE POLICY "Users can delete own entities" ON public.entities FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Units
DROP POLICY IF EXISTS "Users can view own units" ON public.units;
CREATE POLICY "Users can view own units" ON public.units FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own units" ON public.units;
CREATE POLICY "Users can insert own units" ON public.units FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own units" ON public.units;
CREATE POLICY "Users can update own units" ON public.units FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own units" ON public.units;
CREATE POLICY "Users can delete own units" ON public.units FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Leases
DROP POLICY IF EXISTS "Users can view own leases" ON public.leases;
CREATE POLICY "Users can view own leases" ON public.leases FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own leases" ON public.leases;
CREATE POLICY "Users can insert own leases" ON public.leases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own leases" ON public.leases;
CREATE POLICY "Users can update own leases" ON public.leases FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own leases" ON public.leases;
CREATE POLICY "Users can delete own leases" ON public.leases FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Rent Payments
DROP POLICY IF EXISTS "Users can view own rent_payments" ON public.rent_payments;
CREATE POLICY "Users can view own rent_payments" ON public.rent_payments FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own rent_payments" ON public.rent_payments;
CREATE POLICY "Users can insert own rent_payments" ON public.rent_payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own rent_payments" ON public.rent_payments;
CREATE POLICY "Users can update own rent_payments" ON public.rent_payments FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own rent_payments" ON public.rent_payments;
CREATE POLICY "Users can delete own rent_payments" ON public.rent_payments FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Rent Increases
DROP POLICY IF EXISTS "Users can view own rent_increases" ON public.rent_increases;
CREATE POLICY "Users can view own rent_increases" ON public.rent_increases FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own rent_increases" ON public.rent_increases;
CREATE POLICY "Users can insert own rent_increases" ON public.rent_increases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own rent_increases" ON public.rent_increases;
CREATE POLICY "Users can update own rent_increases" ON public.rent_increases FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own rent_increases" ON public.rent_increases;
CREATE POLICY "Users can delete own rent_increases" ON public.rent_increases FOR DELETE TO authenticated USING (auth.uid() = user_id);
