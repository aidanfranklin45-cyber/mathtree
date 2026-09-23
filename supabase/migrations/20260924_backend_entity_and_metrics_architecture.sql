-- Migration: 20260924_backend_entity_and_metrics_architecture.sql
-- Description: Dynamic Postgres Financial Recalculation Trigger & Backend Entity Management RPCs

-- ============================================================================
-- 1. EXTEND ENTITIES TABLE WITH ENTITY TYPES
-- ============================================================================
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'llc';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_entity_type'
  ) THEN
    ALTER TABLE public.entities ADD CONSTRAINT check_entity_type 
    CHECK (entity_type IN ('llc', 'series_llc', 'lp', 'corporation', 'trust', 'individual', 'tic'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_entities_user_type ON public.entities(user_id, entity_type);

-- ============================================================================
-- 2. DYNAMIC METRICS RECALCULATION TRIGGER ON DEALS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recompute_deal_financial_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inputs jsonb := COALESCE(NEW.inputs, '{}'::jsonb);
  v_price numeric;
  v_down_pct numeric;
  v_loan numeric;
  v_gross_rent numeric;
  v_vacancy_rate numeric;
  v_opex_ratio numeric;
  v_effective_gross numeric;
  v_opex numeric;
  v_noi numeric;
  v_cap_rate numeric;
  v_interest_rate numeric;
  v_loan_term integer;
  v_annual_debt_service numeric := 0;
  v_cash_flow numeric := 0;
  v_cash_on_cash numeric := 0;
  v_initial_cash numeric := 0;
  v_monthly_rate numeric;
  v_num_payments integer;
  v_monthly_debt_service numeric;
BEGIN
  -- 1. Extract purchase price
  v_price := COALESCE(NEW.purchase_price, (v_inputs->>'purchasePrice')::numeric, 0);
  NEW.purchase_price := v_price;

  -- 2. Down Payment & Loan Amount
  v_down_pct := COALESCE((v_inputs->>'downPaymentPercent')::numeric, 25.0);
  v_loan := GREATEST(0, ROUND(v_price * (1.0 - (v_down_pct / 100.0)), 2));

  v_initial_cash := ROUND(
    v_price * (v_down_pct / 100.0) +
    COALESCE((v_inputs->>'rehabCosts')::numeric, (v_inputs->>'rehabBudget')::numeric, 0) +
    COALESCE((v_inputs->>'closingCosts')::numeric, 0),
    2
  );
  NEW.total_equity := GREATEST(0, v_initial_cash);

  -- 3. Gross Rent Annual
  v_gross_rent := COALESCE(
    (v_inputs->>'grossRentAnnual')::numeric,
    ((v_inputs->>'monthlyRent')::numeric * 12.0),
    ((v_inputs->>'grossRentPerMonth')::numeric * 12.0),
    0
  );

  -- 4. Vacancy & OpEx
  v_vacancy_rate := COALESCE((v_inputs->>'vacancyRate')::numeric, 5.0);
  v_opex_ratio := COALESCE(
    (v_inputs->>'operatingExpenseRatio')::numeric,
    (v_inputs->>'expenseRatio')::numeric,
    35.0
  );

  v_effective_gross := v_gross_rent * (1.0 - (v_vacancy_rate / 100.0));
  v_opex := v_gross_rent * (v_opex_ratio / 100.0);
  v_noi := ROUND(v_effective_gross - v_opex, 2);

  -- 5. Cap Rate
  IF v_price > 0 THEN
    v_cap_rate := ROUND((v_noi / v_price) * 100.0, 2);
  ELSE
    v_cap_rate := 0;
  END IF;

  -- 6. Debt Service
  v_interest_rate := COALESCE((v_inputs->>'interestRate')::numeric, 6.5);
  v_loan_term := COALESCE((v_inputs->>'loanTerm')::integer, 30);
  IF v_loan > 0 AND v_interest_rate > 0 AND v_loan_term > 0 THEN
    v_monthly_rate := (v_interest_rate / 100.0) / 12.0;
    v_num_payments := v_loan_term * 12;
    v_monthly_debt_service := v_loan * (v_monthly_rate * POWER(1.0 + v_monthly_rate, v_num_payments)) / (POWER(1.0 + v_monthly_rate, v_num_payments) - 1.0);
    v_annual_debt_service := ROUND(v_monthly_debt_service * 12.0, 2);
  ELSE
    v_annual_debt_service := 0;
  END IF;

  -- 7. Net Cash Flow & Cash on Cash
  v_cash_flow := ROUND(v_noi - v_annual_debt_service, 2);
  IF v_initial_cash > 0 THEN
    v_cash_on_cash := ROUND((v_cash_flow / v_initial_cash) * 100.0, 2);
  ELSE
    v_cash_on_cash := 0;
  END IF;

  NEW.year1_cashflow := v_cash_flow;
  NEW.cash_on_cash := v_cash_on_cash;

  -- 8. Merge computed metrics into NEW.metrics jsonb
  NEW.metrics := COALESCE(NEW.metrics, '{}'::jsonb) || jsonb_build_object(
    'noi', v_noi,
    'netOperatingIncome', v_noi,
    'capRate', v_cap_rate,
    'effectiveGrossIncome', ROUND(v_effective_gross, 2),
    'operatingExpenses', ROUND(v_opex, 2),
    'annualDebtService', v_annual_debt_service,
    'year1CashFlow', v_cash_flow,
    'cashOnCash', v_cash_on_cash,
    'purchasePrice', v_price,
    'loanAmount', v_loan,
    'initialEquity', v_initial_cash,
    'initialCashInvested', v_initial_cash,
    'lastDatabaseRecalculation', now()
  );

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_recompute_metrics ON public.deals;
CREATE TRIGGER trg_deals_recompute_metrics
BEFORE INSERT OR UPDATE OF inputs, purchase_price
ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.recompute_deal_financial_metrics();

-- ============================================================================
-- 3. BACKEND-DRIVEN ENTITY RETRIEVAL RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_get_user_entities(p_is_demo boolean DEFAULT false)
RETURNS TABLE (
  id UUID,
  name TEXT,
  entity_type TEXT,
  formation_state TEXT,
  formation_date DATE,
  bank_name TEXT,
  ein TEXT,
  notes TEXT,
  deal_count BIGINT,
  total_equity NUMERIC,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Strict multi-tenant isolation: demo mode returns synthetic demo entities
  IF p_is_demo AND auth.uid() IS NULL THEN
    RETURN QUERY
    SELECT
      '00000000-0000-0000-0000-000000000001'::uuid AS id,
      'Apex Real Estate Capital LLC'::text AS name,
      'llc'::text AS entity_type,
      'DE'::text AS formation_state,
      '2022-01-15'::date AS formation_date,
      'JPMorgan Chase (*4892)'::text AS bank_name,
      'XX-XXX1234'::text AS ein,
      'Master holding entity for commercial retail'::text AS notes,
      2::bigint AS deal_count,
      1250000.00::numeric AS total_equity,
      now() - interval '60 days' AS created_at,
      now() AS updated_at
    UNION ALL
    SELECT
      '00000000-0000-0000-0000-000000000002'::uuid AS id,
      'Cascade Property Holdings LLC'::text AS name,
      'llc'::text AS entity_type,
      'WA'::text AS formation_state,
      '2023-04-10'::date AS formation_date,
      'First Interstate Bank (*1104)'::text AS bank_name,
      'XX-XXX5678'::text AS ein,
      'Operating entity for industrial & flex assets'::text AS notes,
      1::bigint AS deal_count,
      450000.00::numeric AS total_equity,
      now() - interval '30 days' AS created_at,
      now() AS updated_at;
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.name,
    COALESCE(e.entity_type, 'llc') AS entity_type,
    e.formation_state,
    e.formation_date,
    e.bank_name,
    e.ein,
    e.notes,
    COUNT(d.id)::bigint AS deal_count,
    COALESCE(SUM(d.total_equity), 0)::numeric AS total_equity,
    e.created_at,
    e.updated_at
  FROM public.entities e
  LEFT JOIN public.deals d ON d.entity_id = e.id AND d.user_id = auth.uid()
  WHERE e.user_id = auth.uid()
  GROUP BY e.id
  ORDER BY e.name ASC;
END;
$$;

-- ============================================================================
-- 4. BACKEND-DRIVEN ENTITY CRUD RPCS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_create_or_update_entity(
  p_name TEXT,
  p_entity_type TEXT DEFAULT 'llc',
  p_formation_state TEXT DEFAULT NULL,
  p_bank_name TEXT DEFAULT NULL,
  p_ein TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_entity RECORD;
  v_type TEXT := LOWER(COALESCE(p_entity_type, 'llc'));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RAISE EXCEPTION 'Entity name is required';
  END IF;

  IF v_type NOT IN ('llc', 'series_llc', 'lp', 'corporation', 'trust', 'individual', 'tic') THEN
    v_type := 'llc';
  END IF;

  IF p_id IS NOT NULL THEN
    -- Update existing entity belonging to authenticated user
    UPDATE public.entities
    SET
      name = TRIM(p_name),
      entity_type = v_type,
      formation_state = NULLIF(TRIM(p_formation_state), ''),
      bank_name = NULLIF(TRIM(p_bank_name), ''),
      ein = NULLIF(TRIM(p_ein), ''),
      notes = NULLIF(TRIM(p_notes), ''),
      updated_at = now()
    WHERE id = p_id AND user_id = v_user_id
    RETURNING * INTO v_entity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Entity not found or access denied';
    END IF;
  ELSE
    -- Insert new entity
    INSERT INTO public.entities (
      user_id,
      name,
      entity_type,
      formation_state,
      bank_name,
      ein,
      notes,
      created_at,
      updated_at
    ) VALUES (
      v_user_id,
      TRIM(p_name),
      v_type,
      NULLIF(TRIM(p_formation_state), ''),
      NULLIF(TRIM(p_bank_name), ''),
      NULLIF(TRIM(p_ein), ''),
      NULLIF(TRIM(p_notes), ''),
      now(),
      now()
    )
    RETURNING * INTO v_entity;
  END IF;

  RETURN to_jsonb(v_entity);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_delete_entity(p_entity_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Safely unlink any deals linked to this entity before deleting
  UPDATE public.deals
  SET entity_id = NULL, updated_at = now()
  WHERE entity_id = p_entity_id AND user_id = v_user_id;

  -- Delete the entity
  DELETE FROM public.entities
  WHERE id = p_entity_id AND user_id = v_user_id;

  RETURN jsonb_build_object('success', true, 'deleted_id', p_entity_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_attach_entity_to_deal(p_deal_id UUID, p_entity_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_deal RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify target entity belongs to user if not unlinking
  IF p_entity_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id = p_entity_id AND user_id = v_user_id) THEN
      RAISE EXCEPTION 'Entity not found or access denied';
    END IF;
  END IF;

  UPDATE public.deals
  SET
    entity_id = p_entity_id,
    updated_at = now()
  WHERE id = p_deal_id AND user_id = v_user_id
  RETURNING * INTO v_deal;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found or access denied';
  END IF;

  -- Automatically dismiss any open entity action notifications
  UPDATE public.app_notifications
  SET
    is_dismissed = true,
    is_read = true,
    updated_at = now()
  WHERE deal_id = p_deal_id
    AND action_type = 'open_entity_modal'
    AND user_id = v_user_id;

  RETURN jsonb_build_object('success', true, 'deal_id', p_deal_id, 'entity_id', p_entity_id);
END;
$$;

-- ============================================================================
-- 5. FUNCTION GRANTS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.rpc_get_user_entities(boolean) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_or_update_entity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_delete_entity(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_attach_entity_to_deal(UUID, UUID) TO authenticated, service_role;
