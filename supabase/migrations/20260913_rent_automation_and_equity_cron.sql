-- Migration: 20260913_rent_automation_and_equity_cron.sql
-- Description: Automated 1-Click Rent Reconciliation, Dynamic Late Policy Snooze, Scheduled Escalations & Dynamic Equity

-- 1. Extend public.rent_payments with snooze tracking
ALTER TABLE public.rent_payments 
  ADD COLUMN IF NOT EXISTS snooze_until DATE,
  ADD COLUMN IF NOT EXISTS snoozed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rent_payments_snooze ON public.rent_payments(snooze_until) WHERE snooze_until IS NOT NULL;

-- 2. Create single-use cryptographic tokens table for zero-login 1-click email actions
CREATE TABLE IF NOT EXISTS public.reconciliation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  action TEXT NOT NULL, -- 'confirm', 'snooze', 'undo'
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_tokens_hash ON public.reconciliation_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reconciliation_tokens_lease ON public.reconciliation_tokens(lease_id, period_month);

REVOKE ALL ON TABLE public.reconciliation_tokens FROM anon;
GRANT ALL ON TABLE public.reconciliation_tokens TO authenticated;
GRANT ALL ON TABLE public.reconciliation_tokens TO service_role;

ALTER TABLE public.reconciliation_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reconciliation tokens" ON public.reconciliation_tokens;
CREATE POLICY "Users can view own reconciliation tokens" ON public.reconciliation_tokens
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 3. Update public.view_monthly_rent_reconciliation view
DROP VIEW IF EXISTS public.view_monthly_rent_reconciliation CASCADE;

CREATE VIEW public.view_monthly_rent_reconciliation AS
WITH active_month AS (
  SELECT date_trunc('month', CURRENT_DATE)::date AS current_period
)
SELECT 
  l.id AS lease_id,
  l.deal_id,
  l.user_id,
  d.title AS deal_title,
  u.unit_number,
  l.tenant_name,
  l.tenant_email,
  l.tenant_phone,
  l.monthly_rent AS contractual_rent,
  l.payment_due_day,
  COALESCE(l.grace_period_days, 5) AS grace_period_days,
  l.next_escalation_date,
  l.escalation_type,
  l.escalation_rate,
  l.escalation_frequency,
  l.lease_start_date,
  l.lease_end_date,
  l.is_active,
  m.current_period,
  rp.id AS payment_id,
  COALESCE(rp.amount_paid, 0)::numeric(12, 2) AS amount_paid,
  rp.paid_date,
  rp.payment_method,
  rp.reference_note,
  rp.snooze_until,
  rp.snoozed_at,
  CASE 
    WHEN rp.status = 'paid' THEN 'paid'
    WHEN rp.status = 'partial' THEN 'partial'
    WHEN rp.snooze_until IS NOT NULL AND CURRENT_DATE <= rp.snooze_until THEN 'snoozed'
    WHEN CURRENT_DATE > (m.current_period + (COALESCE(l.payment_due_day, 1) + COALESCE(l.grace_period_days, 5) - 1)) THEN 'overdue'
    ELSE 'pending'
  END AS payment_status
FROM public.leases l
CROSS JOIN active_month m
JOIN public.deals d ON d.id = l.deal_id
LEFT JOIN public.units u ON u.id = l.unit_id
LEFT JOIN public.rent_payments rp ON rp.lease_id = l.id AND rp.period_month = m.current_period;

GRANT SELECT ON public.view_monthly_rent_reconciliation TO authenticated;
GRANT SELECT ON public.view_monthly_rent_reconciliation TO service_role;

-- 4. RPC: Confirm Rent Payment by Token (Zero-Login 1-Click execution)
CREATE OR REPLACE FUNCTION public.confirm_rent_payment_by_token(
  p_token text,
  p_payment_method text DEFAULT '1-Click Direct'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok RECORD;
  v_lease RECORD;
  v_deal RECORD;
  v_payment RECORD;
  v_undo_token text;
BEGIN
  -- Validate token
  SELECT * INTO v_tok
  FROM public.reconciliation_tokens
  WHERE token_hash = p_token
    AND action = 'confirm'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired reconciliation link.');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This payment has already been reconciled.');
  END IF;

  -- Fetch lease
  SELECT * INTO v_lease FROM public.leases WHERE id = v_tok.lease_id;
  SELECT * INTO v_deal FROM public.deals WHERE id = v_tok.deal_id;

  -- Upsert rent_payments
  INSERT INTO public.rent_payments (
    user_id,
    lease_id,
    deal_id,
    period_month,
    due_date,
    amount_due,
    amount_paid,
    paid_date,
    status,
    payment_method,
    reference_note
  ) VALUES (
    v_lease.user_id,
    v_lease.id,
    v_lease.deal_id,
    v_tok.period_month,
    (v_tok.period_month + (COALESCE(v_lease.payment_due_day, 1) - 1)),
    v_lease.monthly_rent,
    v_lease.monthly_rent,
    CURRENT_DATE,
    'paid',
    p_payment_method,
    'Reconciled via 1-Click Email Confirmation'
  )
  ON CONFLICT (lease_id, period_month) DO UPDATE SET
    amount_paid = EXCLUDED.amount_due,
    paid_date = CURRENT_DATE,
    status = 'paid',
    payment_method = EXCLUDED.payment_method,
    reference_note = EXCLUDED.reference_note,
    snooze_until = NULL,
    updated_at = now()
  RETURNING * INTO v_payment;

  -- Mark token as used
  UPDATE public.reconciliation_tokens SET used_at = now() WHERE id = v_tok.id;

  -- Generate single-use undo token (valid for 48 hours)
  v_undo_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.reconciliation_tokens (
    lease_id, deal_id, user_id, period_month, action, token_hash, expires_at
  ) VALUES (
    v_lease.id, v_deal.id, v_lease.user_id, v_tok.period_month, 'undo', v_undo_token, now() + INTERVAL '48 hours'
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', 'confirmed',
    'tenant_name', v_lease.tenant_name,
    'deal_title', v_deal.title,
    'amount_paid', v_payment.amount_paid,
    'period_month', v_payment.period_month,
    'paid_date', v_payment.paid_date,
    'undo_token', v_undo_token
  );
END;
$$;

-- 5. RPC: Snooze Rent Payment by Token (Dynamic Grace Period Snooze)
CREATE OR REPLACE FUNCTION public.snooze_rent_payment_by_token(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok RECORD;
  v_lease RECORD;
  v_deal RECORD;
  v_grace_days integer;
  v_snooze_date date;
  v_undo_token text;
BEGIN
  -- Validate token
  SELECT * INTO v_tok
  FROM public.reconciliation_tokens
  WHERE token_hash = p_token
    AND action = 'snooze'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired snooze link.');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This alert has already been snoozed.');
  END IF;

  -- Fetch lease
  SELECT * INTO v_lease FROM public.leases WHERE id = v_tok.lease_id;
  SELECT * INTO v_deal FROM public.deals WHERE id = v_tok.deal_id;

  v_grace_days := COALESCE(v_lease.grace_period_days, 5);
  v_snooze_date := CURRENT_DATE + v_grace_days;

  -- Upsert rent_payments with snoozed status and expiration date
  INSERT INTO public.rent_payments (
    user_id,
    lease_id,
    deal_id,
    period_month,
    due_date,
    amount_due,
    amount_paid,
    status,
    snooze_until,
    snoozed_at,
    reference_note
  ) VALUES (
    v_lease.user_id,
    v_lease.id,
    v_lease.deal_id,
    v_tok.period_month,
    (v_tok.period_month + (COALESCE(v_lease.payment_due_day, 1) - 1)),
    v_lease.monthly_rent,
    0,
    'snoozed',
    v_snooze_date,
    now(),
    'Snoozed by owner: dynamic grace period of ' || v_grace_days || ' days applied'
  )
  ON CONFLICT (lease_id, period_month) DO UPDATE SET
    status = 'snoozed',
    snooze_until = v_snooze_date,
    snoozed_at = now(),
    reference_note = 'Snoozed by owner: dynamic grace period of ' || v_grace_days || ' days applied',
    updated_at = now();

  -- Mark token used
  UPDATE public.reconciliation_tokens SET used_at = now() WHERE id = v_tok.id;

  -- Generate undo token
  v_undo_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.reconciliation_tokens (
    lease_id, deal_id, user_id, period_month, action, token_hash, expires_at
  ) VALUES (
    v_lease.id, v_deal.id, v_lease.user_id, v_tok.period_month, 'undo', v_undo_token, now() + INTERVAL '48 hours'
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', 'snoozed',
    'tenant_name', v_lease.tenant_name,
    'deal_title', v_deal.title,
    'grace_period_days', v_grace_days,
    'snooze_until', v_snooze_date,
    'undo_token', v_undo_token
  );
END;
$$;

-- 6. RPC: Undo Reconciliation Action (Revert to pending)
CREATE OR REPLACE FUNCTION public.undo_rent_reconciliation(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok RECORD;
BEGIN
  SELECT * INTO v_tok
  FROM public.reconciliation_tokens
  WHERE token_hash = p_token
    AND action = 'undo'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired undo link.');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Action has already been reverted.');
  END IF;

  -- Revert rent payment to pending
  UPDATE public.rent_payments
  SET 
    status = 'pending',
    amount_paid = 0,
    paid_date = NULL,
    payment_method = NULL,
    snooze_until = NULL,
    snoozed_at = NULL,
    reference_note = 'Reverted via Undo link',
    updated_at = now()
  WHERE lease_id = v_tok.lease_id AND period_month = v_tok.period_month;

  UPDATE public.reconciliation_tokens SET used_at = now() WHERE id = v_tok.id;

  RETURN jsonb_build_object('success', true, 'message', 'Payment status reverted to pending.');
END;
$$;

-- 7. RPC: Schedule Advance Rent Increase (Supports Month-to-Month)
CREATE OR REPLACE FUNCTION public.schedule_advance_rent_increase(
  p_lease_id UUID,
  p_effective_date DATE,
  p_new_rent NUMERIC,
  p_reason TEXT DEFAULT 'Advance scheduled rent adjustment'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease RECORD;
  v_increase RECORD;
BEGIN
  SELECT * INTO v_lease FROM public.leases WHERE id = p_lease_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lease not found.');
  END IF;

  -- Insert scheduled future increase
  INSERT INTO public.rent_increases (
    user_id,
    lease_id,
    deal_id,
    effective_date,
    old_rent,
    new_rent,
    reason,
    notice_sent_date
  ) VALUES (
    v_lease.user_id,
    v_lease.id,
    v_lease.deal_id,
    p_effective_date,
    v_lease.monthly_rent,
    p_new_rent,
    p_reason,
    CURRENT_DATE
  )
  RETURNING * INTO v_increase;

  -- Update next_escalation_date on lease without mutating monthly_rent yet
  UPDATE public.leases
  SET 
    next_escalation_date = p_effective_date,
    updated_at = now()
  WHERE id = p_lease_id;

  RETURN jsonb_build_object(
    'success', true,
    'increase_id', v_increase.id,
    'lease_id', p_lease_id,
    'effective_date', p_effective_date,
    'old_rent', v_lease.monthly_rent,
    'new_rent', p_new_rent
  );
END;
$$;

-- 8. RPC: Execute Scheduled Rent Escalations & Recalculate Dynamic Equity
CREATE OR REPLACE FUNCTION public.execute_scheduled_rent_escalations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_lease RECORD;
  v_new_rent NUMERIC;
  v_deal RECORD;
  v_total_monthly_rent NUMERIC;
  v_total_annual_rent NUMERIC;
  v_purchase_price NUMERIC;
  v_cap_rate NUMERIC;
  v_opex_ratio NUMERIC;
  v_noi NUMERIC;
  v_valuation NUMERIC;
  v_loan_amount NUMERIC;
  v_equity NUMERIC;
  v_updated_leases_count INTEGER := 0;
  v_updated_deals_count INTEGER := 0;
  v_deal_ids UUID[] := '{}';
  d_id UUID;
  v_deal_inputs jsonb;
  v_deal_metrics jsonb;
BEGIN
  -- 1. Identify leases with effective escalations on or before today
  FOR r_lease IN
    SELECT l.*, ri.id AS pending_inc_id, ri.new_rent AS scheduled_new_rent
    FROM public.leases l
    LEFT JOIN LATERAL (
      SELECT id, new_rent
      FROM public.rent_increases
      WHERE lease_id = l.id
        AND effective_date <= CURRENT_DATE
        AND effective_date > COALESCE(l.last_rent_increase_date, '1900-01-01')
      ORDER BY effective_date DESC
      LIMIT 1
    ) ri ON true
    WHERE l.is_active = true
      AND (
        ri.id IS NOT NULL 
        OR (l.next_escalation_date IS NOT NULL AND l.next_escalation_date <= CURRENT_DATE)
      )
  LOOP
    -- Determine target new rent
    IF r_lease.scheduled_new_rent IS NOT NULL THEN
      v_new_rent := r_lease.scheduled_new_rent;
    ELSIF r_lease.escalation_rate IS NOT NULL AND r_lease.escalation_rate > 0 THEN
      IF r_lease.escalation_type ILIKE '%percent%' THEN
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.escalation_rate / 100.0), 2);
      ELSE
        v_new_rent := r_lease.monthly_rent + r_lease.escalation_rate;
      END IF;

      -- Record audit entry in rent_increases if not already present
      INSERT INTO public.rent_increases (
        user_id, lease_id, deal_id, effective_date, old_rent, new_rent, reason
      ) VALUES (
        r_lease.user_id,
        r_lease.id,
        r_lease.deal_id,
        CURRENT_DATE,
        r_lease.monthly_rent,
        v_new_rent,
        'Contractual ' || COALESCE(r_lease.escalation_frequency, 'Annual') || ' escalation executed'
      );
    ELSE
      CONTINUE;
    END IF;

    -- Apply new rent to lease
    UPDATE public.leases
    SET 
      previous_rent_amount = r_lease.monthly_rent,
      monthly_rent = v_new_rent,
      last_rent_increase_date = CURRENT_DATE,
      next_escalation_date = CASE 
        WHEN r_lease.escalation_frequency ILIKE '%annual%' THEN (CURRENT_DATE + INTERVAL '1 year')::date
        WHEN r_lease.escalation_frequency ILIKE '%month%' THEN (CURRENT_DATE + INTERVAL '1 month')::date
        ELSE NULL -- For one-time / month-to-month non-regular bumps
      END,
      updated_at = now()
    WHERE id = r_lease.id;

    v_updated_leases_count := v_updated_leases_count + 1;

    -- Collect deal_id for dynamic equity recalculation
    IF NOT (r_lease.deal_id = ANY(v_deal_ids)) THEN
      v_deal_ids := array_append(v_deal_ids, r_lease.deal_id);
    END IF;
  END LOOP;

  -- 2. Dynamically update deals and recompute valuation & net equity
  FOREACH d_id IN ARRAY v_deal_ids
  LOOP
    SELECT * INTO v_deal FROM public.deals WHERE id = d_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- Calculate current total in-place rent across all active leases for this asset
    SELECT COALESCE(SUM(monthly_rent), 0) INTO v_total_monthly_rent
    FROM public.leases
    WHERE deal_id = d_id AND is_active = true;

    IF v_total_monthly_rent = 0 THEN CONTINUE; END IF;

    v_total_annual_rent := v_total_monthly_rent * 12;
    v_deal_inputs := COALESCE(v_deal.inputs, '{}'::jsonb);
    v_deal_metrics := COALESCE(v_deal.metrics, '{}'::jsonb);

    v_purchase_price := COALESCE(v_deal.purchase_price, (v_deal_inputs->>'purchasePrice')::numeric, 0);
    v_cap_rate := COALESCE((v_deal_inputs->>'targetCapRate')::numeric, (v_deal_metrics->>'capRate')::numeric, 6.5);
    v_opex_ratio := COALESCE((v_deal_inputs->>'expenseRatio')::numeric, (v_deal_inputs->>'operatingExpenseRatio')::numeric, 35.0);
    v_loan_amount := COALESCE((v_deal_metrics->>'loanAmount')::numeric, (v_deal_inputs->>'loanAmount')::numeric, v_purchase_price * 0.75);

    -- Compute Net Operating Income (NOI)
    v_noi := v_total_annual_rent * (1.0 - (v_opex_ratio / 100.0));

    -- Dynamic Property Valuation (Capitalized at Market Cap Rate)
    IF v_cap_rate > 0 THEN
      v_valuation := ROUND(v_noi / (v_cap_rate / 100.0), 2);
    ELSE
      v_valuation := v_purchase_price;
    END IF;

    -- Dynamic Net Equity = Asset Valuation - Outstanding Loan
    v_equity := GREATEST(0, ROUND(v_valuation - v_loan_amount, 2));

    -- Update deal inputs and metrics
    v_deal_inputs := v_deal_inputs || jsonb_build_object(
      'monthlyRent', v_total_monthly_rent,
      'grossRentPerMonth', v_total_monthly_rent,
      'grossRentAnnual', v_total_annual_rent
    );

    v_deal_metrics := v_deal_metrics || jsonb_build_object(
      'noi', v_noi,
      'valuation', v_valuation,
      'totalEquity', v_equity,
      'capRate', v_cap_rate,
      'lastAutoRecalc', now()
    );

    UPDATE public.deals
    SET 
      inputs = v_deal_inputs,
      metrics = v_deal_metrics,
      total_equity = v_equity,
      updated_at = now()
    WHERE id = d_id;

    v_updated_deals_count := v_updated_deals_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'leases_escalated', v_updated_leases_count,
    'deals_recalculated', v_updated_deals_count,
    'executed_at', now()
  );
END;
$$;

-- Permissions for stored procedures
GRANT EXECUTE ON FUNCTION public.confirm_rent_payment_by_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_rent_payment_by_token(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_rent_payment_by_token(text, text) TO anon;

GRANT EXECUTE ON FUNCTION public.snooze_rent_payment_by_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.snooze_rent_payment_by_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.snooze_rent_payment_by_token(text) TO anon;

GRANT EXECUTE ON FUNCTION public.undo_rent_reconciliation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_rent_reconciliation(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.undo_rent_reconciliation(text) TO anon;

GRANT EXECUTE ON FUNCTION public.schedule_advance_rent_increase(uuid, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_advance_rent_increase(uuid, date, numeric, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.execute_scheduled_rent_escalations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_scheduled_rent_escalations() TO service_role;
