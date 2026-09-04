---
trigger: always_on
description: Combined operational rules, mathematical graph invariants, database protocols, and tiered context selection for Math Tree.
globs: "**/*"
---

# AGENT OPERATIONAL RULES & SYSTEM DIRECTIVES (MATH TREE)

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
