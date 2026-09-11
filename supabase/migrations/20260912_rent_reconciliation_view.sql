-- Migration: 20260912_rent_reconciliation_view.sql
-- Description: Create public.view_monthly_rent_reconciliation view for single-query operations reporting.

CREATE OR REPLACE VIEW public.view_monthly_rent_reconciliation AS
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
  l.monthly_rent AS contractual_rent,
  l.is_active,
  m.current_period,
  rp.id AS payment_id,
  COALESCE(rp.amount_paid, 0)::numeric(12, 2) AS amount_paid,
  rp.paid_date,
  rp.payment_method,
  rp.reference_note,
  CASE 
    WHEN rp.status IS NOT NULL THEN rp.status
    WHEN CURRENT_DATE > (m.current_period + (l.payment_due_day + COALESCE(l.grace_period_days, 5) - 1)) THEN 'overdue'
    ELSE 'pending'
  END AS payment_status
FROM public.leases l
CROSS JOIN active_month m
JOIN public.deals d ON d.id = l.deal_id
LEFT JOIN public.units u ON u.id = l.unit_id
LEFT JOIN public.rent_payments rp ON rp.lease_id = l.id AND rp.period_month = m.current_period;

GRANT SELECT ON public.view_monthly_rent_reconciliation TO authenticated;
GRANT SELECT ON public.view_monthly_rent_reconciliation TO service_role;
