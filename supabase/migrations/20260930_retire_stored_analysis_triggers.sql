-- Phase 6, Migration A: the database stops computing and storing deal analysis.
--
-- Analysis (IRR, NPV, DSCR, cash flow, amortization, projections ...) is computed on demand from a deal's inputs by
-- the shared engine (supabase/functions/_shared/math-engine.ts). Three DB-side copies of that math wrote stored
-- results on every save; they are removed here. The stored columns themselves are dropped later (Migration B),
-- after the views and functions that still mention them are rewritten.
--
-- APPLIED to the live database on 2026-09-30 (after the React build was deployed).

-- 1. Triggers that recompute stored analysis
DROP TRIGGER IF EXISTS trg_deals_recompute_metrics ON public.deals;
DROP TRIGGER IF EXISTS trg_recompute_on_profile_change ON public.profiles;

-- 2. fn_deals_before_save keeps only its fact-normalising duties (timestamp + purchase price); it no longer
--    writes total_equity / cash_on_cash / year1_cashflow / irr / equity_multiple / metrics.
CREATE OR REPLACE FUNCTION public.fn_deals_before_save()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  IF NEW.inputs IS NOT NULL THEN
    NEW.purchase_price := COALESCE(
      NULLIF(NEW.inputs->>'purchasePrice', '')::numeric,
      NULLIF(NEW.inputs->>'price', '')::numeric,
      NEW.purchase_price,
      0
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. The functions those triggers called
DROP FUNCTION IF EXISTS public.recompute_deal_metrics();
DROP FUNCTION IF EXISTS public.recompute_deal_financial_metrics();
DROP FUNCTION IF EXISTS public._trg_recompute_on_profile_change();
DROP FUNCTION IF EXISTS public.compute_deal_metrics(uuid);
