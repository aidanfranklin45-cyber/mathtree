---
trigger: always_on
description: Core agent operational rules, verification limits, and on-demand architecture directives.
globs: "**/*"
---

# AGENT OPERATIONAL RULES — MATH TREE

## 1. STRICT VERIFICATION & TOOL LIMITS
- **Zero Global Tests:** NEVER run `npm test`, `vitest run`, `jest`, or full suites. Targeted single-file verification ONLY (e.g. `npx vitest run <file> --reporter=dot` or `npx tsc --noEmit`). Zero tests for CSS/copy.
- **No Headless Browsers:** Strictly FORBID Playwright, Puppeteer, screenshots, or background previews. Terminal exit codes only (`exit 0`).
- **Blast Radius Cap:** Max 3 files modified per turn before halting for user confirmation.
- **Ban Scratch Scripts:** Never generate temporary patch scripts (`scratch/fix_*.js`). Edit directly.
- **Impasse Breaker:** If any tool fails twice with the same error, HALT immediately.

## 2. ARCHITECTURAL BLUEPRINT (ON DEMAND)
- **Do Not Guess Schemas:** For database entities, Supabase tables/views, math formulas, or component layouts, read `@ARCHITECTURE.md` on demand.
