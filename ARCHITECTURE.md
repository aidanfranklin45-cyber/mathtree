# MathTree Architecture

Real-estate underwriting (pro-forma, debt, tax, sensitivity, Monte Carlo) plus property operations (leases, rent,
recoveries) for owned and prospect deals. Read this before guessing at schemas, formulas or where a component lives.
Decisions that still shape the code are recorded in section 7. Plans and status are not committed (see `AGENTS.md`).

## 1. The one rule: the database stores facts, never results

- The database holds **facts**: deals and their `inputs`, leases, units, payments, rent increases, parcels, recoveries.
- Everything **derived** (projections, amortization, IRR, NPV, LTV, DSCR, cap rate, equity, tax shield, sensitivity,
  Monte Carlo) is computed on demand from those facts by **one shared engine**. No stored metrics columns, no SQL
  calculators, no second calculator in the UI. (Stored analysis was dropped by
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
    benchmarks/             Dated, sourced public market facts shown beside a property's own numbers. Never defaults,
                            never read by the engine. Pure lookup + plausibility checks the future CSV/OM parser can call
    assumptions/            ledger.ts: every figure a deal rests on, with where it came from (entered, document, profile, assumed)
    ingestion/              Intake groundwork for the document parser: document types, the questions to ask, normalising and
                            validating extracted values into deal inputs; the parser itself is the `parse-document` edge function (section 8)
    property/               Facts about an owned property (rent roll, payments) and its present state; no stored results
    baselines/ compare/ remodel/ operations/ underwriting/ portfolio/ export/ services/ auth/ studio/
supabase/
  functions/_shared/        THE engine and shared rules (Deno + browser). Imported in the app as `@engine/*`
  functions/<name>/         Deno edge functions (see §4)
  migrations/               Historical SQL. The live schema was NOT built from this folder; treat it as reference
  migrations_draft/         Reviewed SQL applied by hand to production (all applied; README.md records order). Never re-run
```

Path aliases (`vite.config.ts`, `tsconfig.json`): `@/*` → `src/*`, `@engine/*` → `supabase/functions/_shared/*`.

## 3. The math engine

**Source of truth:** `supabase/functions/_shared/math-engine.ts` (pure TS, only `import type` plus sibling `_shared`
modules, so it runs in both Vite and Deno). Siblings: `monte-carlo.ts`, `remodel.ts`, `leaseExpiry.ts`, `types.ts`.

**How the app calls it:** always through `src/lib/engine/compute.ts`:

- `prepareEngineInputs(deal, overrides)` merges `deal.inputs` + overrides, fills `purchasePrice` from the column, drops an
  ARV that just echoes the assessed value, applies the investor's lease-expiry defaults, and overlays the owner's profile
  assumptions **live** for the assumptions the deal leaves unstated (an allowlist, `PROFILE_FILLS`). A pipeline deal with no
  closing date and no dated leases is given one: created date plus the owner's own assumed closing time from the investor profile. Six weeks is only the starting
  point offered to a new profile; the owner sets whatever they like, and any deal can state its own closing date. Nothing else
  is defaulted. `missingInputsFor(deal)` asks the same question as the engine, so screens and engine agree on what is missing.
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
| Expense ratio | The property's operating costs less what tenants reimburse, as a % of **gross rent before vacancy**. It does **not** include management (charged separately, only if the owner hires a manager), on-site payroll and marketing (storage, charged separately), the replacement reserve, or debt service. Parsed figures are built to this definition (`ingestion/toDealInputs.ts`) |
| Cash flow | NOI − debt service − capex reserve − remodel cash cost (in the year it is spent) |
| Cash-on-cash | cash flow ÷ cumulative cash invested × 100 |
| Cap rate | NOI ÷ current property value × 100; **going-in cap uses the first full year** |
| DSCR | NOI ÷ debt service (null with no debt); **headline DSCR = first full year** (`firstFullYear`) |
| IRR / NPV | `calculateIRR` / `calculateNPV` on equity cash flows incl. `exitProceedsNet` at exit (value less selling costs less loan balance) |
| Lease rent | `resolveLeaseMonthlyRent`: explicit leases with escalations; at expiry a lease renews on current terms unless it states extension / vacancy-then-re-let (`leaseExpiry.ts`) |

Year 1 can be a partial year (`operatingMonths`), which is why headline ratios use the first full year.

**The engine never invents an input** (`_shared/inputRequirements.ts`). Every input is a fact (price, closing date, the loan's own
amortization, maturity and rate, a lease's rent and escalation) or an owner assumption (vacancy, expense ratio, exit cap or
appreciation, selling costs, reserves, management fee). Both must be stated on the deal; `calculateProjections` throws
`IncompleteInputsError` listing what is missing, and the Monte Carlo, monthly schedule and tax module hold the same line. An
explicit 0 is an answer; blank is not. A loan has one term (the amortization; paid off at the end, counted from the closing date). A separate maturity applies only
to a balloon and is refused if it falls due before the exit. Land share and tax rate vary by deal and have no default. Every number
should carry a rationale the owner can show a lender; defaults, where they exist, live in the investor profile and are copied
onto the deal or overlaid live from it, never in the engine. Tests that are not about requirements build deals with
`engine/testInputs.ts`. See section 8 for the assumptions model.

**Changing the math:** any change that alters a computed number (fixes included) must bump `ENGINE_VERSION` in
`src/lib/engine/version.ts` with a one-line changelog entry, and update the golden snapshot
(`src/lib/engine/engine.golden.test.ts`) deliberately. Never add a second calculator anywhere (UI, SQL, edge function).

**Monte Carlo** (`monte-carlo.ts`, rules in section 7): seeded, runs in the browser in time slices via
`createMonteCarloRunner` so the page stays responsive and cancels when inputs change. Used by `SensitivityTab` and the brief.

**Remodel** (`remodel.ts`, `src/lib/remodel/`): an optional `remodel` block in inputs (capex,
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
| `parcels` | County GIS parcels attached to a deal (APN, assessed values, acres, zoning) |
| `entities` | Owning legal entities (LLC etc). Names/structure only, never EIN or banking |
| `profiles` | Investor profile and preferences (discount rate, alert prefs, lease-expiry default) and the underwriting assumptions by asset class, each with its rationale |
| `deal_shares`, `collaborator_groups`, `collaborator_group_members` | Sharing deals with people or groups |
| `app_notifications` | Written by the daily monitor (NNN alerts, email de-duplication). The app no longer reads it: the bell shows the live inbox (`lib/operations/attention.ts`) |
| `reconciliation_tokens`, `rent_batches` | One-click email links. Tokens stored **hashed** only; service role only |

There are no utility-meter, meter-reading or expense-ledger tables (the meters were dropped; the expense ledger was never built). Utilities
are an assumption (section 8), not a record of bills.

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
| `parse-document` | Reads a document's text into the intake schema (signed-in users). Redacts tenant names, phones and emails first, calls Gemini Flash only through Cloudflare AI Gateway (secrets `AI_GATEWAY_URL`, `CF_AIG_TOKEN`, optional `AI_MODEL`), returns facts with confidence and evidence. Writes nothing itself: the app applies what the owner accepts |

Shared server rules live beside the engine in `_shared/` and are unit tested from `src/`: `reminderEligibility.ts`
(contact a tenant only if the deal is owned, not demo, and the lease is in force today), `rentIncreaseRules.ts`
(Washington residential notice rules; escalations never lower rent), `followups.ts`, `digest.ts`, `recoveries.ts`,
`recoveryAlerts.ts`, `auth.ts`.

## 5. Frontend

React 18 + Vite + TypeScript + Tailwind, react-router, Chart.js. Pages are lazy loaded from `src/App.tsx`.

| Route | Page | Main components |
|---|---|---|
| `/`, `/dashboard` | `DashboardPage` | `components/dashboard` (deal cards, `ProjectWizardModal`, deal actions menu, equity chart), portfolio KPIs (`lib/portfolio`). A deal that is missing required inputs shows what it needs instead of numbers |
| `/project?id=…&tab=…` | `DealStudioPage` | `components/studio`: `StudioNavbar`, tabs (Overview, ProForma, Property, Debt, Diligence, Sensitivity, plus Performance and Operate for owned deals), `InputsNeeded`, `AssumptionsLedger`, modals (`EditInputsModal`, `RemodelModal`, `ParameterHistoryModal`) |
| `/compare` | `ComparePage` | `components/compare` (starter, builder strip, Add / Metrics / Filters / Saved panels, matrix, phone cards, charts, what-if scrubber, baseline column). Board settings live in `lib/compare/config.ts` (metrics in `metrics.ts`, saved boards in `savedViews.ts`); a plain visit opens blank |
| `/operations` | `OperationsPage` | `components/operations/OperationsWorkspace` (rent roll, leases, payments, recoveries, CAM) across all properties. The same workspace, locked to one deal, is the **Operate** tab of an owned deal on `/project`, so each figure has one code path |
| `/brief`, `/demo-brief`, `/portfolio-brief` | `DealBriefPage`, `PortfolioBriefPage` | `components/brief`, models built in `lib/export`. The portfolio brief's diversification and allocation cover owned properties only; each owned property runs to its own hold period |
| `/reconcile` | `ReconcilePage` | Public, token-based |
| `/login` | `LoginPage` | |

The deal screen shows a **stage lens** (`src/lib/studio/stageLens.ts`, stage from `status` and `inputs.dealStage`): prospect stages (screening, LOI, due diligence, closing, exited) show the underwriting tabs and no operations; owned deals open on Performance, add Operate, drop Diligence, and keep the analysis tabs. A `?tab=` the stage does not show falls back to the stage's first tab. Old `project-<tab>.html` URLs redirect to `/project?tab=<tab>`. Components get numbers from `computeDealMetrics` /
`useComputedMetrics` and memoise with `useMemo`; they never read stored metrics.

## 6. Build, deploy, verify

- `npm run build` = `tsc && vite build && node scripts/postbuild.js` → `dist/` (`app.html` + static pages).
- Firebase Hosting `mathtree-app`, the only host (`firebase.json` rewrites app routes to `/app.html`). GitHub Actions build on every PR
  (preview channel) and deploy live on merge to `main`. CI does not run tests.
- Edge functions and SQL are deployed to Supabase separately (not by CI): `npx supabase functions deploy <name> --project-ref bgexwcepwbxvhxbpblhd --no-verify-jwt --use-api`. SQL is applied by hand after review; applied drafts are recorded in `supabase/migrations_draft/README.md`.
- Verification follows `AGENTS.md`: `npx tsc --noEmit` and single-file `npx vitest run <file> --reporter=dot` only.

## 7. Decisions that still shape the code

Owner decisions carried over from the retired plan docs (still in git history). Change them only deliberately.

- **Single user, compute on the fly.** Marketing pages (`index.html`, `terms`, `privacy`) stay static for SEO; the
  authenticated app is React. There is no global expense-ratio default in the engine: the owner states it per deal (a profile default may seed it).
- **Monte Carlo model.** Contract rent never varies (fixed dollar or percentage escalators stay fixed). Only what the
  contract does not fix varies: market rent after a lease ends drifts with the sampled rent growth. Tenant default is an
  explicit, adjustable probability with downtime (default 10% over the hold, 12 months; commercial and storage with
  income only), not a hidden vacancy shock. Report net profit in dollars beside IRR, with a plain-language note when equity
  is under about 10% of price; never hide IRR for high leverage. 1,000 runs, seeded from the deal (repeatable; Re-Run draws
  a new sample). Runs when the view is opened or on a deliberate change, not on every render. The PDF brief uses the same
  `runMonteCarlo`. Histogram is fixed-width between the 1st and 99th percentile.
- **Residential turnover (Monte Carlo and engine).** Each tenant has a yearly chance of moving out (fixed-term only after
  the lease ends), the space sits vacant, costs a make-ready charge, then a new tenant pays the same rent. Vacancy is
  calibrated to the deal's own vacancy setting: apartments 45% a year, make-ready $1,500; houses 30%, $2,000 (editable per
  deal, no global setting). The normal projection still uses the vacancy rate. The rent roll's lease schedules are resolved
  once per simulation (`createLeaseScheduleCache`); results are identical, large rent rolls stay fast.
- **Rent roll.** Each tenant is its own lease row (unit, rent, move-in date, term, due day). "Underwrite from this rent
  roll" copies tenants into a prospect's inputs only when pressed; owned deals keep their frozen baseline.
- **Digest emails.** One email per property per day when the owner's threshold (default 3) tenants are due, with one
  "Manage rent payments" checklist link: no sign-in, long random token stored as a hash, expires after 14 days, touches
  only the leases it was issued for. Ticked tenants are recorded paid; unticked are snoozed and followed up as if
  "Missing rent" was pressed. A single tenant gets the one-tenant email with Confirm and Snooze.
- **Washington residential rent increases** (RCW 59.18.140 and 59.18.700; a helper, not legal advice; applies to
  residential deals in WA). Enforced: 90 days' written notice (30 if subsidized); no increase before a fixed term ends or
  in the first 12 months; new rent at most the lesser of 7% + CPI or 10% (2026: 9.683%, 2027: 10%; other years use 10%
  with a warning); exempt properties skip the cap and first-year rule, not the notice. Warned only: a second increase
  within 12 months, mailing time. The nightly escalation job skips WA residential leases unless an explicit scheduled
  increase has a recorded notice date far enough ahead, so there is no automatic yearly increase. The owner (not the app)
  delivers the notice and records the date; reminders go to the owner 14 and 3 days before the last notice date and the
  day after it passes. Leases are *Fixed term* or *Month to month* (no end date, no auto-increase).
- **Remodel.** Plans are stored in the deal's `inputs` (no migration), not as results; Live numbers change only when a
  plan is committed. The engine supports capex plus a rent step mid-hold, optional new-loan financing, downtime rent
  percentage, extra opex, and value by cap rate or a typed ARV.
- **PDF brief.** Computed from facts with the shared engine; no stored metrics.

## 8. Assumptions, the investor profile, and intake

**Where numbers come from.** A deal's figure is one of: a fact the owner stated, a fact read from a county record or a document, or an
assumption. Assumptions live in the investor profile by asset class (`_shared/underwritingAssumptions.ts`: vacancy, expense ratio
(NNN or not), rent and expense growth, appreciation, exit cap, selling costs, management fee, reserves per unit, per square foot, or as
a percent of income or value, insurance and upkeep as rates on value, utilities per square foot, property tax rate, closing time). Each
carries a short rationale. They are starting points for screening, not a standard imposed on every deal. Nothing in them is fixed: values such as a
six-week closing or a 5% vacancy are only the conventions a new profile starts with, the owner changes any of them globally in the investor profile, or individually on a single property in Edit Inputs. A figure stated on
a property always wins over the profile, and a property that states nothing keeps following the profile as it changes. `suggestedStartingPoints` fills blanks with labelled conventions only; `seedFromAssumptions`
turns profile rates into per-deal dollar inputs using the deal's own size, price or county values and reports which it could not fill.

**Provenance.** `assumptionBasis` on a deal records the source of each tracked input (profile, owner, county record, document);
`assumptions/ledger.ts` renders it as two groups on the property page: specific to this property, and from your standards.

**Carrying costs.** Taxes, insurance, upkeep and utilities are carried by the owner while a space is vacant (and always on a gross lease);
tenants reimburse them under NNN while leased. Property tax is the county's assessed value times the owner's rate for that tax-code area
(county data holds no tax bill). Selling costs are optional: unstated means none. Utilities unstated means none carried.

**Intake groundwork.** `lib/ingestion` defines the document types, the questions to ask for each, and the normalising and validation
that turn extracted values into deal inputs the engine accepts. The `parse-document` edge function is the parser (rules in
`_shared/intakeParse.ts`, redaction in `_shared/redact.ts`, the gateway call in `_shared/aiGateway.ts`); the intake types and questions live in
`_shared` so the function and the app share them. **Start from a document** in the new-project wizard (and **Read documents** on an existing deal, `ReadDocumentsModal`) share one component, `studio/DocumentIntake`. It takes PDF, CSV, text or pasted text (`ingestion/extractText.ts` rebuilds a PDF's text layer in the browser with `pdfjs-dist`, loaded only when a PDF is read; a scanned PDF is refused), calls the function, checks the result (`ingestion/validate.ts`), lines the figures up against what the deal states (`ingestion/apply.ts`), and applies only what the owner ticks: on an existing deal through the same save as Edit Inputs, in the wizard into its form fields (`ingestion/wizardMap.ts`; figures with no field, like the tenant list, ride along to creation). Each figure is recorded as document-sourced in `assumptionBasis`. Excel and OCR are not built. Decisions made for it: the model is reached
only through Cloudflare AI Gateway, the owner holds the keys and spend limits (never handled in chat or the repo), tenant names, phones and
emails are redacted before anything is sent, and extracted values land on a review screen before they touch a deal.

**Market benchmarks** (`lib/benchmarks`, draft `13_market_benchmarks.sql`): dated, sourced public facts shown beside a property's numbers;
never defaults and never read by the engine. The table is not yet created in the database.
