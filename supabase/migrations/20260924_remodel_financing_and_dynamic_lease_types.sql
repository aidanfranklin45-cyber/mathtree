-- ==============================================================================
-- MathTree Migration: Remodel/Rehab Financing Modes & Dynamic Lease Structures
-- ==============================================================================

-- 1. Upgrade Trigger Function: Support Remodel Financing Modes in Deals
CREATE OR REPLACE FUNCTION public.recompute_deal_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inputs jsonb := COALESCE(NEW.inputs, '{}'::jsonb);
  v_price numeric;
  v_down_pct numeric;
  v_down_payment numeric;
  v_base_loan numeric;
  v_total_basis numeric;
  v_loan numeric;
  v_rehab numeric;
  v_closing numeric;
  v_rehab_mode text;
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
  v_lease_type text;
BEGIN
  -- 1. Extract purchase price
  v_price := COALESCE(NEW.purchase_price, (v_inputs->>'purchasePrice')::numeric, 0);
  NEW.purchase_price := v_price;

  -- 2. Down Payment, Remodel / Closing Costs & Financing Mode
  v_down_pct := COALESCE((v_inputs->>'downPaymentPercent')::numeric, 25.0);
  v_rehab := COALESCE((v_inputs->>'rehabCosts')::numeric, (v_inputs->>'rehabBudget')::numeric, 0);
  v_closing := COALESCE((v_inputs->>'closingCosts')::numeric, 0);
  v_rehab_mode := COALESCE(v_inputs->>'rehabFinancingMode', CASE WHEN (v_inputs->>'financeRehabAndClosingCosts')::boolean THEN 'roll_into_loan' ELSE 'out_of_pocket' END);

  IF v_rehab_mode = 'roll_into_loan' THEN
    -- Remodel and closing costs are looped into total project basis and senior debt package
    v_total_basis := v_price + v_rehab + v_closing;
    v_down_payment := ROUND(v_total_basis * (v_down_pct / 100.0), 2);
    v_loan := GREATEST(0, v_total_basis - v_down_payment);
    v_initial_cash := v_down_payment;
  ELSE
    -- Remodel and closing costs paid out-of-pocket on top of down payment
    v_down_payment := ROUND(v_price * (v_down_pct / 100.0), 2);
    v_loan := GREATEST(0, v_price - v_down_payment);
    v_initial_cash := v_down_payment + v_rehab + v_closing;
  END IF;

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

  -- 6. Debt Service (Calculated on total active loan)
  v_interest_rate := COALESCE((v_inputs->>'interestRate')::numeric, 6.5);
  v_loan_term := COALESCE((v_inputs->>'loanTerm')::integer, (v_inputs->>'loanTermYears')::integer, 30);
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

  v_lease_type := COALESCE(v_inputs->>'leaseType', 'Gross');

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
    'baseLoanAmount', v_base_loan,
    'rehabCosts', v_rehab,
    'closingCosts', v_closing,
    'rehabFinancingMode', v_rehab_mode,
    'isRehabFinanced', (v_rehab_mode = 'roll_into_loan'),
    'initialEquity', v_initial_cash,
    'initialCashInvested', v_initial_cash,
    'leaseType', v_lease_type,
    'lastDatabaseRecalculation', now()
  );

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Ensure trigger is active
DROP TRIGGER IF EXISTS trg_deals_recompute_metrics ON public.deals;
CREATE TRIGGER trg_deals_recompute_metrics
BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.recompute_deal_metrics();
