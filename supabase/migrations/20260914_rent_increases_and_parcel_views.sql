-- Migration: 20260914_rent_increases_and_parcel_views.sql
-- Description: Implement Issue #2 (predetermined rent escalations) & Issue #11 (Postgres single source of truth views and portfolio operations summary RPC).

-- ============================================================================
-- 1. EXTEND public.rent_increases FOR PREDETERMINED SCHEDULED ESCALATIONS (Issue #2)
-- ============================================================================

-- Add columns to support scheduling future predetermined escalations
ALTER TABLE public.rent_increases 
  ADD COLUMN IF NOT EXISTS is_applied BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS increase_type TEXT NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS scheduled_amount NUMERIC;

-- Enforce valid increase types
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_rent_increase_type'
  ) THEN
    ALTER TABLE public.rent_increases
      ADD CONSTRAINT chk_rent_increase_type 
      CHECK (increase_type IN ('percentage', 'fixed_step', 'cpi'));
  END IF;
END $$;

-- Allow old_rent and new_rent to be nullable if an escalation is scheduled before previous rent is finalized
ALTER TABLE public.rent_increases ALTER COLUMN old_rent DROP NOT NULL;
ALTER TABLE public.rent_increases ALTER COLUMN new_rent DROP NOT NULL;

-- Mark historical existing rent increases as already applied
UPDATE public.rent_increases
SET is_applied = true
WHERE is_applied = false 
  AND (effective_date <= CURRENT_DATE OR (old_rent IS NOT NULL AND new_rent IS NOT NULL));

-- Populate scheduled_amount for historical percentage increases
UPDATE public.rent_increases
SET scheduled_amount = COALESCE(percentage_change, 0)
WHERE scheduled_amount IS NULL AND increase_type = 'percentage';

-- Create index for quick lookup of pending vs applied escalations
CREATE INDEX IF NOT EXISTS idx_rent_increases_is_applied 
  ON public.rent_increases(lease_id, is_applied, effective_date);

-- Ensure public.leases has escalation configuration columns
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS next_escalation_date DATE,
  ADD COLUMN IF NOT EXISTS escalation_type TEXT,
  ADD COLUMN IF NOT EXISTS escalation_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS escalation_frequency TEXT;

-- ============================================================================
-- 2. UPDATE ESCALATION RPC FUNCTIONS TO LEVERAGE is_applied & SCHEDULED AMOUNTS
-- ============================================================================

-- Drop 4-arg overload if existing to prevent ambiguous function call signature
DROP FUNCTION IF EXISTS public.schedule_advance_rent_increase(UUID, DATE, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.schedule_advance_rent_increase(
  p_lease_id UUID,
  p_effective_date DATE,
  p_new_rent NUMERIC DEFAULT NULL,
  p_reason TEXT DEFAULT 'Advance scheduled rent adjustment',
  p_increase_type TEXT DEFAULT 'percentage',
  p_scheduled_amount NUMERIC DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease RECORD;
  v_increase RECORD;
  v_computed_new_rent NUMERIC;
BEGIN
  SELECT * INTO v_lease FROM public.leases WHERE id = p_lease_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lease not found.');
  END IF;

  -- Determine new rent if not explicitly provided
  v_computed_new_rent := p_new_rent;
  IF v_computed_new_rent IS NULL AND p_scheduled_amount IS NOT NULL THEN
    IF p_increase_type = 'percentage' THEN
      v_computed_new_rent := ROUND(v_lease.monthly_rent * (1 + (p_scheduled_amount / 100.0)), 2);
    ELSIF p_increase_type = 'fixed_step' THEN
      v_computed_new_rent := v_lease.monthly_rent + p_scheduled_amount;
    ELSIF p_increase_type = 'cpi' THEN
      v_computed_new_rent := ROUND(v_lease.monthly_rent * (1 + (p_scheduled_amount / 100.0)), 2);
    END IF;
  END IF;

  -- Insert scheduled future increase
  INSERT INTO public.rent_increases (
    user_id,
    lease_id,
    deal_id,
    effective_date,
    old_rent,
    new_rent,
    increase_type,
    scheduled_amount,
    is_applied,
    reason,
    notice_sent_date
  ) VALUES (
    v_lease.user_id,
    v_lease.id,
    v_lease.deal_id,
    p_effective_date,
    v_lease.monthly_rent,
    v_computed_new_rent,
    COALESCE(p_increase_type, 'percentage'),
    COALESCE(
      p_scheduled_amount, 
      CASE 
        WHEN v_computed_new_rent IS NOT NULL AND v_lease.monthly_rent > 0 
        THEN ROUND(((v_computed_new_rent - v_lease.monthly_rent) / v_lease.monthly_rent) * 100, 2) 
        ELSE NULL 
      END
    ),
    false,
    p_reason,
    CURRENT_DATE
  )
  RETURNING * INTO v_increase;

  -- Update next_escalation_date on lease without mutating current monthly_rent yet
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
    'increase_type', v_increase.increase_type,
    'scheduled_amount', v_increase.scheduled_amount,
    'old_rent', v_lease.monthly_rent,
    'new_rent', v_computed_new_rent,
    'is_applied', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_advance_rent_increase(UUID, DATE, NUMERIC, TEXT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_advance_rent_increase(UUID, DATE, NUMERIC, TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_advance_rent_increase(UUID, DATE, NUMERIC, TEXT, TEXT, NUMERIC) TO anon;

-- Update automatic escalation execution function
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
        COALESCE(r_lease.escalation_type, 'percentage'),
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
$$;

GRANT EXECUTE ON FUNCTION public.execute_scheduled_rent_escalations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_scheduled_rent_escalations() TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_scheduled_rent_escalations() TO anon;

-- ============================================================================
-- 3. ENSURE ROBUST POSTGRES VIEWS (Issue #11)
-- ============================================================================

-- A. view_deal_parcel_packages
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
GRANT SELECT ON public.view_deal_parcel_packages TO anon;

-- B. view_monthly_rent_reconciliation
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
    WHEN rp.status = 'paid' OR (rp.amount_paid IS NOT NULL AND rp.amount_paid >= l.monthly_rent) THEN 'paid'
    WHEN rp.status = 'partial' OR (COALESCE(rp.amount_paid, 0) > 0 AND rp.amount_paid < l.monthly_rent) THEN 'partial'
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
GRANT SELECT ON public.view_monthly_rent_reconciliation TO anon;

-- ============================================================================
-- 4. RPC: rpc_get_portfolio_operations_summary(UUID) (Issue #11)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_portfolio_operations_summary(p_user_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective_user_id UUID := p_user_id;
  v_use_demo BOOLEAN := false;
  v_current_period DATE;
  v_total_monthly_rent NUMERIC := 0;
  v_active_leases_count INT := 0;
  v_total_units INT := 0;
  v_occupied_units INT := 0;
  v_occupancy_rate NUMERIC := 0;
  v_total_billed NUMERIC := 0;
  v_total_collected NUMERIC := 0;
  v_pending_amount NUMERIC := 0;
  v_pending_count INT := 0;
  v_upcoming_increases JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  IF v_effective_user_id IS NULL THEN
    v_effective_user_id := auth.uid();
  END IF;

  v_current_period := date_trunc('month', CURRENT_DATE)::date;

  -- Determine if user has any active leases or custom deals; if none, gracefully fallback to demo deals (Rule 5)
  IF v_effective_user_id IS NOT NULL THEN
    SELECT COUNT(l.id) INTO v_active_leases_count
    FROM public.leases l
    JOIN public.deals d ON d.id = l.deal_id
    WHERE (l.user_id = v_effective_user_id OR d.user_id = v_effective_user_id)
      AND l.is_active = true;
  END IF;

  IF v_active_leases_count = 0 THEN
    v_use_demo := true;
  END IF;

  -- 1. Active leases metrics: total monthly rent and count
  IF NOT v_use_demo THEN
    SELECT 
      COALESCE(SUM(l.monthly_rent), 0),
      COUNT(l.id)
    INTO 
      v_total_monthly_rent,
      v_active_leases_count
    FROM public.leases l
    JOIN public.deals d ON d.id = l.deal_id
    WHERE (l.user_id = v_effective_user_id OR d.user_id = v_effective_user_id)
      AND l.is_active = true;
  ELSE
    SELECT 
      COALESCE(SUM(l.monthly_rent), 0),
      COUNT(l.id)
    INTO 
      v_total_monthly_rent,
      v_active_leases_count
    FROM public.leases l
    JOIN public.deals d ON d.id = l.deal_id
    WHERE d.is_demo = true
      AND l.is_active = true;
  END IF;

  -- 2. Occupancy Rate: Units & occupied units
  IF NOT v_use_demo THEN
    SELECT COUNT(u.id)
    INTO v_total_units
    FROM public.units u
    JOIN public.deals d ON d.id = u.deal_id
    WHERE (u.user_id = v_effective_user_id OR d.user_id = v_effective_user_id);

    IF v_total_units = 0 AND v_active_leases_count > 0 THEN
      v_total_units := v_active_leases_count;
      v_occupied_units := v_active_leases_count;
    ELSE
      SELECT COUNT(DISTINCT u.id)
      INTO v_occupied_units
      FROM public.units u
      JOIN public.deals d ON d.id = u.deal_id
      WHERE (u.user_id = v_effective_user_id OR d.user_id = v_effective_user_id)
        AND (
          u.status = 'occupied' 
          OR EXISTS (SELECT 1 FROM public.leases l WHERE l.unit_id = u.id AND l.is_active = true)
        );
    END IF;
  ELSE
    SELECT COUNT(u.id)
    INTO v_total_units
    FROM public.units u
    JOIN public.deals d ON d.id = u.deal_id
    WHERE d.is_demo = true;

    IF v_total_units = 0 AND v_active_leases_count > 0 THEN
      v_total_units := v_active_leases_count;
      v_occupied_units := v_active_leases_count;
    ELSE
      SELECT COUNT(DISTINCT u.id)
      INTO v_occupied_units
      FROM public.units u
      JOIN public.deals d ON d.id = u.deal_id
      WHERE d.is_demo = true
        AND (
          u.status = 'occupied' 
          OR EXISTS (SELECT 1 FROM public.leases l WHERE l.unit_id = u.id AND l.is_active = true)
        );
    END IF;
  END IF;

  IF v_total_units > 0 THEN
    v_occupancy_rate := ROUND((v_occupied_units::numeric / v_total_units::numeric) * 100.0, 2);
  ELSE
    v_occupancy_rate := 100.0;
  END IF;

  -- 3. Monthly Rent Reconciliation / Pending Collections for Current Period
  IF NOT v_use_demo THEN
    SELECT 
      COALESCE(SUM(v.contractual_rent), 0),
      COALESCE(SUM(v.amount_paid), 0),
      COALESCE(SUM(GREATEST(0, v.contractual_rent - v.amount_paid)) FILTER (WHERE v.payment_status != 'paid'), 0),
      COUNT(v.lease_id) FILTER (WHERE v.payment_status IN ('pending', 'overdue', 'snoozed', 'partial'))
    INTO 
      v_total_billed,
      v_total_collected,
      v_pending_amount,
      v_pending_count
    FROM public.view_monthly_rent_reconciliation v
    JOIN public.deals d ON d.id = v.deal_id
    WHERE (v.user_id = v_effective_user_id OR d.user_id = v_effective_user_id)
      AND v.is_active = true;
  ELSE
    SELECT 
      COALESCE(SUM(v.contractual_rent), 0),
      COALESCE(SUM(v.amount_paid), 0),
      COALESCE(SUM(GREATEST(0, v.contractual_rent - v.amount_paid)) FILTER (WHERE v.payment_status != 'paid'), 0),
      COUNT(v.lease_id) FILTER (WHERE v.payment_status IN ('pending', 'overdue', 'snoozed', 'partial'))
    INTO 
      v_total_billed,
      v_total_collected,
      v_pending_amount,
      v_pending_count
    FROM public.view_monthly_rent_reconciliation v
    JOIN public.deals d ON d.id = v.deal_id
    WHERE d.is_demo = true
      AND v.is_active = true;
  END IF;

  -- 4. Scheduled Upcoming Rent Increases across Active Leases
  IF NOT v_use_demo THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', ri.id,
          'lease_id', ri.lease_id,
          'deal_id', ri.deal_id,
          'deal_title', d.title,
          'tenant_name', l.tenant_name,
          'unit_number', u.unit_number,
          'effective_date', ri.effective_date,
          'increase_type', ri.increase_type,
          'scheduled_amount', ri.scheduled_amount,
          'current_rent', l.monthly_rent,
          'old_rent', ri.old_rent,
          'new_rent', COALESCE(
            ri.new_rent,
            CASE 
              WHEN ri.increase_type = 'percentage' THEN ROUND(l.monthly_rent * (1 + COALESCE(ri.scheduled_amount, 0) / 100.0), 2)
              WHEN ri.increase_type = 'fixed_step' THEN l.monthly_rent + COALESCE(ri.scheduled_amount, 0)
              WHEN ri.increase_type = 'cpi' THEN ROUND(l.monthly_rent * (1 + COALESCE(ri.scheduled_amount, 3.0) / 100.0), 2)
              ELSE l.monthly_rent
            END
          ),
          'projected_increase_amount', COALESCE(
            ri.increase_amount,
            CASE 
              WHEN ri.increase_type = 'percentage' THEN ROUND(l.monthly_rent * (COALESCE(ri.scheduled_amount, 0) / 100.0), 2)
              WHEN ri.increase_type = 'fixed_step' THEN COALESCE(ri.scheduled_amount, 0)
              WHEN ri.increase_type = 'cpi' THEN ROUND(l.monthly_rent * (COALESCE(ri.scheduled_amount, 3.0) / 100.0), 2)
              ELSE 0
            END
          ),
          'reason', ri.reason,
          'is_applied', ri.is_applied,
          'created_at', ri.created_at
        ) ORDER BY ri.effective_date ASC
      ),
      '[]'::jsonb
    )
    INTO v_upcoming_increases
    FROM public.rent_increases ri
    JOIN public.leases l ON l.id = ri.lease_id
    JOIN public.deals d ON d.id = ri.deal_id
    LEFT JOIN public.units u ON u.id = l.unit_id
    WHERE (ri.user_id = v_effective_user_id OR d.user_id = v_effective_user_id)
      AND ri.is_applied = false
      AND l.is_active = true;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', ri.id,
          'lease_id', ri.lease_id,
          'deal_id', ri.deal_id,
          'deal_title', d.title,
          'tenant_name', l.tenant_name,
          'unit_number', u.unit_number,
          'effective_date', ri.effective_date,
          'increase_type', ri.increase_type,
          'scheduled_amount', ri.scheduled_amount,
          'current_rent', l.monthly_rent,
          'old_rent', ri.old_rent,
          'new_rent', COALESCE(
            ri.new_rent,
            CASE 
              WHEN ri.increase_type = 'percentage' THEN ROUND(l.monthly_rent * (1 + COALESCE(ri.scheduled_amount, 0) / 100.0), 2)
              WHEN ri.increase_type = 'fixed_step' THEN l.monthly_rent + COALESCE(ri.scheduled_amount, 0)
              WHEN ri.increase_type = 'cpi' THEN ROUND(l.monthly_rent * (1 + COALESCE(ri.scheduled_amount, 3.0) / 100.0), 2)
              ELSE l.monthly_rent
            END
          ),
          'projected_increase_amount', COALESCE(
            ri.increase_amount,
            CASE 
              WHEN ri.increase_type = 'percentage' THEN ROUND(l.monthly_rent * (COALESCE(ri.scheduled_amount, 0) / 100.0), 2)
              WHEN ri.increase_type = 'fixed_step' THEN COALESCE(ri.scheduled_amount, 0)
              WHEN ri.increase_type = 'cpi' THEN ROUND(l.monthly_rent * (COALESCE(ri.scheduled_amount, 3.0) / 100.0), 2)
              ELSE 0
            END
          ),
          'reason', ri.reason,
          'is_applied', ri.is_applied,
          'created_at', ri.created_at
        ) ORDER BY ri.effective_date ASC
      ),
      '[]'::jsonb
    )
    INTO v_upcoming_increases
    FROM public.rent_increases ri
    JOIN public.leases l ON l.id = ri.lease_id
    JOIN public.deals d ON d.id = ri.deal_id
    LEFT JOIN public.units u ON u.id = l.unit_id
    WHERE d.is_demo = true
      AND ri.is_applied = false
      AND l.is_active = true;
  END IF;

  -- 5. Build and return result JSONB
  v_result := jsonb_build_object(
    'success', true,
    'user_id', v_effective_user_id,
    'is_demo', v_use_demo,
    'current_period', v_current_period,
    'total_monthly_rent', v_total_monthly_rent,
    'total_annual_rent', v_total_monthly_rent * 12,
    'active_leases_count', v_active_leases_count,
    'total_units', v_total_units,
    'occupied_units', v_occupied_units,
    'vacant_units', GREATEST(0, v_total_units - v_occupied_units),
    'occupancy_rate', v_occupancy_rate,
    'total_billed_current_month', v_total_billed,
    'total_collected_current_month', v_total_collected,
    'pending_collections_amount', v_pending_amount,
    'pending_collections_count', v_pending_count,
    'upcoming_increases_count', jsonb_array_length(v_upcoming_increases),
    'scheduled_upcoming_increases', v_upcoming_increases
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_portfolio_operations_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_portfolio_operations_summary(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_portfolio_operations_summary(UUID) TO anon;
