-- DRAFT 12 (NOT APPLIED): owner-only expense ledger so an owned property can record actual operating expenses.
-- Needed for actual NOI and realistic expense ratios. Tenant-reimbursed NNN items stay in the recovery tables.
-- Own-rows RLS only (user_id = auth.uid()), same as the recovery tables; no sharing through deal_shares.

BEGIN;

CREATE TABLE IF NOT EXISTS public.expense_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  expense_date date NOT NULL,
  category text NOT NULL CHECK (category IN (
    'property_tax', 'insurance', 'utilities', 'repairs_maintenance', 'management',
    'landscaping_snow', 'cleaning', 'legal_professional', 'marketing', 'other'
  )),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  vendor_note text,
  recurring boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expense_entries_deal_date_idx ON public.expense_entries (deal_id, expense_date DESC);

ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_entries FROM anon;

DROP POLICY IF EXISTS "Users can view own expense_entries" ON public.expense_entries;
CREATE POLICY "Users can view own expense_entries" ON public.expense_entries FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own expense_entries" ON public.expense_entries;
CREATE POLICY "Users can insert own expense_entries" ON public.expense_entries FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can update own expense_entries" ON public.expense_entries;
CREATE POLICY "Users can update own expense_entries" ON public.expense_entries FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own expense_entries" ON public.expense_entries;
CREATE POLICY "Users can delete own expense_entries" ON public.expense_entries FOR DELETE TO authenticated USING (auth.uid() = user_id);

COMMENT ON TABLE public.expense_entries IS 'Actual operating expenses paid by the owner, per deal. Owner-only.';

COMMIT;
