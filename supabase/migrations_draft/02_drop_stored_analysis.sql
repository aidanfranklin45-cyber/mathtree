-- DRAFT 02 (Migration B): drop the stored-analysis columns.   *** NOT APPLIED. Irreversible data loss. ***
--
-- Prerequisites (all must be true first):
--   [x] React app deployed and the legacy pages gone                      (done 2026-09-30)
--   [x] Migration A applied (no trigger writes these columns any more)    (done 2026-09-30)
--   [ ] 01_lock_down_rpc_security.sql applied (it drops rpc_recalculate_deal and rpc_capture_deal_baseline, which read them)
--   [x] Owner confirmed nothing OUTSIDE this repo reads these columns (only the app and edge functions such as the PDF brief)
--   [ ] A database backup / point-in-time-recovery marker exists just before running this
--
-- What is lost: the values currently stored in deals.irr / npv / cash_on_cash / equity_multiple / year1_cashflow /
-- total_equity / metrics / metrics_computed_at and deal_parameter_history.metrics / input_diff / metric_diff.
-- All of these are live derived values; the app recomputes them from inputs on demand. The inputs stay
-- (deals.inputs, history inputs). deal_baselines keeps its frozen expectations.

BEGIN;

-- 1. Views built on the stored columns (not used by the app; only referenced in generated types)
DROP VIEW IF EXISTS public.view_deal_performance_tracking;
DROP VIEW IF EXISTS public.view_portfolio_aggregates;

-- 2. deals: stored analysis
ALTER TABLE public.deals
  DROP COLUMN IF EXISTS metrics,
  DROP COLUMN IF EXISTS irr,
  DROP COLUMN IF EXISTS equity_multiple,
  DROP COLUMN IF EXISTS cash_on_cash,
  DROP COLUMN IF EXISTS year1_cashflow,
  DROP COLUMN IF EXISTS total_equity,          -- derived (down payment + rehab + closing); computed on demand
  DROP COLUMN IF EXISTS npv,
  DROP COLUMN IF EXISTS metrics_computed_at;

-- 3. scenario history: runs keep only their inputs (diffs and metrics are recomputed when the modal opens)
ALTER TABLE public.deal_parameter_history
  DROP COLUMN IF EXISTS metrics,
  DROP COLUMN IF EXISTS input_diff,
  DROP COLUMN IF EXISTS metric_diff;

-- 4. deal_baselines is NOT touched: it is a deliberate, frozen record of the pro-forma at purchase (what we expected),
--    used to compare actual performance with that expectation. See 01 section 3e.

COMMIT;

-- After applying: regenerate src/lib/supabase/types.ts from the live schema and remove the column names from any code
-- that still mentions them (the build grep check in Phase 7 will fail on them).
