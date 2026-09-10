# MathTree Project Overview & System Directives

## 1. Multi-Asset PropTech Modeling Engine
A high-performance client-side and serverless PropTech modeling engine that computes 10-year pro-forma projections, IRR, NPV, Debt Service, Tax Depreciation, Sensitivity, and Monte Carlo risk distributions across four property asset classes:
- Single-Family Residential
- Multi-Unit Residential
- Commercial Real Estate
- Storage Facilities

---

# AGENT OPERATIONAL RULES & SYSTEM DIRECTIVES (MATH TREE)

## 0. STRICT TEST EXECUTION RULE (ZERO FULL SUITE RUNS ON MODIFICATIONS)
> [!CRITICAL]
> - **NEVER RUN FULL/GLOBAL TEST SUITES ON FILE MODIFICATIONS:** Under NO circumstances should `node test.js`, `npm test`, `vitest`, `jest`, or any full-project test suite be executed automatically after editing files or completing tasks.
> - **DO NOT EXECUTE TESTS ON INQUIRIES:** If the user asks an investigatory question about tests (e.g. "did you run a full test suite?"), **NEVER execute the test command**. Answer the user's question directly with factual prose.
> - **ISOLATED VERIFICATION ONLY:** For verifying changes, ONLY run isolated, lightweight scratch scripts (e.g. `node scratch/...`) or static syntax/AST checks targeted specifically at the modified code.
> - **FULL SUITE REQUIRES EXPLICIT COMMAND:** The full test suite may ONLY be run if the user explicitly gives an imperative order (e.g., *"Run the full test suite now"*).

## 1. ARCHITECTURAL INVARIANTS & DOMAIN LOGIC RULES

### Directed Acyclic Graph (DAG) & Dependency Invariants (Strict Rule)
- NEVER allow circular prerequisite dependencies within the skill tree. Every node addition or edge mutation must preserve the DAG structure.
- Hardcoded curriculum sequences or static grade-level progressions are strictly forbidden. Mastery state, unlockable branches, and adaptive recommendation paths MUST be resolved dynamically via the tree engine and user mastery state.
- Never hardcode dynamic exercise values, randomized coefficients, or tolerance thresholds as magic numbers in frontend UI components. All math problem generation parameters, seed ranges, and precision tolerances must come from domain configs or the database layer.
- If a prerequisite node, edge dependency, or skill definition is missing or corrupt, throw a descriptive domain exception (`PrerequisiteResolutionError`) rather than falling back to an unverified static tree.

### Execution Standards
- All node evaluation and adaptive pathing functions must accept explicit user context, mastery vectors, and tree topology parameters.
- Mathematical precision: Enforce symbolic or arbitrary-precision math libraries where applicable; do not use standard floating-point arithmetic for operations requiring exact fractions or algebraic equivalence checks.
- Before completing any task touching the curriculum tree or recommendation engine, verify that no static progression maps, hardcoded problem answers, or cycle-inducing edges were introduced.

---

## 2. CONTEXT SELECTION & TOKEN OPTIMIZATION PROTOCOL

Optimize context efficiency by gathering only the information necessary to resolve the prompt.

- **Default to Focused Search:** Use targeted search tools (`grep`, `rg`, file/symbol search) to pinpoint relevant code rather than loading broad tree modules or directory trees.
- **Targeted Context Reading:** Read only the relevant files or nodes related to the task (e.g., node renderer, tree visualizer, problem generator). Avoid bundling unrelated domain subtrees.
- **Dependency Tracing (Graphify):** Use Graphify strictly when tracing cross-file tree node models, RPC endpoints, or database relations, scoped strictly to 1–2 hops.
- **Full Bundling (Repomix):** Do not run full repository bundling tools unless explicitly requested for multi-file architectural refactors.
- **Re-indexing:** Do not re-index context for localized UI edits, KaTeX/LaTeX formatting tweaks, or isolated CSS adjustments.

### Rule Execution Matrix
1. **Bug fix from a stack trace or isolated math renderer/UI tweak?** → **TIER 1** — Inspect 1 file / 1 function directly.
2. **Feature requiring knowledge of an edge table, node schema, or RPC?** → **TIER 2** — Grep schema or run a localized 1-hop Graphify query.
3. **Curriculum engine or platform-wide overhaul?** → **TIER 3** — Filtered Repomix bundle (only on explicit user request).

### Re-Indexing Policy
- **Minor Changes:** Do NOT re-index for CSS, KaTeX styling, minor bug fixes, or UI tweaks.
- **Major Changes:** Execute `npm run refresh-context` ONLY after adding new curriculum modules, major database schemas, or new core routing systems.

---

## 3. IMPASSE DETECTOR & LOOP CIRCUIT BREAKER
- **Threshold:** If any tool call or script fails with the exact same error twice in a row, HALT immediately. Do NOT run it a 3rd time without altering inputs or verifying assumptions.

---

## 4. PRACTICAL WORKFLOW & TRUNK-BASED INTEGRATION

- **Iterate Locally First:** Edit files, verify layout/tree renders locally, and inspect client/server logs directly. Do NOT run full integration test suites for localized styling tweaks, LaTeX equation rendering adjustments, or simple UI copy changes. Run targeted tests (e.g., node traversal unit tests, DAG cycle validation suites) when altering core tree engines, mastery calculators, or database RPCs.
- **Commit When the "Contract" Passes:** Once a discrete task (such as DAG cycle detection, a specific tree visualization layout, or a problem-generation step) passes verification, commit the change as a single atomic commit with a clear, descriptive message.
- **Push on Verified Task Completion (High Velocity, No CI Bottlenecks):** Push verified commits directly to `main` (or merge short-lived branches) as soon as the task passes local checks to maintain rapid delivery.
- **Deployment Protocol:** Run project-specific build and deploy commands (e.g., framework build/deploy or edge function synchronization) from the Math Tree workspace root only after successful local smoke testing.

---

## 5. DATABASE PROTOCOL (Supabase MCP)
- **Project ID:** `bgexwcepwbxvhxbpblhd`
- Always use the Supabase MCP server (`execute_sql`, `list_tables`) as the primary database interface for tree relations, user mastery records, and problem stores.
- Verify all schema changes, RLS policy adjustments, or edge constraint modifications with an immediate follow-up query.

---

## 6. PROJECT REFERENCE & BOUNDARIES
- **Domain:** Interactive mathematical knowledge graph, prerequisite tree engine, dynamic problem generation, and mastery tracking.
- **Core Entities:** `nodes` (skills/topics), `edges` (prerequisites/dependencies), `user_mastery` (progress/state), `problem_templates` (generators).
- Maintain clean separation between the mathematical graph solver/state machine and the visual rendering layer (e.g., SVG/Canvas/KaTeX).

---

## 7. FOUNDATIONAL MODERN ARCHITECTURE AS PRIMARY ENGINEERING METHOD
- **Core Principle:** Enforce foundational modern architecture as the primary engineering method across MathTree. Forbid brittle, monolithic client-side JavaScript glue, duplicate 500KB+ copy-pasted HTML files, and ad-hoc DOM string-scraping.
- **High-Powered Postgres (Supabase):** Postgres is the primary relational brain and single source of truth. Use relational schemas, SQL views, generated columns, and stored procedures/RPCs for complex domain calculations, aggregations (e.g., Net Operating Income, debt service amortization, portfolio rollups, rent roll schedules), and transactional mutations. Enforce native Row-Level Security (RLS) for data protection.
- **Serverless Edge Functions (Deno/Supabase):** Reserve for compute-intensive, asynchronous, or security-sensitive workloads (e.g., Monte Carlo risk simulations across 1,000–10,000 runs, automated Executive Pitch Deck/PDF synthesis, external API calls like Census/County Assessor integrations). Never block client UI threads with heavy, long-running math loops.
- **Lean, Declarative Frontend:** Frontend interfaces must be modular, lightweight, and focused purely on presentation, user interaction, and reactive data visualization. Never synchronize financial state through fragile URL string manipulation or fragmented `localStorage` keys; synchronize state cleanly via authenticated Supabase client queries and structured reactive stores.
