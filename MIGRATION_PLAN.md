# MathTree: Compute-on-the-Fly Migration Plan

**Target framework:** no stored analysis. One pure math engine, run in the browser, called with `useMemo`.
The database stores only *facts* (deals, inputs, leases, payments, parcels). Everything derived
(projections, amortization, IRR, LTV, DSCR, equity) is computed from those facts on demand.

## Verified starting state

| Fact | Evidence |
|---|---|
| Users are served the **legacy** `project.html`, `dashboard.html`, `operations.html`, not the React app | `scripts/postbuild.js` copies them into `dist/`; Firebase serves static files before SPA routes |
| Legacy `PropertyMath` is a stub returning `deal.metrics` | `project.html:3203` |
| React studio gets metrics from the `calculate-deal-projections` edge function, seeded from `deal.metrics` | `src/lib/supabase/useDealProjections.ts` |
| The engine is pure and already import-friendly (only `import type`) | `supabase/functions/_shared/math-engine.ts` (1978 lines) |
| Three competing calculators: engine, `src/lib/math/pointInTime.ts`, SQL trigger `recompute_deal_metrics` | trigger in `20260924_*` migrations, live in DB |
| Stored analysis is read in: `DealCard`, `DashboardPage`, `OverviewTab`, `ProFormaTab`, `csvExport`, `useDealStore` | grep for `irr`, `cash_on_cash`, `year1_cashflow`, `metrics` |
| 3 prod deals have `metrics` with no `projections` (blank legacy page) | DB query |

## Decisions (2026-09-29)
- **Phase 0 skipped.** The only user is the owner, so nothing gets patched; everything ships together after the last phase. The `project.html` patch was reverted. The `useDealStore.ts` amortization fix stays (real React bug).
- **Expense ratio:** no global default. It is case by case per lease type. The 25% default added in `eab2c47` (`pointInTime.ts`) must be removed in Phase 4 in favour of explicit per-lease inputs.
- **Monte Carlo:** client-side in a Web Worker (Phase 2). The `simulate-monte-carlo` edge function is then retired.
- **SEO:** a React SPA does not help SEO. Marketing pages (`index.html`, `terms`, `privacy`) stay static. The authenticated app (dashboard, studio, operations) is React, which also suits agent-driven edits.
- **PDF brief:** `generate-pdf-brief` almost certainly reads stored metrics. It must be redesigned to compute from facts inside the function using the shared engine (Phase 6, investigated first).

## Rules for every phase
- Each phase is one PR-sized chunk that can ship alone and leaves the app working.
- Verification is targeted only: `npx tsc --noEmit` plus a single-file `npx vitest run <file> --reporter=dot`. No global test runs (AGENTS.md).
- Deploy gate: you run `npm run build`; if it is clean, push to main and deploy.
- Phases 0 to 4 are additive and safe. Phases 5 and 6 delete things and are gated on a parity checklist.

---

## Phase 0: SKIPPED (see Decisions)
**Goal:** stop the bleeding without changing architecture.
- Keep the `useDealStore.ts` amortization fix (the `maxMonths` caps the loan term bug).
- Keep the `project.html` compute-on-the-fly patch (no `dealId`, so nothing is persisted; sessionStorage cache).
- Decide on the `expRatio` default change (1% to 25%) from commit `eab2c47`; confirm it is intended.
- **Done when:** `tsc --noEmit` exits 0; the 3 broken deals render on the legacy page.
- **Removed later** in Phase 5 with the legacy page.

## Phase 1: Engine importable in the browser (DONE)
**Goal:** one engine, usable from `src/`.
- Confirm `_shared/math-engine.ts` and `_shared/types.ts` have no Deno-only APIs (`Deno.*`, `npm:`/`std/` specifiers, `.ts` import suffixes that Vite rejects).
- Expose them through a Vite/tsconfig alias (`@engine`) or move to `src/lib/engine/` with the edge functions importing from there. Prefer a single source directory to avoid copies.
- Add `src/lib/engine/index.ts` re-exporting `calculateProjections`, `calculateMonthlyProjections`, `calculateTaxMetrics`, `calculateSensitivityMatrix`, `runMonteCarloSimulation`, `aggregatePortfolio`, `calculateHoldingPeriodWealth`.
- Add one golden-file vitest (`engine.golden.test.ts`) that runs 2 to 3 real deal inputs and snapshots headline outputs, so later phases can prove nothing drifted.
- **Files:** `vite.config.ts`, `tsconfig.json`, `supabase/functions/_shared/*`, new `src/lib/engine/index.ts`.
- **Done when:** `tsc --noEmit` exit 0; `vite build` succeeds; golden test passes. No user-visible change.

## Phase 2: React Deal Studio computes locally (DONE)
**Goal:** the studio no longer needs stored metrics or the network for math.
- New hook `useComputedMetrics(deal, overrides)` = `useMemo` over inputs (debounce only for typing).
- Replace `useDealProjections` usage in `DealStudioPage.tsx`. Sensitivity and Monte Carlo stay lazy (tab-active only); move Monte Carlo to a Web Worker if it exceeds about 50 ms.
- Keep `useDealProjections` only if the edge function is retained for Monte Carlo; otherwise delete it.
- Stop reading `deal.metrics` in `DealStudioPage`, `OverviewTab`, `ProFormaTab`, `DebtTab`, `csvExport`.
- **Done when:** studio renders all tabs with the network offline for math; the 3 previously blank deals render; golden test unchanged.

## Phase 3: Dashboard and Operations compute locally (DONE)
**Goal:** list views stop reading `irr` / `cash_on_cash` / `year1_cashflow` / `metrics` columns.
- `DealCard`, `DashboardPage`: compute per deal with a memoised `computeDealSummary(deal)` (N deals x ms is fine). Use `aggregatePortfolio` for the scorecards.
- `useDealStore` portfolio equity/LTV: derive from the engine's amortization schedule (replaces the schedule call I patched).
- `OperationsPage`: audit for any use of stored analysis; rent roll and payments stay as facts.
- **Done when:** dashboard totals match the legacy dashboard within rounding for 3 sample portfolios.

## Phase 4: Collapse duplicate calculators (DONE)
**Goal:** exactly one amortization / valuation implementation (the `maxMonths` bug was drift between copies).
- Make `src/lib/math/pointInTime.ts` a thin layer over the engine (point-in-time = slice of the engine's monthly schedule), or delete overlapping functions.
- Keep `types.ts` as the single type source.
- **Done when:** `pointInTime.ts` no longer contains its own amortization or projection loops; golden test passes.

## Phase 5: Cutover, retire the legacy pages (destructive, gated)
**Goal:** users get the React app.
- **Parity checklist first** (you sign off): dashboard cards, create-project wizard, studio 7 tabs, edit modal, scenario matrix, share/collaboration, PDF brief, rent roll, log payment, entity switcher, demo mode, login redirect.
- `scripts/postbuild.js`: remove `dashboard.html`, `project.html`, `operations.html`, `project-*.html` from `RUNTIME_FILES`. Move them to `legacy/` (not deployed) for reference.
- `firebase.json`: add SPA rewrites (`/dashboard`, `/project`, `/operations`, `/app` to `/app.html`). Keep static `index.html`, `terms`, `privacy`, `reconcile`, `session.js`.
- Check every legacy redirect target (`dashboard.html`, `project.html?id=`) resolves through the existing React route aliases in `App.tsx`.
- Remove the Phase 0 `project.html` patch (moot).
- **Rollback:** revert the `postbuild.js` and `firebase.json` commit and redeploy.
- **Done when:** deployed preview channel passes the parity checklist; then production.

## Phase 6: Backend cleanup (destructive, only after Phase 5 is live)
**Goal:** the database stops computing or storing analysis.
- Migration A: drop trigger `trg_deals_recompute_metrics` and functions `recompute_deal_metrics`, `recompute_deal_financial_metrics`.
- Edge functions: remove the persist step from `calculate-deal-projections` (or retire it); audit `cron-daily-lease-monitor`, `generate-pdf-brief`, `edit-property-inputs`, `create-project` for reads/writes of stored `metrics` and switch them to compute-in-function.
- Migration B (a release later): null out, then drop, `deals.metrics`, `irr`, `cash_on_cash`, `equity_multiple`, `year1_cashflow`, `npv`, `metrics_computed_at`. Keep `total_equity` only if used as a fact. Check that no view or RLS policy depends on them first.
- **Done when:** no code path reads or writes stored analysis; `grep` for the column names in `src/` and `supabase/functions/` returns nothing.

## Phase 7: Hardening and docs
- Local cache only for *fetched facts* (TanStack Query or a small store), never for computed analysis.
- Web Worker for Monte Carlo if not done in Phase 2.
- Update `ARCHITECTURE.md` (the compute-on-the-fly rule, single engine, no stored analysis) so future agents do not reintroduce stored metrics.
- Add a lint or grep check in the build to fail on the removed column names.

## Order and dependencies
`0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7`
- 2, 3, 4 depend on 1.
- 5 depends on 2 and 3 (no deletes until React has parity).
- 6 depends on 5 (the legacy pages need the trigger and stored metrics until they are gone).

## Open questions for you
1. Is `expRatio` 25% (from `eab2c47`) intended for gross leases? (Phase 0)
2. Keep the `calculate-deal-projections` edge function for Monte Carlo, or move everything client-side? (Phase 2)
3. Does `index.html` (legacy landing and login, 2600 lines) stay static for now, or is a React login page in scope? (Phase 5)
4. Are the `irr` / `cash_on_cash` columns used by anything outside this repo (reports, Supabase dashboards)? (Phase 6)


## Progress log (2026-09-29)

**Phases 1 to 4 complete.** `tsc --noEmit` exit 0; `vitest` 20 tests pass in 3 files (engine golden, compute layer, point-in-time).

Deviations and findings:
- **No Web Worker.** 1,000 engine runs take about 16 ms, so Monte Carlo runs on the main thread. The simulation moved to `_shared/monte-carlo.ts` and is scored by the shared engine (it was a fourth private copy of the math). The edge function is now a thin wrapper, to be deleted in Phase 6.
- **Contract bugs fixed (these were causing blank or NaN UI):**
  - Sensitivity: engine returns `{ matrix, rowValues, colValues }`, UI expects `{ capRateSteps, vacancySteps, irrGrid }`; adapter added.
  - Monte Carlo: UI read `var95`, `probabilityPositive`, `minIrr`, `maxIrr` that the edge function never returned; now provided.
  - Projections: UI read `endingLoanBalance` / `grossPotentialRent`; engine emits `loanBalanceRemaining` / `grossPotentialIncome`; reconciled in `compute.ts`.
  - `calculateTaxMetrics` compared the raw asset class, so `residential` got the 39-year schedule instead of 27.5.
  - `useDealStore` portfolio fallback selected a `loan_amount` column that does not exist on `deals`.
- **Stored-analysis fields removed** from `DealRecord`, `mapSupabaseDeal`, `BENCHMARK_DEAL`. `tsc` proves nothing in `src/` still reads them.
- **`pointInTime.ts` 703 to about 330 lines.** Lease resolver, monthly amortization and calendar projections now come from the engine; the 25% default expense ratio is gone (engine uses explicit inputs only).
- `useDealProjections.ts` and `invokeSimulateMonteCarlo` deleted.

**Added to the Phase 6 audit list:**
- RPC `get_portfolio_equity_and_amortization` and the view `view_deal_equity_summary` (migration `20260922_realtime_equity_and_amortization.sql`): server-side portfolio math, no longer called by the app.
- `manage-scenarios` stores a `metrics` snapshot per scenario run for diffs; derive from each run's stored `inputs` instead.
- `generate-pdf-brief`, `cron-daily-lease-monitor`, `create-project`, `edit-property-inputs`: check for reads and writes of stored metrics.
- The `view_...` SQL views that join `d.metrics` (`20260914_notification_hub_and_variance_tracking.sql`).

## Phase 4b: Legacy UI parity (IN PROGRESS, required before Phase 5)

Rule: **copy the legacy markup and Tailwind classes verbatim into JSX**, then bind real data. Legacy loads Plus Jakarta Sans at weights 300 to 800 only; `app.html` now matches, and the Tailwind brand/accent palette matches legacy.

| Area | Legacy feature | React status |
|---|---|---|
| Header | Brand, hub switcher, Alerts, Collaborators, Profile, Sign Out | **Done** (`ConnectedHeader`) |
| Dashboard | Hero + greeting, KPI tiles, refine sidebar, deal cards (whole card clickable, 3-dot menu) | **Done** |
| Dashboard | Collaborators hub, Share-deal modal, shared-with-me deals | **Done** |
| Alerts | Action Center drawer (legacy button was dead since 9/24; rebuilt on `rpc_evaluate_deal_notifications`) | **Done** |
| Profile | Name, hurdle rate, hold period, tier, exit-cap method + LLC portal link | **Partial**: missing property class, live NPV preview, associated-companies strip |
| Entities | LLC manager (create, delete, attach to a property, opened from Profile and from alerts) | **Done** |
| Dashboard | "View Pitch Deck" menu item, exit-demo banner, typed-delete confirm parity | Missing / unverified |
| Operations | Header actions (Alert Emails, Add Lease), filters (entity, property, scope, month), KPI tiles, performance table, rent roll with all row actions, Alert Settings, Audit Trail, Edit Lease (+ escalation editor), vacant-property rows | **Done** (logic in `src/lib/operations/rentRoll.ts`, tested) |
| Studio header, summary card, auditor banner | Module dropdown + arrows + Alt+Arrow, deal identity, parcel popover, APN badge, share, menu, scenario summary, risk warnings | **Done** |
| Studio tabs | Overview, Pro-Forma (incl. monthly schedule + variance banner), Debt, Property (dossier, parcel linker, multi-parcel) | **Done** (legacy class match 90%+) |
| Studio tabs | Diligence, Sensitivity (+ Monte Carlo), Tax (+ refinance) | Ported (Sensitivity 2D heatmap + Monte Carlo; Tax wealth studio, MACRS table, refinance simulator; all computed on demand) |
| Studio modals | Scenario history (computed diffs), Edit Inputs (full legacy form), snapshots | History done; Edit Inputs form not yet |
| Services | `address-service.js` (GIS search, assessor lookups) ported to `src/lib/services/addressService.ts` (was never loaded by React, so GIS sync did nothing) | **Done** |

Phase 5 cutover done in code (legacy pages moved to legacy/, postbuild ships only index/terms/privacy/session.js, SPA rewrites in firebase.json, AuthGate + inactivity logout in React). Phase 6: pdf-brief recomputes from inputs; retired function sources removed from the repo (create-project, calculate-deal-projections, edit-property-inputs, manage-scenarios, simulate-monte-carlo; still deployed live until deleted by hand); Migration A (supabase/migrations/20260930_retire_stored_analysis_triggers.sql) APPLIED live 2026-09-30; the five retired edge functions were DELETED live the same day; generate-pdf-brief redeployed (v24). Migration B (drop stored columns) still needs views view_deal_performance_tracking and view_portfolio_aggregates plus functions rpc_get_portfolio_operations_summary, rpc_get_user_entities, execute_scheduled_rent_escalations, rpc_capture_deal_baseline, rpc_recalculate_deal, rpc_*_parameter_* rewritten first. Lease-expiry assumptions (per lease: none | extension option | vacancy then re-let with rent change and leasing costs) added to the engine, Edit Inputs and the risk auditor. Public /reconcile page (email one-click Confirm/Snooze/Undo landing) ported to React (ReconcilePage.tsx); edge function unchanged. Dashboard Edit Project Inputs now reuses the full Edit Inputs form; the New Project wizard is a full port of the legacy 4-step wizard (asset-specific steps, GIS address search + assessor card, multi-parcel package, rehab mode, financing types) that inserts facts only. Studio tab class parity is 22/22, 22/23, 115/115, 63/64, 62/64, 39/39, 77/77 (leftovers are React-only disabled states). Profile modal (associated companies, live NPV preview via engine) and dashboard leftovers (Pitch Deck menu item, demo/welcome banners, legacy typed-delete modal) are done. Next: owner parity sign-off, then Phase 5. Edit Inputs modal is now the full legacy form (live engine preview, ARM/IO, rehab mode, exit-cap timing, lease terms, GIS address search) and saves facts only via patchDeal + scenario run.

Phase 6 additions from this work:
- `rpc_evaluate_deal_notifications(p_user_id)` is SECURITY DEFINER and trusts the passed user id: any signed-in user can evaluate (and write alerts for) another user's portfolio. It should use `auth.uid()`.
- `rpc_sync_proforma_to_actuals` rewrites deal inputs (facts), which is fine, but check it does not also write metrics.
- `configure-lease-terms` and `manage-entities` edge functions: audit for writes of stored analysis.

## Scenario runs ("What if I buy at this price / finance at this rate?") (decided 2026-09-29)
- **Stored:** only each run's **inputs** (plus name, notes, baseline flag, author, timestamp) in `deal_parameter_history`. This is the "single JSON of past runs": one `inputs` JSON per run, row-level security already scopes it to the owner and permitted collaborators.
- **Computed, never stored:** which parameters moved, and how IRR, cash-on-cash, cash flow, cap rate, equity multiple and DSCR changed. `src/lib/scenarios.ts` runs the shared engine on each run's inputs and diffs consecutive runs, so history can never go stale when the model improves.
- **Recording:** automatic after any saved edit (Edit Inputs, applying the assessed value, restoring a run) when a tracked parameter actually changed; owned assets are frozen; the newest 5 automatic runs are kept, named snapshots never pruned. The client talks to the table directly; the `manage-scenarios` edge function is no longer used by React.
- **Phase 6:** delete the `manage-scenarios` function (legacy pages still call it until retired) and drop `deal_parameter_history.metrics`, `input_diff`, `metric_diff` after clearing them.
