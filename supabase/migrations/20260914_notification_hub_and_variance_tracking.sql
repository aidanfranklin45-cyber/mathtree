-- Migration: 20260914_notification_hub_and_variance_tracking.sql
-- 1. Relax NOT NULL constraint on leases.lease_start_date so draft leases can exist with blank dates
ALTER TABLE public.leases ALTER COLUMN lease_start_date DROP NOT NULL;

-- 2. Create app_notifications table
CREATE TABLE IF NOT EXISTS public.app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'missing_lease' | 'missing_terms' | 'revenue_variance' | 'escalation_upcoming' | 'entity_missing'
  severity TEXT NOT NULL DEFAULT 'info', -- 'critical' | 'warning' | 'info'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_type TEXT, -- 'open_lease_modal' | 'sync_proforma_income' | 'open_entity_modal' | 'view_deal'
  action_payload JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_notifications_user_id ON public.app_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_app_notifications_deal_id ON public.app_notifications(deal_id);
CREATE INDEX IF NOT EXISTS idx_app_notifications_is_dismissed ON public.app_notifications(is_dismissed);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'app_notifications' AND policyname = 'app_notifications_user_policy'
  ) THEN
    CREATE POLICY app_notifications_user_policy ON public.app_notifications
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT ALL ON public.app_notifications TO authenticated;
GRANT ALL ON public.app_notifications TO anon;
GRANT ALL ON public.app_notifications TO service_role;

-- 3. Create deal_baselines table
CREATE TABLE IF NOT EXISTS public.deal_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  baseline_type TEXT NOT NULL DEFAULT 'initial_underwriting',
  purchase_price NUMERIC,
  projected_gross_rent_annual NUMERIC NOT NULL DEFAULT 0,
  projected_noi NUMERIC NOT NULL DEFAULT 0,
  projected_cash_flow NUMERIC DEFAULT 0,
  projected_irr NUMERIC DEFAULT 0,
  projected_cash_on_cash NUMERIC DEFAULT 0,
  inputs_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_deal_initial_baseline UNIQUE (deal_id, baseline_type)
);

CREATE INDEX IF NOT EXISTS idx_deal_baselines_deal_id ON public.deal_baselines(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_baselines_user_id ON public.deal_baselines(user_id);

ALTER TABLE public.deal_baselines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deal_baselines' AND policyname = 'deal_baselines_user_policy'
  ) THEN
    CREATE POLICY deal_baselines_user_policy ON public.deal_baselines
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT ALL ON public.deal_baselines TO authenticated;
GRANT ALL ON public.deal_baselines TO anon;
GRANT ALL ON public.deal_baselines TO service_role;

-- 4. Create View: view_deal_performance_tracking
CREATE OR REPLACE VIEW public.view_deal_performance_tracking AS
SELECT
  d.id AS deal_id,
  d.user_id,
  d.title AS deal_name,
  d.asset_type,
  d.status,
  COALESCE(
    b.projected_gross_rent_annual / 12.0,
    NULLIF((d.inputs->>'grossRentAnnual')::numeric, 0) / 12.0,
    (d.inputs->>'grossRentPerMonth')::numeric,
    (d.inputs->>'monthlyRent')::numeric,
    0
  ) AS baseline_monthly_rent,
  COALESCE(
    b.projected_noi,
    (d.metrics->>'netOperatingIncome')::numeric,
    (d.metrics->>'noi')::numeric,
    0
  ) AS baseline_annual_noi,
  COALESCE(SUM(l.monthly_rent) FILTER (WHERE l.is_active = true), 0) AS actual_monthly_rent,
  COALESCE(SUM(l.monthly_rent) FILTER (WHERE l.is_active = true) * 12.0, 0) AS actual_annual_rent,
  ROUND(
    COALESCE(SUM(l.monthly_rent) FILTER (WHERE l.is_active = true), 0) -
    COALESCE(
      b.projected_gross_rent_annual / 12.0,
      NULLIF((d.inputs->>'grossRentAnnual')::numeric, 0) / 12.0,
      (d.inputs->>'grossRentPerMonth')::numeric,
      (d.inputs->>'monthlyRent')::numeric,
      0
    ),
    2
  ) AS rent_variance_monthly_usd,
  CASE
    WHEN COALESCE(
      b.projected_gross_rent_annual / 12.0,
      NULLIF((d.inputs->>'grossRentAnnual')::numeric, 0) / 12.0,
      (d.inputs->>'grossRentPerMonth')::numeric,
      (d.inputs->>'monthlyRent')::numeric,
      0
    ) > 0 THEN
      ROUND(
        ((COALESCE(SUM(l.monthly_rent) FILTER (WHERE l.is_active = true), 0) -
          COALESCE(
            b.projected_gross_rent_annual / 12.0,
            NULLIF((d.inputs->>'grossRentAnnual')::numeric, 0) / 12.0,
            (d.inputs->>'grossRentPerMonth')::numeric,
            (d.inputs->>'monthlyRent')::numeric,
            0
          )) /
          COALESCE(
            b.projected_gross_rent_annual / 12.0,
            NULLIF((d.inputs->>'grossRentAnnual')::numeric, 0) / 12.0,
            (d.inputs->>'grossRentPerMonth')::numeric,
            (d.inputs->>'monthlyRent')::numeric,
            1
          )) * 100.0,
        2
      )
    ELSE 0
  END AS rent_variance_pct,
  COUNT(l.id) FILTER (WHERE l.is_active = true) AS active_tenant_count,
  d.entity_id
FROM public.deals d
LEFT JOIN public.deal_baselines b ON b.deal_id = d.id AND b.baseline_type = 'initial_underwriting'
LEFT JOIN public.leases l ON l.deal_id = d.id
GROUP BY d.id, d.user_id, d.title, d.asset_type, d.status, b.projected_gross_rent_annual, b.projected_noi, d.inputs, d.metrics, d.entity_id;

GRANT SELECT ON public.view_deal_performance_tracking TO authenticated;
GRANT SELECT ON public.view_deal_performance_tracking TO anon;
GRANT SELECT ON public.view_deal_performance_tracking TO service_role;

-- 5. Function to capture initial baseline when a deal is created or marked owned
CREATE OR REPLACE FUNCTION public.rpc_capture_deal_baseline(p_deal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deal RECORD;
  v_baseline RECORD;
  v_gross_annual NUMERIC;
  v_noi NUMERIC;
  v_cf NUMERIC;
  v_irr NUMERIC;
  v_coc NUMERIC;
BEGIN
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;

  SELECT * INTO v_baseline FROM public.deal_baselines WHERE deal_id = p_deal_id AND baseline_type = 'initial_underwriting';
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'message', 'Baseline already exists', 'baseline_id', v_baseline.id);
  END IF;

  v_gross_annual := COALESCE(
    (v_deal.inputs->>'grossRentAnnual')::numeric,
    ((v_deal.inputs->>'grossRentPerMonth')::numeric * 12.0),
    ((v_deal.inputs->>'monthlyRent')::numeric * 12.0),
    0
  );
  v_noi := COALESCE((v_deal.metrics->>'netOperatingIncome')::numeric, (v_deal.metrics->>'noi')::numeric, 0);
  v_cf  := COALESCE((v_deal.metrics->>'year1CashFlow')::numeric, (v_deal.metrics->>'cashFlow')::numeric, v_deal.year1_cashflow, 0);
  v_irr := COALESCE((v_deal.metrics->>'irr')::numeric, v_deal.irr, 0);
  v_coc := COALESCE((v_deal.metrics->>'cashOnCash')::numeric, (v_deal.metrics->>'year1CoC')::numeric, v_deal.cash_on_cash, 0);

  INSERT INTO public.deal_baselines (
    deal_id,
    user_id,
    baseline_type,
    purchase_price,
    projected_gross_rent_annual,
    projected_noi,
    projected_cash_flow,
    projected_irr,
    projected_cash_on_cash,
    inputs_snapshot,
    metrics_snapshot
  ) VALUES (
    v_deal.id,
    v_deal.user_id,
    'initial_underwriting',
    v_deal.purchase_price,
    v_gross_annual,
    v_noi,
    v_cf,
    v_irr,
    v_coc,
    COALESCE(v_deal.inputs, '{}'::jsonb),
    COALESCE(v_deal.metrics, '{}'::jsonb)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Baseline captured successfully');
END;
$$;

-- 6. Function to evaluate dynamic notifications for a user's portfolio
DROP FUNCTION IF EXISTS public.rpc_evaluate_deal_notifications(UUID);

CREATE OR REPLACE FUNCTION public.rpc_evaluate_deal_notifications(p_user_id UUID)
RETURNS TABLE (
  notification_id UUID,
  target_deal_id UUID,
  notif_type TEXT,
  severity TEXT,
  title TEXT,
  message TEXT,
  action_type TEXT,
  action_payload JSONB,
  is_read BOOLEAN,
  is_dismissed BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deal RECORD;
  v_active_leases_count INT;
  v_active_rent_total NUMERIC;
  v_projected_rent_monthly NUMERIC;
  v_variance_usd NUMERIC;
  v_variance_pct NUMERIC;
  v_lease RECORD;
BEGIN
  FOR v_deal IN SELECT * FROM public.deals WHERE user_id = p_user_id LOOP
    -- Ensure baseline exists for owned deals
    IF v_deal.status = 'owned' THEN
      PERFORM public.rpc_capture_deal_baseline(v_deal.id);
    END IF;

    SELECT COUNT(*), COALESCE(SUM(l.monthly_rent), 0)
    INTO v_active_leases_count, v_active_rent_total
    FROM public.leases l
    WHERE l.deal_id = v_deal.id AND l.is_active = true;

    -- RULE A: Owned deal without active tenant
    IF v_deal.status = 'owned' AND v_active_leases_count = 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.app_notifications n
        WHERE n.user_id = p_user_id AND n.deal_id = v_deal.id AND n.type = 'missing_lease' AND n.is_dismissed = false
      ) THEN
        INSERT INTO public.app_notifications (
          user_id, deal_id, type, severity, title, message, action_type, action_payload
        ) VALUES (
          p_user_id,
          v_deal.id,
          'missing_lease',
          'critical',
          'Missing Tenant of Record · ' || v_deal.title,
          'This property is marked as Owned, but has no active tenant registered. Add your tenant to enable automated rent tracking and real-time equity forecasting.',
          'open_lease_modal',
          jsonb_build_object('deal_id', v_deal.id, 'deal_title', v_deal.title)
        );
      END IF;
    END IF;

    -- RULE B: Owned deal without LLC entity assignment
    IF v_deal.status = 'owned' AND v_deal.entity_id IS NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.app_notifications n
        WHERE n.user_id = p_user_id AND n.deal_id = v_deal.id AND n.type = 'entity_missing' AND n.is_dismissed = false
      ) THEN
        INSERT INTO public.app_notifications (
          user_id, deal_id, type, severity, title, message, action_type, action_payload
        ) VALUES (
          p_user_id,
          v_deal.id,
          'entity_missing',
          'info',
          'Assign Entity LLC · ' || v_deal.title,
          'Link this asset to an LLC holding entity to isolate operational liability and track separate banking transactions.',
          'open_entity_modal',
          jsonb_build_object('deal_id', v_deal.id, 'deal_title', v_deal.title)
        );
      END IF;
    END IF;

    -- RULE C: Revenue Variance Check (Reported Operations vs Pro-Forma)
    IF v_active_leases_count > 0 THEN
      v_projected_rent_monthly := COALESCE(
        NULLIF((v_deal.inputs->>'grossRentAnnual')::numeric, 0) / 12.0,
        (v_deal.inputs->>'grossRentPerMonth')::numeric,
        (v_deal.inputs->>'monthlyRent')::numeric,
        0
      );

      IF v_projected_rent_monthly > 0 THEN
        v_variance_usd := v_active_rent_total - v_projected_rent_monthly;
        v_variance_pct := ROUND(((v_variance_usd / v_projected_rent_monthly) * 100.0), 1);

        -- If variance is greater than 5% or > $150/month
        IF ABS(v_variance_pct) >= 5.0 OR ABS(v_variance_usd) >= 150.0 THEN
          IF NOT EXISTS (
            SELECT 1 FROM public.app_notifications n
            WHERE n.user_id = p_user_id AND n.deal_id = v_deal.id AND n.type = 'revenue_variance' AND n.is_dismissed = false
          ) THEN
            INSERT INTO public.app_notifications (
              user_id, deal_id, type, severity, title, message, action_type, action_payload
            ) VALUES (
              p_user_id,
              v_deal.id,
              'revenue_variance',
              'warning',
              'Revenue Variance Detected · ' || v_deal.title,
              'Actual monthly rent roll ($' || TO_CHAR(v_active_rent_total, 'FM999,999,999') || '/mo) differs from your prospective pro-forma ($' || TO_CHAR(v_projected_rent_monthly, 'FM999,999,999') || '/mo) by ' || (CASE WHEN v_variance_pct > 0 THEN '+' ELSE '' END) || v_variance_pct || '%. Confirm to synchronize your pro-forma model to this real revenue.',
              'sync_proforma_income',
              jsonb_build_object(
                'deal_id', v_deal.id,
                'deal_title', v_deal.title,
                'actual_monthly_rent', v_active_rent_total,
                'projected_monthly_rent', v_projected_rent_monthly,
                'variance_pct', v_variance_pct
              )
            );
          END IF;
        END IF;
      END IF;
    END IF;

    -- RULE D: Incomplete Lease Terms (Missing Start Date)
    FOR v_lease IN SELECT * FROM public.leases l WHERE l.deal_id = v_deal.id AND l.is_active = true LOOP
      IF v_lease.lease_start_date IS NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.app_notifications n
          WHERE n.user_id = p_user_id AND n.deal_id = v_deal.id AND n.type = 'missing_terms' AND n.is_dismissed = false
        ) THEN
          INSERT INTO public.app_notifications (
            user_id, deal_id, type, severity, title, message, action_type, action_payload
          ) VALUES (
            p_user_id,
            v_deal.id,
            'missing_terms',
            'warning',
            'Missing Lease Start Date · ' || v_lease.tenant_name,
            'The active lease for ' || v_lease.tenant_name || ' is missing a commencement date. Fill in the date to automate escalation schedules and rent notifications.',
            'open_lease_modal',
            jsonb_build_object('deal_id', v_deal.id, 'lease_id', v_lease.id)
          );
        END IF;
      END IF;
    END LOOP;

  END LOOP;

  RETURN QUERY
  SELECT
    an.id AS notification_id,
    an.deal_id AS target_deal_id,
    an.type AS notif_type,
    an.severity,
    an.title,
    an.message,
    an.action_type,
    an.action_payload,
    an.is_read,
    an.is_dismissed,
    an.created_at
  FROM public.app_notifications an
  WHERE an.user_id = p_user_id
    AND an.is_dismissed = false
    AND (an.snoozed_until IS NULL OR an.snoozed_until <= NOW())
  ORDER BY
    CASE an.severity
      WHEN 'critical' THEN 1
      WHEN 'warning' THEN 2
      ELSE 3
    END,
    an.created_at DESC;
END;
$$;

-- 7. Function to synchronize pro-forma inputs to actual operational revenue
CREATE OR REPLACE FUNCTION public.rpc_sync_proforma_to_actuals(p_deal_id UUID, p_actual_monthly_rent NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deal RECORD;
  v_updated_inputs JSONB;
BEGIN
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;

  v_updated_inputs := v_deal.inputs;
  v_updated_inputs := jsonb_set(v_updated_inputs, '{grossRentPerMonth}', to_jsonb(p_actual_monthly_rent));
  v_updated_inputs := jsonb_set(v_updated_inputs, '{grossRentAnnual}', to_jsonb(p_actual_monthly_rent * 12.0));
  IF v_updated_inputs ? 'monthlyRent' THEN
    v_updated_inputs := jsonb_set(v_updated_inputs, '{monthlyRent}', to_jsonb(p_actual_monthly_rent));
  END IF;

  UPDATE public.deals
  SET
    inputs = v_updated_inputs,
    updated_at = NOW()
  WHERE id = p_deal_id;

  -- Dismiss the variance notification for this deal
  UPDATE public.app_notifications
  SET
    is_dismissed = true,
    is_read = true,
    updated_at = NOW()
  WHERE deal_id = p_deal_id AND type = 'revenue_variance';

  RETURN jsonb_build_object(
    'success', true,
    'deal_id', p_deal_id,
    'new_monthly_rent', p_actual_monthly_rent,
    'new_annual_rent', p_actual_monthly_rent * 12.0,
    'message', 'Pro-forma successfully synchronized with actual operational revenue.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_capture_deal_baseline(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_evaluate_deal_notifications(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_sync_proforma_to_actuals(UUID, NUMERIC) TO authenticated, anon, service_role;
