# MathTree Architecture

Real-estate underwriting (pro-forma, debt, tax, sensitivity, Monte Carlo) plus property operations (leases, rent,
recoveries) for owned and prospect deals. Read this before guessing at schemas, formulas or where a component lives.
Decision history and status for specific areas live in the `*_PLAN.md` files at the repo root.

## 1. The one rule: the database stores facts, never results

- The database holds **facts**: deals and their `inputs`, leases, units, payments, rent increases, parcels, recoveries.
- Everything **derived** (projections, amortization, IRR, NPV, LTV, DSCR, cap rate, equity, tax shield, sensitivity,
  Monte Carlo) is computed on demand from those facts by **one shared engine**. No stored metrics columns, no SQL
  calculators, no second calculator in the UI. (Background: `MIGRATION_PLAN.md`; stored analysis was dropped by
  `supabase/migrations_draft/02_drop_stored_analysis.sql`.)
- **One deliberate exception: baselines.** `deal_baselines` is a frozen snapshot of what the engine said when a deal was
  underwritten/bought (`src/lib/baselines/`). It is captured once, stamped with `ENGINE_VERSION`, and never recomputed.
- Operational records (payments, leases) are the record of what happened. They never rewrite a deal's underwriting
  `inputs`. Compare actuals against the baseline instead.
- Plans and what-ifs (scenarios, remodels) are stored as **inputs/overrides**, never as their results.

## 2. Repository map

```
app.html, src/main.tsx      React SPA entry (the only authenticated UI)
index.html, terms.html,     Static marketing / legal pages, copied into dist/ by scripts/postbuild.js
privacy.html, session.js    (session.js = inactivity logout)
src/
  App.tsx                   Routes (react-router). AuthGate wraps everything except /login, /reconcile, /demo-brief
  pages/                    One file per route (see §5)
  components/<area>/        UI by area: dashboard, studio (+tabs, modals), operations, compare, brief, layout, collaboration
  stores/useDealStore.ts    Loads/saves the active deal and portfolio from Supabase
  lib/
    engine/                 Browser side of the engine: index.ts (re-exports @engine), compute.ts (computeDealMetrics,
                            memoised), version.ts (ENGINE_VERSION), useComputedMetrics.ts, golden/snapshot tests
    math/                   UI types (DealRecord, DealInputs, DealMetrics) and pointInTime.ts (today's value/debt/equity
                            from engine output; not a separate calculator)
    supabase/               client.ts (anon client, BENCHMARK_DEAL demo), types.ts (generated DB types), authHeaders.ts
    baselines/ compare/ remodel/ operations/ underwriting/ portfolio/ export/ services/ auth/
supabase/
  functions/_shared/        THE engine and shared rules (Deno + browser). Imported in the app as `@engine/*`
  functions/<name>/         Deno edge functions (see §4)
  migrations/               Historical SQL. The live schema was NOT built from this folder; treat it as reference
  migrations_draft/         Reviewed SQL applied by hand to production (all applied; README.md records order). Never re-run
legacy/                     Pre-React static pages, kept for reference only. Not deployed
```

Path aliases (`vite.config.ts`, `tsconfig.json`): `@/*` → `src/*`, `@engine/*` → `supabase/functions/_shared/*`.

## 3. The math engine

**Source of truth:** `supabase/functions/_shared/math-engine.ts` (pure TS, only `import type` plus sibling `_shared`
modules, so it runs in both Vite and Deno). Siblings: `monte-carlo.ts`, `remodel.ts`, `leaseExpiry.ts`, `types.ts`.

**How the app calls it:** always through `src/lib/engine/compute.ts`:

- `prepareEngineInputs(deal, overrides)` merges `deal.inputs` + overrides, fills `purchasePrice` from the column, drops an
  ARV that just echoes the assessed value, defaults `discountRate` to 8, and applies the investor's lease-expiry defaults.
- `computeDealMetrics(deal, overrides?)` runs `calculateProjections(assetClass, inputs)` and maps it to `DealMetrics`
  (bounded memo keyed by the exact inputs). What-ifs, scenarios and remodels are just `overrides`.
- Other entry points are re-exported from `src/lib/engine/index.ts` (sensitivity, down-payment matrix, tax/MACRS,
  amortization, IRR/NPV, refinance, target-price solver, scenario variants, portfolio aggregation, risk audit,
  `runMonteCarlo` / `createMonteCarloRunner`).

**Asset classes** (`normalizeAssetClass`): `single-family`, `multi-unit`, `commercial` (gross / NNN leases), `storage`.

**Key definitions** (per projection year, in `calculateProjections`):

| Metric | Definition |
|---|---|
| NOI | effective gross income − operating expenses |
| Cash flow | NOI − debt service − capex reserve − remodel cash cost (in the year it is spent) |
| Cash-on-cash | cash flow ÷ cumulative cash invested × 100 |
| Cap rate | NOI ÷ current property value × 100; **going-in cap uses the first full year** |
| DSCR | NOI ÷ debt service (null with no debt); **headline DSCR = first full year** (`firstFullYear`) |
| IRR / NPV | `calculateIRR` / `calculateNPV` on equity cash flows incl. sale proceeds at exit |
| Lease rent | `resolveLeaseMonthlyRent`: explicit leases with escalations; at expiry a lease renews on current terms unless it states extension / vacancy-then-re-let (`leaseExpiry.ts`) |

Year 1 can be a partial year (`operatingMonths`), which is why headline ratios use the first full year.

**Changing the math:** any change that alters a computed number (fixes included) must bump `ENGINE_VERSION` in
`src/lib/engine/version.ts` with a one-line changelog entry, and update the golden snapshot
(`src/lib/engine/engine.golden.test.ts`) deliberately. Never add a second calculator anywhere (UI, SQL, edge function).

**Monte Carlo** (`monte-carlo.ts`, see `MONTE_CARLO_PLAN.md`): seeded, runs in the browser in time slices via
`createMonteCarloRunner` so the page stays responsive and cancels when inputs change. Used by `SensitivityTab` and the brief.

**Remodel** (`remodel.ts`, `src/lib/remodel/`, see `REMODEL_PLAN.md`): an optional `remodel` block in inputs (capex,
downtime, rent step, value step, optional financing). The plan is stored as inputs; Live numbers change only when it is
committed.

## 4. Backend (Supabase)

Project ref `bgexwcepwbxvhxbpblhd`. The browser uses the anon key with the user's session; **every table is protected by
RLS** scoped to `user_id = auth.uid()` (plus `deal_shares` for shared deals). Demo deals (`is_demo`) are readable
anonymously for the landing page sample memo.

### Tables (facts)

Column lists are in `src/lib/supabase/types.ts` (regenerate it rather than hand-editing when the schema changes).

| Table | Holds |
|---|---|
| `deals` | One property/deal. `status` (`owned` / `prospect`), `asset_type`, `purchase_price`, `is_demo`, `entity_id`, and `inputs` (jsonb: every underwriting assumption, including leases, remodel plan) |
| `deal_baselines` | Frozen underwriting snapshot (`inputs_snapshot`, `metrics_snapshot`, headline projected numbers) |
| `deal_parameter_history` | Saved scenarios / input versions (`inputs`, `is_baseline`, `is_auto_run`) |
| `units` | Units of a deal (number, type, sqft, market rent, status) |
| `leases` | Operational leases: tenant, `monthly_rent`, dates, `term_type` (`fixed` / `month_to_month`), escalation fields, due day, grace days, `is_active`, `track_recoveries` |
| `rent_payments` | One row per lease per period: due/paid amounts and dates, status, snooze |
| `rent_increases` | Scheduled or applied rent changes (old/new rent, effective date, notice sent date) |
| `lease_recovery_terms` / `lease_recovery_items` | NNN recoveries (tax, insurance, CAM): terms and expected vs actual items |
| `compare_views` | Saved Compare studio boards (private): deals, scenarios, metrics and view as JSON settings, never computed numbers |
| `cam_reconciliations` | Annual CAM true-ups |
| `utility_meters` / `meter_readings` | Sub-metered utility billing |
| `parcels` | County GIS parcels attached to a deal (APN, assessed values, acres, zoning) |
| `entities` | Owning legal entities (LLC etc). Names/structure only, never EIN or banking |
| `profiles` | Investor profile and preferences (discount rate, exit assumptions, alert prefs, lease-expiry default) |
| `deal_shares`, `collaborator_groups`, `collaborator_group_members` | Sharing deals with people or groups |
| `app_notifications` | In-app notification hub |
| `reconciliation_tokens`, `rent_batches` | One-click email links. Tokens stored **hashed** only; service role only |

Views: `view_monthly_rent_reconciliation` (lease × current period payment status), `view_deal_parcel_packages`
(parcels rolled up per deal), `view_property_management_stats` (occupancy, rent roll per deal).

### Edge functions (`supabase/functions/`, Deno)

| Function | Purpose |
|---|---|
| `cron-daily-lease-monitor` | Daily (15:00 UTC, pg_cron + `CRON_SECRET`): rent reminders, follow-ups, digest/rent checklist emails, escalation notices |
| `reconcile-action` | Zero-login token actions from emails (mark paid, snooze) used by `/reconcile` |
| `configure-lease-terms` | Save lease terms/escalations (does not touch deal `inputs`) |
| `manage-profile`, `manage-entities`, `manage-collaboration` | Profile, entities, sharing/groups with server-side checks |
| `batch-sync-gis` | Monthly county GIS re-sync of parcels (cron secret) |

Shared server rules live beside the engine in `_shared/` and are unit tested from `src/`: `reminderEligibility.ts`
(contact a tenant only if the deal is owned, not demo, and the lease is in force today), `rentIncreaseRules.ts`
(Washington residential notice rules; escalations never lower rent), `followups.ts`, `digest.ts`, `recoveries.ts`,
`recoveryAlerts.ts`, `auth.ts`.

## 5. Frontend

React 18 + Vite + TypeScript + Tailwind, react-router, Chart.js. Pages are lazy loaded from `src/App.tsx`.

| Route | Page | Main components |
|---|---|---|
| `/`, `/dashboard` | `DashboardPage` | `components/dashboard` (deal cards, `ProjectWizardModal`), portfolio KPIs (`lib/portfolio`) |
| `/project?id=…&tab=…` | `DealStudioPage` | `components/studio`: `StudioNavbar`, tabs (Overview, ProForma, Property, Debt, Diligence, Sensitivity, Tax), modals (`EditInputsModal`, `RemodelModal`, `ParameterHistoryModal`) |
| `/compare` | `ComparePage` | `components/compare` (matrix, charts, what-if scrubber, baseline column) |
| `/operations` | `OperationsPage` | `components/operations` (rent roll, leases, payments, recoveries, CAM, meters) |
| `/brief`, `/demo-brief`, `/portfolio-brief` | `DealBriefPage`, `PortfolioBriefPage` | `components/brief`, models built in `lib/export` |
| `/reconcile` | `ReconcilePage` | Public, token-based |
| `/login` | `LoginPage` | |

Old `project-<tab>.html` URLs redirect to `/project?tab=<tab>`. Components get numbers from `computeDealMetrics` /
`useComputedMetrics` and memoise with `useMemo`; they never read stored metrics.

## 6. Build, deploy, verify

- `npm run build` = `tsc && vite build && node scripts/postbuild.js` → `dist/` (`app.html` + static pages).
- Firebase Hosting `mathtree-app` (`firebase.json` rewrites app routes to `/app.html`). GitHub Actions build on every PR
  (preview channel) and deploy live on merge to `main`. CI does not run tests.
- Edge functions and SQL are deployed to Supabase separately (not by CI).
- Verification follows `AGENTS.md`: `npx tsc --noEmit` and single-file `npx vitest run <file> --reporter=dot` only.
