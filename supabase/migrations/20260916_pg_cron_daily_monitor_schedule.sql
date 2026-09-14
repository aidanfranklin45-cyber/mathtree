-- Migration: 20260916_pg_cron_daily_monitor_schedule.sql
-- Description: Enable pg_cron and pg_net extensions and configure daily autonomous lease monitor & escalation background job

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Ensure execute_scheduled_rent_escalations is accessible to postgres/service_role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Update execute_scheduled_rent_escalations with normalized increase_type handling
CREATE OR REPLACE FUNCTION public.execute_scheduled_rent_escalations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Identify leases with effective escalations on or before today that have not been applied
  FOR r_lease IN
    SELECT l.*, ri.id AS pending_inc_id, ri.new_rent AS scheduled_new_rent, ri.increase_type AS ri_type, ri.scheduled_amount AS ri_amount
    FROM public.leases l
    LEFT JOIN LATERAL (
      SELECT id, new_rent, increase_type, scheduled_amount
      FROM public.rent_increases
      WHERE lease_id = l.id
        AND effective_date <= CURRENT_DATE
        AND is_applied = false
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
    ELSIF r_lease.ri_amount IS NOT NULL THEN
      IF r_lease.ri_type = 'percentage' THEN
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.ri_amount / 100.0), 2);
      ELSIF r_lease.ri_type = 'fixed_step' THEN
        v_new_rent := r_lease.monthly_rent + r_lease.ri_amount;
      ELSIF r_lease.ri_type = 'cpi' THEN
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.ri_amount / 100.0), 2);
      ELSE
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.ri_amount / 100.0), 2);
      END IF;
    ELSIF r_lease.escalation_rate IS NOT NULL AND r_lease.escalation_rate > 0 THEN
      IF r_lease.escalation_type ILIKE '%percent%' THEN
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.escalation_rate / 100.0), 2);
      ELSE
        v_new_rent := r_lease.monthly_rent + r_lease.escalation_rate;
      END IF;
    ELSE
      CONTINUE;
    END IF;

    -- Update existing scheduled increase or record new execution record
    IF r_lease.pending_inc_id IS NOT NULL THEN
      UPDATE public.rent_increases
      SET 
        is_applied = true,
        old_rent = COALESCE(old_rent, r_lease.monthly_rent),
        new_rent = COALESCE(new_rent, v_new_rent)
      WHERE id = r_lease.pending_inc_id;
    ELSE
      INSERT INTO public.rent_increases (
        user_id, lease_id, deal_id, effective_date, old_rent, new_rent, increase_type, scheduled_amount, is_applied, reason
      ) VALUES (
        r_lease.user_id,
        r_lease.id,
        r_lease.deal_id,
        CURRENT_DATE,
        r_lease.monthly_rent,
        v_new_rent,
        CASE 
          WHEN r_lease.escalation_type ILIKE '%percent%' THEN 'percentage'
          WHEN r_lease.escalation_type ILIKE '%step%' OR r_lease.escalation_type ILIKE '%fixed%' OR r_lease.escalation_type ILIKE '%$%' THEN 'fixed_step'
          WHEN r_lease.escalation_type ILIKE '%cpi%' THEN 'cpi'
          ELSE 'percentage'
        END,
        r_lease.escalation_rate,
        true,
        'Contractual ' || COALESCE(r_lease.escalation_frequency, 'Annual') || ' escalation executed'
      );
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
        ELSE NULL
      END,
      updated_at = now()
    WHERE id = r_lease.id;

    v_updated_leases_count := v_updated_leases_count + 1;

    IF NOT (r_lease.deal_id = ANY(v_deal_ids)) THEN
      v_deal_ids := array_append(v_deal_ids, r_lease.deal_id);
    END IF;
  END LOOP;

  -- Recalculate deals dynamically
  FOREACH d_id IN ARRAY v_deal_ids
  LOOP
    SELECT * INTO v_deal FROM public.deals WHERE id = d_id;
    IF NOT FOUND THEN CONTINUE; END IF;

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

    v_noi := v_total_annual_rent * (1.0 - (v_opex_ratio / 100.0));

    IF v_cap_rate > 0 THEN
      v_valuation := ROUND(v_noi / (v_cap_rate / 100.0), 2);
    ELSE
      v_valuation := v_purchase_price;
    END IF;

    v_equity := GREATEST(0, ROUND(v_valuation - v_loan_amount, 2));

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
$function$;

-- Unschedule existing job if already present to prevent duplicate executions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-lease-monitor-job') THEN
    PERFORM cron.unschedule('daily-lease-monitor-job');
  END IF;
END $$;

-- Schedule Daily Autonomous Lease Monitor at 06:00 UTC (1:00 AM EST)
-- Automatically executes scheduled escalations, checks rent due dates, and sends 1-click email alerts
SELECT cron.schedule(
  'daily-lease-monitor-job',
  '0 6 * * *',
  $$SELECT net.http_post(
      url := 'https://bgexwcepwbxvhxbpblhd.supabase.co/functions/v1/cron-daily-lease-monitor',
      headers := '{"Content-Type": "application/json"}'::jsonb
  );$$
);
