-- Migration: 20260922_realtime_equity_and_amortization.sql
-- Description: Server-Side Financial Accuracy Trigger, Portfolio Equity Aggregation & Live Amortization Views

-- 1. Trigger Function: Recalculate Deal Loan Balance and Net Equity on Rent Payment Changes
CREATE OR REPLACE FUNCTION public.recalculate_deal_loan_and_equity_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id UUID;
  v_deal RECORD;
  v_purchase_price NUMERIC;
  v_initial_loan NUMERIC;
  v_total_principal_paid NUMERIC;
  v_current_loan NUMERIC;
  v_net_equity NUMERIC;
  v_ltv NUMERIC;
  v_deal_inputs jsonb;
  v_deal_metrics jsonb;
BEGIN
  -- Determine affected deal_id for INSERT, UPDATE, or DELETE
  IF (TG_OP = 'DELETE') THEN
    v_deal_id := OLD.deal_id;
  ELSE
    v_deal_id := NEW.deal_id;
  END IF;

  IF v_deal_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = v_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_deal_inputs := COALESCE(v_deal.inputs, '{}'::jsonb);
  v_deal_metrics := COALESCE(v_deal.metrics, '{}'::jsonb);

  v_purchase_price := COALESCE(v_deal.purchase_price, (v_deal_inputs->>'purchasePrice')::numeric, 0);
  v_initial_loan := COALESCE(
    (v_deal_inputs->>'loanAmount')::numeric,
    v_deal.loan_amount,
    v_purchase_price * (1.0 - (COALESCE((v_deal_inputs->>'downPaymentPercent')::numeric, 25.0) / 100.0)),
    0
  );

  -- Aggregate confirmed principal payments for this deal without Cartesian duplication
  SELECT COALESCE(SUM(amount_paid), 0) INTO v_total_principal_paid
  FROM public.rent_payments
  WHERE deal_id = v_deal_id
    AND status IN ('paid', 'partial');

  -- Derived Loan Balance & Net Equity NAV
  v_current_loan := GREATEST(0, v_initial_loan - v_total_principal_paid);
  v_net_equity := GREATEST(0, v_purchase_price - v_current_loan);

  IF v_purchase_price > 0 THEN
    v_ltv := ROUND((v_current_loan / v_purchase_price) * 100.0, 2);
  ELSE
    v_ltv := 0;
  END IF;

  v_deal_metrics := v_deal_metrics || jsonb_build_object(
    'netEquityNAV', v_net_equity,
    'currentLoanBalance', v_current_loan,
    'totalPrincipalPaid', v_total_principal_paid,
    'blendedLTV', v_ltv,
    'lastPaymentUpdate', now()
  );

  UPDATE public.deals
  SET
    total_equity = v_net_equity,
    loan_amount = v_current_loan,
    metrics = v_deal_metrics,
    updated_at = now()
  WHERE id = v_deal_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach trigger to public.rent_payments
DROP TRIGGER IF EXISTS trg_rent_payments_recalc_equity ON public.rent_payments;
CREATE TRIGGER trg_rent_payments_recalc_equity
AFTER INSERT OR UPDATE OR DELETE ON public.rent_payments
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_deal_loan_and_equity_on_payment();

-- 2. View: Realtime Deal Equity Summary (Guaranteed distinct deals & no payment duplication)
DROP VIEW IF EXISTS public.view_deal_equity_summary CASCADE;
CREATE VIEW public.view_deal_equity_summary AS
WITH deal_payments AS (
  SELECT
    deal_id,
    COALESCE(SUM(amount_paid) FILTER (WHERE status IN ('paid', 'partial')), 0)::numeric(14, 2) AS total_paid,
    COALESCE(SUM(amount_due), 0)::numeric(14, 2) AS total_billed,
    COUNT(id) AS payment_records_count,
    COUNT(id) FILTER (WHERE status = 'paid') AS paid_count,
    COUNT(id) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(id) FILTER (WHERE status = 'snoozed') AS snoozed_count,
    COUNT(id) FILTER (WHERE status = 'late' OR status = 'overdue') AS late_count
  FROM public.rent_payments
  GROUP BY deal_id
)
SELECT
  d.id AS deal_id,
  d.user_id,
  d.entity_id,
  d.title AS deal_title,
  d.location,
  d.asset_class,
  d.status AS deal_status,
  COALESCE(d.purchase_price, (d.inputs->>'purchasePrice')::numeric, 0)::numeric(14, 2) AS gav,
  COALESCE((d.inputs->>'loanAmount')::numeric, d.loan_amount, 0)::numeric(14, 2) AS initial_loan_amount,
  COALESCE(dp.total_paid, 0) AS total_principal_paid,
  GREATEST(0, COALESCE((d.inputs->>'loanAmount')::numeric, d.loan_amount, 0) - COALESCE(dp.total_paid, 0))::numeric(14, 2) AS current_loan_balance,
  GREATEST(0, COALESCE(d.purchase_price, (d.inputs->>'purchasePrice')::numeric, 0) - GREATEST(0, COALESCE((d.inputs->>'loanAmount')::numeric, d.loan_amount, 0) - COALESCE(dp.total_paid, 0)))::numeric(14, 2) AS net_equity_nav,
  CASE
    WHEN COALESCE(d.purchase_price, (d.inputs->>'purchasePrice')::numeric, 0) > 0 THEN
      ROUND((GREATEST(0, COALESCE((d.inputs->>'loanAmount')::numeric, d.loan_amount, 0) - COALESCE(dp.total_paid, 0)) / COALESCE(d.purchase_price, (d.inputs->>'purchasePrice')::numeric, 1)) * 100.0, 2)
    ELSE 0
  END AS ltv_percent,
  COALESCE(dp.payment_records_count, 0) AS payment_records_count,
  COALESCE(dp.paid_count, 0) AS paid_count,
  COALESCE(dp.pending_count, 0) AS pending_count,
  COALESCE(dp.snoozed_count, 0) AS snoozed_count,
  COALESCE(dp.late_count, 0) AS late_count,
  d.updated_at
FROM public.deals d
LEFT JOIN deal_payments dp ON dp.deal_id = d.id;

GRANT SELECT ON public.view_deal_equity_summary TO authenticated;
GRANT SELECT ON public.view_deal_equity_summary TO service_role;

-- 3. RPC: Portfolio-wide Equity & Live Amortization Schedule
CREATE OR REPLACE FUNCTION public.get_portfolio_equity_and_amortization(
  p_entity_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_summary RECORD;
  v_schedule jsonb;
BEGIN
  -- Aggregate distinct portfolio summary
  SELECT
    COUNT(deal_id) AS total_deals,
    COALESCE(SUM(gav), 0)::numeric(14, 2) AS total_gav,
    COALESCE(SUM(current_loan_balance), 0)::numeric(14, 2) AS total_loan_balance,
    COALESCE(SUM(net_equity_nav), 0)::numeric(14, 2) AS total_net_equity_nav,
    CASE
      WHEN COALESCE(SUM(gav), 0) > 0 THEN
        ROUND((COALESCE(SUM(current_loan_balance), 0) / SUM(gav)) * 100.0, 2)
      ELSE 0
    END AS blended_ltv
  INTO v_summary
  FROM public.view_deal_equity_summary
  WHERE (v_user_id IS NULL OR user_id = v_user_id)
    AND (p_entity_id IS NULL OR entity_id = p_entity_id);

  -- Fetch live amortization rows based strictly on rent_payments
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_schedule
  FROM (
    SELECT
      rp.id AS payment_id,
      rp.deal_id,
      d.title AS deal_title,
      l.tenant_name,
      rp.period_month,
      rp.due_date,
      rp.amount_due,
      rp.amount_paid,
      rp.paid_date,
      rp.status,
      rp.payment_method,
      rp.reference_note,
      rp.snooze_until
    FROM public.rent_payments rp
    JOIN public.deals d ON d.id = rp.deal_id
    LEFT JOIN public.leases l ON l.id = rp.lease_id
    WHERE (v_user_id IS NULL OR rp.user_id = v_user_id)
      AND (p_entity_id IS NULL OR d.entity_id = p_entity_id)
    ORDER BY rp.period_month DESC, rp.due_date DESC
  ) r;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'totalDeals', v_summary.total_deals,
      'totalGAV', v_summary.total_gav,
      'totalLoanBalance', v_summary.total_loan_balance,
      'netEquityNAV', v_summary.total_net_equity_nav,
      'blendedLTV', v_summary.blended_ltv
    ),
    'amortizationSchedule', v_schedule
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_portfolio_equity_and_amortization(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portfolio_equity_and_amortization(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_equity_and_amortization(UUID) TO anon;
