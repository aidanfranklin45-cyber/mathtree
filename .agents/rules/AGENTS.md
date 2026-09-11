---
trigger: always_on
description: Unified agent operational rules, architectural constraints, database protocols, and testing policies for Math Tree.
globs: "**/*"
---

# AGENT OPERATIONAL RULES & SYSTEM DIRECTIVES (MATH TREE)

## 0. STRICT TEST EXECUTION PROTOCOL
> [!CRITICAL]
> - **NEVER RUN GLOBAL TEST SUITES ON MODIFICATIONS:** Under no circumstances execute `npm test`, `vitest run`, `jest`, or full-project suites after editing files or completing tasks.
> - **NO TEST EXECUTION ON INQUIRIES:** If asked investigatory questions (e.g., "did you run the full suite?"), answer with factual prose—do not execute tests.
> - **TARGETED ISOLATION ONLY:** Verify changes solely via single-file targeting (e.g., `npx vitest run path/to/file.test.ts --reporter=dot`) or static AST/syntax checks.
> - **ZERO-TEST SCOPE:** Do not run automated tests for CSS, styling, or simple UI copy changes. Verify via local dev server logs only.
> - **FULL SUITE OVERRIDE:** Run the full test suite strictly when the user gives an explicit, imperative command (e.g., *"Run the full test suite now"*).

---

## 1. CONTEXT & TOKEN OPTIMIZATION
- **Targeted Reading:** Inspect only the specific file or function relevant to the current task. Do not inspect broad directory trees or unrelated modules.
- **Search Scope:** Locate symbols using targeted search (`grep`). Restrict AST/graph analysis strictly to 1–2 dependency hops.
- **Bundling & Re-indexing:** Repository re-indexing (`npm run refresh-context`) and full-repo bundling (Repomix) are forbidden unless explicitly requested. Never re-index for isolated UI tweaks.
- **Impasse Breaker:** If a tool call or script fails with the identical error twice, **HALT immediately**. Do not attempt a third run without asking for user input or updating arguments.

---

## 2. CODE MODIFICATION & WORKSPACE HYGIENE
> [!IMPORTANT]
> - **BAN ON SCRATCH PATCH SCRIPTS:** Agents must never generate temporary Node.js patch scripts (e.g., `scratch/fix_*.js`, `scratch/update_*.js`) to edit source files. Apply changes directly using standard file-editing tools.
> - **NO SCRIPT PROLIFERATION:** If a file is too complex or large to edit cleanly, modularize it into proper components—never patch it via string replacement scripts.
> - **EPHEMERAL DIAGNOSTICS:** Diagnostic or AST scripts must be ephemeral and purged immediately after verification. Never commit scratch or one-off migration scripts to version control.

---

## 3. ARCHITECTURAL MANDATES & FIRST-DESIGN PRINCIPLES
- **First-Design Principles Mandatory:** Every feature, data entity, and domain workflow must begin with proper schema design. Never write client-side regex parsers, ad-hoc hacks, or temporary JSON blobs to mask un-normalized schemas.
- **Database Schema First:** Always specify relational schemas, foreign keys, generated columns, and Postgres views/RPCs before writing UI components. The frontend must remain a lean declarative presentation layer—never an ETL engine or math reconciler.
- **Zero Patchwork / Shims:** Do not wrap legacy bugs in successive layers of client-side shims. Fix the architectural flaw at the root schema or typed contract.
- **Component Modularity:** Break down monolithic legacy HTML/JS views into focused modules:
  - `src/components/navigation/` (Navbar, Breadcrumbs, ModuleSelector)
  - `src/components/proforma/` (ProFormaTable, SensitivityMatrix, YieldForecast)
  - `src/components/debt/` (AmortizationSchedule, RefinanceModeler)
  - `src/components/property/` (ParcelPackageCard, CountyAssessorDossier)
  - `src/components/operations/` (MasterRentRoll, LeaseEditorModal, EscalationSchedule)
  - `src/components/reports/` (PdfBriefGenerator, PitchDeckExporter)
- **Mandatory TypeScript Architecture:** Standardize strictly on **Vite + React + TypeScript (.ts / .tsx) + Tailwind CSS**.
  - **Strict TypeScript Standard:** Mandate TypeScript (`.ts` / `.tsx`) across the entire codebase. Prohibit converting files to pure `.js` / `.jsx`. Forbid deleting `tsconfig.json`, `tsc`, or `@types/*` packages.
  - **Type Resolution Protocol:** Agents must fix TypeScript errors directly through proper typing, interfaces, or pragmatic type narrowing—never by stripping TypeScript out of the project.
  - **Database & Auth:** `@supabase/supabase-js` connecting directly to PostgreSQL (specifically querying views like `view_deal_parcel_packages` and `view_monthly_rent_reconciliation`).
  - **Serverless:** Supabase Edge Functions (Deno) for complex orchestration, PDF brief synthesis, and heavy compute.
  - **Hosting:** Firebase Hosting serving the root directory (`"public": "."`) preserving the full application suite and sign-in flow (`index.html`, `dashboard.html`, `project.html`, `operations.html`).
  - **State Management:** Structured reactive stores (e.g., Zustand, React Context) backed by Supabase Auth and Realtime.

---

## 4. PLATFORM DOMAIN & BOUNDARIES
- **Domain:** Institutional Commercial Real Estate Underwriting, Financial Modeling (Pro-Forma, Debt, Tax, Sensitivity, Monte Carlo), and Property Management across Commercial, Multifamily, SFR, and Self-Storage asset classes.
- **Core Entities:** `deals` (property pipelines), `parcels` (tax lots & land records), `leases` (tenants, terms, escalations), `units` (suites, bays, square footage), `entities` (holding LLCs, EINs, bank accounts), `rent_payments` (transactions & receivables), `rent_increases` (audited escalations).
- **Relational Integrity:** Maintain strict relational mapping between property assets (`deals`), holding entities (`entities`), and rent roll operations (`leases`/`units`).
- **Precision Math:** Financial calculations (IRR, NPV, Debt Service Amortization, Cash-on-Cash, Equity Multiples) must remain standardized in verified shared modules (`math.js` or Postgres RPCs)—never duplicated as inline ad-hoc calculations in UI templates.

---

## 5. DATABASE & INFRASTRUCTURE PROTOCOLS (SUPABASE)
- **Project ID:** `bgexwcepwbxvhxbpblhd`
- **Postgres as Single Source of Truth:** All deals, pro-forma metrics, lease rolls, and LLC entities must live in Supabase PostgreSQL protected by Row Level Security (RLS).
- **Schema Inspection:** Inspect migration files or database schema directly. Avoid executing MCP schema discovery queries (`list_tables`).
- **Targeted SQL Execution:** Execute DDL/DML via Supabase MCP (`execute_sql`) only when altering relations or records. Verify changes with a single targeted `SELECT` query.
- **Serverless Edge Functions (Deno):** Reserve for heavy or asynchronous compute (Monte Carlo risk simulations across 1,000–10,000 runs, automated executive PDF synthesis via `generate-pdf-brief`, GIS parcel sync via `batch-sync-gis`). Never block client UI threads with heavy math loops.
- **Benchmark Fallbacks:** If an authenticated user account has 0 custom deals, fall back gracefully to benchmark records (`is_demo = true`).

---

## 6. WORKFLOW & INTEGRATION
- **Trunk Commits:** When atomic logic passes local checks, commit with a concise, descriptive message and push directly to `main` without triggering CI bottlenecks.
- **Deployments:** Deploy edge functions via Supabase MCP and web clients via Firebase Hosting (`firebase deploy --only hosting`).