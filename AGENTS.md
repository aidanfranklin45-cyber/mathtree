---
trigger: always_on
description: Core agent operational rules, verification limits, and on-demand architecture directives.
globs: "**/*"
---

# AGENT OPERATIONAL RULES — MATH TREE

## 1. STRICT VERIFICATION & TOOL LIMITS
- **Zero Global Tests:** NEVER run `npm test`, `vitest run`, `jest`, or full suites. Targeted single-file verification ONLY (e.g. `npx vitest run <file> --reporter=dot` or `npx tsc --noEmit`). Zero tests for CSS/copy.
- **No Headless Browsers:** Strictly FORBID Playwright, Puppeteer, screenshots, or background previews. Terminal exit codes only (`exit 0`).
- **Ban Scratch Scripts:** Never generate temporary patch scripts (`scratch/fix_*.js`). Edit directly.
- **Impasse Breaker:** If any tool fails twice with the same error, HALT immediately.

## 2. ARCHITECTURAL BLUEPRINT (ON DEMAND)
- **Do Not Guess Schemas:** For database entities, Supabase tables/views, math formulas, or component layouts, read `@ARCHITECTURE.md` on demand.

## 3. GIT WORKFLOW & PR PROCEDURE (STRICT BRANCH ISOLATION)
- **No Direct Pushes to Main:** You are STRICTLY FORBIDDEN from pushing directly to `main`.
- **Isolated Branches:** All code modifications, investigations, and refactors MUST be developed on an isolated Git branch (e.g., `feat/*`, `fix/*`, `perf/*`).
- **Post via Pull Request:** Once tasks and single-file verifications are complete, push the isolated branch to `origin` and present the PR link for the user to review and merge into `main`.

