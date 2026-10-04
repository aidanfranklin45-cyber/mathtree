---
trigger: always_on
description: Core agent operational rules, verification limits, and on-demand architecture directives.
globs: "**/*"
---

# AGENT OPERATIONAL RULES — MATH TREE

## 1. STRICT VERIFICATION & TOOL LIMITS
- **Zero Global Tests:** NEVER run `npm test`, `vitest run`, `jest`, or full suites. Targeted single-file verification ONLY (e.g. `npx vitest run <file> --reporter=dot` or `npx tsc --noEmit`). Zero tests for CSS/copy.
- **Brief Browser Checks (Playwright allowed):** For any change that affects what the user sees or does in the app, look at it in a browser before opening the PR so the user doesn't have to.
  - Use short, targeted Playwright runs: headless Chromium, one flow at a time, against the local dev server (`npm run dev`) or the PR preview URL. Screenshots are allowed. Stop the dev server when done.
  - Never use real user credentials and never write to live data. Stick to read-only views or demo data.
  - Report what you saw in the PR description (pages/flows checked, screenshot or short description, anything off). If the browser can't reach the app, say so rather than skipping silently. In cloud sandboxes, Chromium is at `/opt/pw-browsers/chromium` (use `playwright-core` with that `executablePath`; don't run `playwright install`), and third-party CDNs (Tailwind, jsDelivr, Google) may be blocked, so a few landing-page scripts can fail there.
  - Keep it brief: no full E2E suites, no long-running or background previews, no committed Playwright scripts or screenshots (see Scratch Scripts). Zero browser checks for pure copy/CSS-token tweaks nobody would see differently.
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

