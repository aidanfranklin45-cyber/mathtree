# ARCHITECTURE & SYSTEM BLUEPRINT — MATH TREE

## 1. TECH STACK & ARCHITECTURE MANDATES
- **Core Stack:** Vite + React + TypeScript (`.ts`/`.tsx`) + Tailwind CSS.
- **Strict TypeScript:** Mandate `.ts`/`.tsx` across codebase. Never convert to `.js`/`.jsx`. Never delete `tsconfig.json`, `tsc`, or `@types/*`. Fix errors via proper interfaces and narrowing.
- **Hosting:** Firebase Hosting serving root (`"public": "."`), preserving multi-page flow (`index.html`, `dashboard.html`, `project.html`, `operations.html`). Deploy via `npm run deploy:hosting`.
- **State Management:** Reactive stores (Zustand, React Context) backed by Supabase Auth & Realtime.
- **First-Design Principles:** Schema-first. DB relations, foreign keys, views, and RPCs before UI components. Frontend is lean declarative presentation—never an ETL engine or math reconciler. Zero patchwork/shims.
- **Component Modularity:** Monolithic views split into `src/components/{navigation,proforma,debt,property,operations,reports}`.

## 2. CRE DOMAIN ENTITIES & PRECISION MATH
- **Domain:** Institutional CRE Underwriting, Financial Modeling (Pro-Forma, Debt, Tax, Sensitivity, Monte Carlo), Property Management (Commercial, Multifamily, SFR, Self-Storage).
- **Core Entities:**
  - `deals`: Property pipelines & acquisitions
  - `parcels`: Tax lots, APNs, GIS, & land records
  - `leases`: Tenants, terms, escalations, renewals
  - `units`: Suites, bays, square footage, occupancy
  - `entities`: Holding LLCs, EINs, bank accounts
  - `rent_payments`: Transactions, ledger, receivables
  - `rent_increases`: Audited escalations & schedules
- **Relational Integrity:** Maintain strict relational mapping between `deals`, `entities`, and `leases`/`units`.
- **Precision Math:** All financial metrics (IRR, NPV, DSCR, Amortization, Cash-on-Cash, Equity Multiple) standardized in `math.js` or Postgres RPCs—never inline ad-hoc UI calculations.

## 3. DATABASE & INFRASTRUCTURE (SUPABASE)
- **Supabase Project ID:** `bgexwcepwbxvhxbpblhd`
- **Postgres as Single Source of Truth:** RLS-protected Postgres for all deals, pro-forma, lease rolls, LLCs.
- **Direct View Queries:** Query views directly (e.g. `view_deal_parcel_packages`, `view_monthly_rent_reconciliation`).
- **SQL Execution Protocol:** DDL/DML via Supabase MCP (`execute_sql`) only when altering relations/records; verify via single targeted `SELECT`. Inspect migrations directly; avoid `list_tables`.
- **Edge Functions (Deno):** Reserved for heavy compute (Monte Carlo 1k–10k runs, `generate-pdf-brief`, `batch-sync-gis`). Never block client UI threads.
- **Demo Fallback:** Default to benchmark records (`is_demo = true`) when user has 0 custom deals.
- **Trunk Commits:** Commit atomic logic directly to `main` with concise messages once local checks pass.
