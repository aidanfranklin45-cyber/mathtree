---
trigger: always_on
description: Combined operational rules, mathematical graph invariants, database protocols, and tiered context selection for Math Tree.
globs: "**/*"
---

# AGENT OPERATIONAL RULES & SYSTEM DIRECTIVES (MATH TREE)

## 0. STRICT TEST EXECUTION RULE (ZERO FULL SUITE RUNS ON MODIFICATIONS)
> [!CRITICAL]
> - **NEVER RUN FULL/GLOBAL TEST SUITES ON FILE MODIFICATIONS:** Under NO circumstances should `node test.js`, `npm test`, `vitest`, `jest`, or any full-project test suite be executed automatically after editing files or completing tasks.
> - **DO NOT EXECUTE TESTS ON INQUIRIES:** If the user asks an investigatory question about tests (e.g. "did you run a full test suite?"), **NEVER execute the test command**. Answer the user's question directly with factual prose.
> - **ISOLATED VERIFICATION ONLY:** For verifying changes, ONLY run targeted static syntax/AST checks or isolated single-unit verifications.
> - **FULL SUITE REQUIRES EXPLICIT COMMAND:** The full test suite may ONLY be run if the user explicitly gives an imperative order (e.g., *"Run the full test suite now"*).

---

## 1. CODE MODIFICATION STANDARDS & BAN ON "ONE-OFF PATCH SCRIPTS" & PATCHWORK HACKS
> [!IMPORTANT]
> - **MANDATE FIRST-DESIGN PRINCIPLES:** Every feature, data entity, and domain workflow must begin with proper first-principles system design. Never create ad-hoc client-side hacks, regex parsers, or temporary JSON blobs to mask a deficient or un-normalized database schema.
> - **DATABASE SCHEMA FIRST:** Always design relational schemas, foreign keys, generated columns, and PostgreSQL views/RPCs as step #1. The frontend (TSX) must remain a lean declarative presentation layer—never an ETL pipeline, data munging engine, or math reconciler.
> - **PROHIBIT "SCRATCH PATCH SCRIPTS" & AD-HOC PATCHWORK:** Agents must NEVER generate one-off Node.js patch scripts (e.g. `scratch/fix_*.js`, `scratch/update_*.js`) to modify source code files. Code changes must be applied directly to the codebase files using proper file editing tools.
> - **NO AD-HOC SCRIPT PROLIFERATION:** Do not create separate `.js` files for individual bug fixes or updates. If a file is too large to edit cleanly, it must be modularized into proper component files, not patched via string-replacement scripts.
> - **CLEAN WORKSPACE HYGIENE:** Temporary diagnostic or AST-check scripts must be ephemeral and purged once verification is complete. Never commit one-off migration/patch scripts to Git.

---

## 2. MODERN COMPONENT FRAMEWORK ARCHITECTURE DIRECTIVE
> [!IMPORTANT]
> - **LEGACY MONOLITHIC HTML IS TECHNICAL DEBT:** The monolithic HTML files with 2,000–9,000 lines of inline vanilla JavaScript (`project.html`, `dashboard.html`, `operations.html`) are legacy technical debt. A single uncaught reference error halts execution of the entire script, breaks pro-forma calculations, and corrupts the UI.
> - **MANDATE MODERN COMPONENT ARCHITECTURE:** MathTree must transition toward modern declarative component architecture (Vite + React / TypeScript / Tailwind or modern ES modules):
>   1. **Component Modularity:** Break monolithic views into focused, single-responsibility modules:
>      - `src/components/navigation/` (Navbar, Breadcrumbs, ModuleSelector)
>      - `src/components/proforma/` (ProFormaTable, SensitivityMatrix, YieldForecast)
>      - `src/components/debt/` (AmortizationSchedule, RefinanceModeler)
>      - `src/components/property/` (ParcelPackageCard, CountyAssessorDossier)
>      - `src/components/operations/` (MasterRentRoll, LeaseEditorModal, EscalationSchedule)
>      - `src/components/reports/` (PdfBriefGenerator, PitchDeckExporter)
>   2. **Compile-Time Type Safety (TypeScript):** Catch missing functions, typos, and undefined data structures during compilation rather than suffering silent runtime crashes in the browser.
>   3. **Declarative State Management:** Eliminate fragile `sessionStorage`, `localStorage`, and URL hash synchronization. Use structured reactive stores (e.g. Zustand, React Context, or Pinia) with Supabase Auth & Realtime synchronization.
>   4. **No More Inline Vanilla Spaghetti:** Forbid adding new features as 500-line inline `<script>` blocks or manual `innerHTML` string concatenations.

---

## 3. REAL ESTATE DOMAIN & PLATFORM BOUNDARIES
- **Domain:** Institutional Commercial Real Estate Underwriting, Financial Modeling (Pro-Forma, Debt, Tax, Sensitivity, Monte Carlo), and Property Management (Rent Roll, Leases, Units, Entities).
- **Core Entities:** `deals` (property assets & pipelines), `leases` (tenants, terms, escalations), `units` (suites, bays, square footage), `entities` (holding LLCs, EINs, bank accounts), `rent_payments` (transactions & receivables), `rent_increases` (audited escalations).
- **Relational Integrity:** Maintain strict relational mapping between property assets (`deals`), holding companies (`entities`), and rent roll operations (`leases`/`units`).
- **Precision Financial Math:** Financial formulas (IRR, NPV, Debt Service Amortization, Cash-on-Cash, Equity Multiples) must remain standardized in verified shared modules (`math.js` / Supabase Postgres RPCs) and never duplicated as ad-hoc calculations in UI templates.

---

## 4. DATABASE & SERVERLESS ARCHITECTURE (SUPABASE)
- **Project ID:** `bgexwcepwbxvhxbpblhd`
- **Postgres as Single Source of Truth:** All deals, pro-forma metrics, lease rolls, and LLC entities must live in Supabase PostgreSQL with Row Level Security (RLS).
- **Edge Functions (Deno):** Reserve for serverless compute-heavy workloads (Monte Carlo risk simulations, automated executive PDF briefs via `generate-pdf-brief`, GIS parcel syncing via `batch-sync-gis`).
- **Benchmark Fallbacks:** If an authenticated user account has 0 custom deals, always gracefully fall back to benchmark records (`is_demo = true`) so the user experience is never blank.

---

## 5. PRACTICAL WORKFLOW & TRUNK-BASED INTEGRATION
- **Atomic Commits:** Once a discrete task or component refactor is verified, commit directly with a clean, descriptive message.
- **Fast Delivery:** Push verified commits to `main` without unneeded CI bottlenecks.
- **Deployments:** Deploy edge functions via Supabase MCP and hosting via Firebase Hosting (`firebase deploy --only hosting`).
