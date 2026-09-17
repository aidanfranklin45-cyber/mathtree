# MathTree Architecture & Engineering Agent Protocol

> **PURPOSE**: This document is loaded automatically into your startup context upon session spin-up.
> It defines the system architecture, cloud boundaries, and the strict execution protocol for MathTree.
> You already know this architecture—do NOT ask the user to re-explain it or echo it redundantly in task prompts.

---

## 0. CRITICAL: Tool Disambiguation (MathTree Queue vs GitHub)
- **MathTree tasks are NOT GitHub issues.**
- **DO NOT CALL GitHub MCP tools (`get_issue`, `list_issues`, `search_issues`)** to search for or claim tasks.
- MathTree tasks are managed exclusively via the **`mathtree-queue` MCP server** (configured in `.mcp.json` via Studio harness):
  ```json
  call_mcp_tool(ServerName: "mathtree-queue", ToolName: "claim_next_task", Arguments: {})
  ```
- The `github` MCP tools are strictly for repository VCS operations (like pull requests) after code verification, NEVER for queue discovery or task lookup.

---

## 1. TARGETED VERIFICATION (NO MONOLITHIC TEST RUNS AT TURN 1)

> **CRITICAL RULE**: **NEVER RUN `node test.js` BEFORE MAKING CHANGES.**
> Pre-flight test runs on an existing repository are forbidden—they burn context tokens and flood the terminal with output.

1. **TARGETED TEST FILTERS ONLY**:
   - `test.js` supports CLI keyword filtering: `node test.js <keyword>`.
   - Examples:
     - `node test.js projections` (runs ONLY the 3 projection tests in 0.08s)
     - `node test.js payment` (runs ONLY the 3 payment calculation tests in 0.08s)
     - `node test.js commercial` (runs ONLY the commercial underwriting tests)
   - **NEVER run bare `node test.js` without a filter.** Bare runs execute 70+ tests and fail on browser-DOM mocks.
2. **VERIFY ONLY AFTER SURGICAL EDITS**:
   - Edit the target files first based on the task's line provenance.
   - Run only the targeted test command specified in your task envelope.
3. **DO NOT ATTEMPT TO FIX UNRELATED TEST FAILURES**:
   - If tests in `test.js` fail on browser globals (`session.js`, `profile.js`), ignore them. Do not edit `dashboard.html` or `profile.js`.

---

## 2. THE ANTI-MASKING & ESCALATION LAW (NEVER CUT USER ERRORS)

> **CORE PRINCIPLE**: When you encounter an error or failing test that the user created, **YOU DO NOT GET TO CUT IT, DELETE IT, OR BRANCH AROUND IT.**
> - **NEVER edit test files to delete failing assertions to fake a pass.** (Illegal Test Masking)
> - **ARCHITECTURAL TEST RETIREMENT EXCEPTION**: In `ARCHITECTURAL_OVERHAUL` mode, when a task contract explicitly directs that a specific test will no longer be valid or used because calculation authority was shifted to the backend, you ARE authorized to update `test.js` imports and remove that specific obsolete test as instructed by the contract requirements.
> - **NEVER rewrite unrelated files to force a test suite to pass.**
> - **NEVER branch away to hide an intentional error.**
> - **NEVER mark complete with 0 files changed (`files_changed: []`).** MathTree tasks require concrete code modifications. If a task requires dynamic offloading or backend migration that is not yet wired, you must make the code changes or call `escalate_task`—never call `complete_task` on a passive inspection.
> 
> **WHAT TO DO INSTEAD: SEND IT BACK (ESCALATE)**:
> If you are unable to complete a task because of an intentional error, missing backend architecture, or dynamic Supabase requirement:
> 1. Call `escalate_task(task_id, missing_path, reason)`.
> 2. Clearly explain to the user WHY you are unable to do that task.
> 3. Stop execution immediately. An honest escalation is infinitely more valuable than an agent hacking files to fake completion.

---

## 3. Calculation Architecture: Dynamic Supabase Offloading

MathTree is actively shifting from legacy client-side calculations (`math.js`) to **modern dynamic offloading via Supabase Edge Functions**:

1. **Authoritative / Dynamic Calculations (Supabase Edge Functions - TARGET ARCHITECTURE)**:
   - Location: `supabase/functions/` (Deno TypeScript).
   - Key Functions: `edit-property-inputs`, `simulate-monte-carlo`, `create-project`.
   - Backend Math Engine: `supabase/functions/edit-property-inputs/math-engine.ts`.
   - **Whenever a task asks for dynamic calculations, database-backed numbers, or Supabase integration**, it belongs in a **Supabase Edge Function** pulling live from PostgreSQL (`properties`, `deals`, `leases`).
2. **Instant / Reactive Calculations (Client UI Sliders Only)**:
   - Location: `math.js` (vanilla JS) and `src/lib/math/calculator.ts`.
   - Purpose: Pure deterministic math for in-memory slider updates and instant UI charts. Zero database calls.

---

## 4. Focus & Token Conservation Rules (NO JUNK COMMANDS)

1. **NO RUNAWAY BUILDS OR TS SPIRALS**:
   - **DO NOT run `npm run build`** during math or backend tasks.
   - **DO NOT run `npx tsc --noEmit`** unless your task is explicitly to fix TypeScript type errors.
   - **DO NOT edit `src/lib/math/types.ts`** unless specifically requested.
2. **NO SHELL WRAPPER SCRIPTS**:
   - **NEVER** write ad-hoc node scripts like `node -e "try { execSync(...) } catch ..."` or PowerShell stderr filters. Run direct commands only.

---

## 5. Standard Task Lifecycle

1. **Claim Task**: `call_mcp_tool(ServerName: "mathtree-queue", ToolName: "claim_next_task", Arguments: {})`
2. **Check Operation Mode**: Read whether the task contract specifies `SURGICAL_PATCH` or `ARCHITECTURAL_OVERHAUL`.
3. **Branch**: `git checkout -b fix/<task-id>`
4. **Edits FIRST**: Apply changes to target files FIRST using line provenance before running tests.
5. **Targeted Verification**: Run only the permitted targeted filter command (e.g. `node test.js projections`).
6. **Escalation Protocol (Send It Back)**: If the task hits an intentional user error, missing Edge Function, or architectural blocker, call `escalate_task` and explain why you cannot complete it.
7. **Completion**: If fully verified within scope, call `complete_task` and immediately end the turn.

---

## 6. User-Mandated Operation Modes (Surgical vs. Architectural)

MathTree Studio places the user in complete command of whether a task is executed surgically or architecturally. When claiming a task via `claim_next_task`, Antigravity MUST honor the active operation mode specified in the execution contract:

### 1. `SURGICAL_PATCH` (🎯 Scalpel Mode)
- **Scope**: 1–2 files maximum.
- **Rules**: Strict line preservation. Guard against division by zero, patch off-by-one errors, or fix isolated math bugs.
- **Preservation**: Strictly preserve existing files (`math.js`, `mathtree-client.js`), backwards compatibility, and offline fallbacks. Do NOT delete or deprecate legacy files.

### 2. `ARCHITECTURAL_OVERHAUL` (⚡ Sledgehammer Mode - Reimagining the Wheel)
- **Scope**: Structural migration of heavy calculations from client JavaScript to Supabase Edge Functions.
- **Philosophy**: Stop band-aid fixes on slow, frail client JavaScript. Shift proforma modeling, multi-year NOI, and cash flow schedules onto Supabase Edge Functions (`supabase/functions/edit-property-inputs/`).
- **File Boundary**: Do NOT delete entire foundational files (`math.js`, `mathtree-client.js`, `project.html`). Retain file existence, but fundamentally overhaul their contents and division of labor.
- **Division of Labor**:
  1. `supabase/functions/edit-property-inputs/`: The sole authoritative engine for multi-year proforma projections and NOI.
  2. `mathtree-client.js`: Data transport & store sync layer. Fetches dynamic metrics from the Edge Function and syncs `useDealStore`. Does not run proforma loops in the browser.
  3. Root `math.js`: Pared down to lightweight UI slider helpers (`calculateMonthlyPayment`, `calculateRemainingBalance`). Strip out heavy proforma loops (`calculateProjections`, `calculateMonthlyProjections`).
- **No Duplicate Offline Proforma Loops**: Do NOT retain duplicate proforma projection engines in client memory under the guise of an offline fallback. Backend Edge Functions are the single source of truth.
- **Test Suite Alignment**: When calculation authority is shifted to Supabase Edge Functions, client tests asserting on excised functions will no longer be used once completed. The task contract will direct you to remove or update those specific obsolete tests in `test.js`, and verify against tests that remain valid and used (e.g. lightweight slider helpers).
