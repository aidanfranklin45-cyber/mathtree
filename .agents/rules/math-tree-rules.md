---
trigger: always_on
description: Combined operational rules, mathematical graph invariants, database protocols, and tiered context selection for Math Tree.
globs: "**/*"
---

# AGENT OPERATIONAL RULES & SYSTEM DIRECTIVES (MATH TREE)

---
trigger: always_on
description: Core architectural constraints, context limits, and execution standards for Math Tree.
globs: "**/*"
---

# AGENT OPERATIONAL RULES (MATH TREE)

## 1. ARCHITECTURAL INVARIANTS
- **Strict DAG:** No circular prerequisite dependencies; mutations must preserve DAG integrity[cite: 1]. Missing dependencies must throw `PrerequisiteResolutionError`[cite: 1].
- **Dynamic Curriculum:** Never hardcode grade levels, fixed progression maps, or problem solutions[cite: 1]. Resolve sequences dynamically via user mastery state and tree topology[cite: 1].
- **Precision:** Use symbolic/arbitrary-precision libraries for algebraic equivalence and exact fractions—no raw floating-point calculations[cite: 1].
- **Separation of Concerns:** Keep the graph solver and state machine decoupled from the visual layer (KaTeX/SVG/Canvas)[cite: 1]. Dynamic problem generator parameters must come from configs/database, never magic numbers[cite: 1].

---

## 2. CONTEXT & TOKEN OPTIMIZATION
- **Targeted Reading:** Inspect only the specific file or function relevant to the task[cite: 1]. Do not inspect broad directories or unrelated subtrees[cite: 1].
- **Search Scope:** Pinpoint code using `grep` or symbol search[cite: 1]. Use Graphify strictly for multi-file models or RPCs limited to 1–2 hops[cite: 1].
- **Bundling & Re-indexing:** Forbid full repository bundling (Repomix) and re-indexing (`npm run refresh-context`) unless explicitly requested by the user[cite: 1]. Never re-index for CSS, KaTeX styling, or isolated UI tweaks[cite: 1].
- **Impasse Breaker:** If a tool call or script fails with the identical error twice, HALT immediately[cite: 1]. Do not attempt a third execution without user input or modified parameters[cite: 1].

---

## 3. STRICT TEST & EXECUTION PROTOCOL
- **No Global Test Suites:** NEVER execute global test commands (`npm test`, `vitest run`, `jest`)[cite: 1]. Running the full suite is forbidden unless explicitly directed by the user.
- **Single-File Targeting:** Run tests exclusively against the single file corresponding to the modified code using minimal output flags:
  - Example: `npx vitest run test/unit/dag-cycle.test.ts --reporter=dot`
- **Zero-Test Scope:** Do not run automated tests for CSS, styling, KaTeX formatting, or simple UI copy changes[cite: 1]. Verify via local dev server logs only[cite: 1].
- **Trunk Commits:** When atomic logic passes local checks, commit with a concise message and push directly to `main` without triggering CI bottlenecks[cite: 1].

---

## 4. DATABASE INTERACTION
- **Database Schema:** Reference local types (`supabase/types.ts`) or existing migration files first to inspect schema structures; avoid running schema inspection commands (`list_tables`) via MCP[cite: 1].
- **Execution:** Execute targeted DDL/DML queries via Supabase MCP (`execute_sql`) only when updating tree relations, mastery records, or problem stores[cite: 1]. Verify alterations with a single, targeted `SELECT` query[cite: 1].