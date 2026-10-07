---
trigger: always_on
description: Core agent operational rules, verification limits, and on-demand architecture directives.
globs: "**/*"
---

# AGENT OPERATIONAL RULES — MATH TREE

## 1. STRICT VERIFICATION & TOOL LIMITS
- **Zero Global Tests:** NEVER run `npm test`, `vitest run`, `jest`, or full suites. Targeted single-file verification ONLY (e.g. `npx vitest run <file> --reporter=dot` or `npx tsc --noEmit`). Zero tests for CSS/copy.
- **Browser & Integration Tests (Playwright / Puppeteer):** Committed integration test suites and targeted browser verification scripts are welcomed and supported for verifying app workflows, county GIS feeds, and user-facing features.
  - Integration tests run locally in headless Chromium without burning agent tokens for test execution.
  - For any change that affects what the user sees or does in the app, verify it via browser checks before opening the PR so the user doesn't have to.
  - Never use real user credentials and never write to live customer data. Stick to read-only views or demo data.
  - Report what you saw in the PR description (pages/flows checked, screenshot or short description, anything off). Stop the local dev server when done.
- **Ban Scratch Scripts:** Never generate temporary patch scripts (`scratch/fix_*.js`). Edit directly.
- **Impasse Breaker:** If any tool fails twice with the same error, HALT immediately.

## 2. ARCHITECTURAL BLUEPRINT (ON DEMAND)
- **Do Not Guess Schemas:** For database entities, Supabase tables/views, math formulas, or component layouts, read `@ARCHITECTURE.md` on demand.

## 3. GIT WORKFLOW & PR PROCEDURE (STRICT BRANCH ISOLATION)
- **No Direct Pushes to Main:** You are STRICTLY FORBIDDEN from pushing directly to `main`.
- **Isolated Branches:** All code modifications, investigations, and refactors MUST be developed on an isolated Git branch (e.g., `feat/*`, `fix/*`, `perf/*`).
- **Post via Pull Request:** Once tasks and single-file verifications are complete, push the isolated branch to `origin` and present the PR link for the user to review and merge into `main`.

## 4. NO PLAN DOCS IN THE REPO
- **Never commit plans, design notes, status trackers or progress logs** (e.g. `*_PLAN.md`, `NOTES.md`). They go in the chat thread or the project's shared folder.
- Decisions that must outlive a task belong in `ARCHITECTURE.md`, kept short and current.


## 5. ENGINE RULES (SHORT)
- **No invented inputs.** The engine never supplies a default. A figure is stated on the deal or filled live from the owner's investor profile; if neither, the engine throws `IncompleteInputsError` and the screen asks. Do not add a fallback number anywhere (engine, chart, brief).
- **One calculator.** Never compute a metric in the UI, SQL or an edge function; call the shared engine through `src/lib/engine/compute.ts`.
- **Changing a computed number** means bumping `ENGINE_VERSION` (`src/lib/engine/version.ts`) and updating the golden snapshot on purpose.
- **Live data.** Real writes only when the user explicitly asks; tests and dev work never touch or mix with customer deals. SQL is reviewed, applied by hand, and recorded in `supabase/migrations_draft/README.md`.
