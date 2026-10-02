# Remodel Scenarios for Owned Properties: Plan

**Goal:** on a property we already own, model a major remodel or expansion (capex, downtime, higher rent, higher value) as an
alternate state, and judge it as a new investment against doing nothing. Live numbers never change until we actually do it.

**Design rules**
- Main pages (Dashboard, Studio tabs, Operations) get no new widgets, cards or columns.
- Entry points are menu items only. Everything else lives in one modal and the existing Compare studio.
- Compute-on-the-fly (MIGRATION_PLAN.md): we store the *plan's inputs* (facts), never its results.
- One engine. No second calculator.

## What already exists (reuse, don't rebuild)
| Need | Existing piece |
|---|---|
| Alternate state without touching the deal | `computeDealMetrics(deal, overrides)` in `src/lib/engine/compute.ts` |
| Side-by-side Live vs Baseline vs what-if | Compare studio: `ComparisonColumn.overrides`, `WhatIfScrubberBar`, owned scope in `compareTypes.ts` |
| Adopt a scenario as the new truth | `dealWithScenario` + `replaceBaseline` (`src/lib/baselines/db.ts`) |
| Studio menu for owned deals | kebab menu in `StudioNavbar.tsx` (owned already hides Diligence) |
| Modal pattern | `ParameterHistoryModal`, `EditInputsModal` |
| Scenario history | `src/lib/scenarios.ts` (`recordScenarioRun`) |

## Gap: the engine can't model "capex and a rent step mid-hold"
`rehabCosts` is a day-1 cost and rent is flat from year 1 (`math-engine.ts` ~615-710, ~985-1010). A remodel happens in year N,
loses rent during construction, then steps rent up. So the engine needs one small, additive extension.

## Data model (no migration)
Store plans in the deal's existing `inputs` JSON as `remodelPlans: RemodelPlan[]` (RLS and sharing are inherited; the engine
ignores unknown keys, so live math is unchanged while a plan sits unused).

```ts
interface RemodelPlan {
  id: string; name: string;                    // "Add 2 units", "Expand rear 4,000 sf"
  startDate: string;                           // when work begins
  durationMonths: number;                      // construction period
  cost: number;                                // total capex
  financing: 'cash' | 'new_loan';              // new_loan uses loanRatePct, loanTermYears, ltcPct
  rentDuringWorksPct: number;                  // % of current rent still collected (0 = fully down)
  rentAfter: { mode: 'monthly' | 'pct_increase' | 'per_sf'; value: number; addedSf?: number };
  extraOpexAnnual?: number;                    // added tax/insurance/mgmt from bigger building
  valueMode: 'cap_rate' | 'manual';            // value = new NOI / cap rate, or typed ARV
}
```

## Phases (each PR-sized, ships alone, `tsc --noEmit` + single-file vitest only)

### Phase 1: Engine support (pure, no UI)
- Add optional `remodel` input handled in the projection loop: from `startDate` apply `rentDuringWorksPct` for `durationMonths`,
  then new rent and `extraOpexAnnual`; spend `cost` at start (cash) or add a second amortizing loan (`new_loan`); value after
  completion from new NOI / cap rate or manual ARV.
- Gate everything on `inputs.remodel` being present, so deals without it are byte-identical.
- **Files:** `supabase/functions/_shared/math-engine.ts`, `types.ts`, `src/lib/math/types.ts`.
- **Test:** new `src/lib/engine/remodel.test.ts` (cost, downtime, rent step, DSCR during works) and the existing golden test
  must stay unchanged.

### Phase 2: Evaluation function (pure)
`src/lib/remodel/` with `applyRemodel(deal, plan) -> overrides` and `evaluateRemodel(deal, plan)`, which runs base vs remodel
through the engine and returns the incremental view:
- Yield on cost = added NOI / cost
- Value created = added NOI / cap rate - cost
- Incremental IRR and equity multiple on the remodel dollars only (remodel-case cash flows minus base-case, including exit delta)
- Payback years, minimum DSCR during works, peak cash needed
- **Test:** `src/lib/remodel/evaluate.test.ts`.

### Phase 3: Studio menu + one modal
- `StudioNavbar` kebab: add "Remodel scenarios" (owned deals only). Nothing else on the page changes.
- `RemodelModal`: plan list on the left, a short form on the right (name, cost, months, rent after, financing; advanced fields
  collapsed), result strip of 4 figures (yield on cost, value created, incremental IRR, payback), and buttons Save / Compare.
- Saving writes `remodelPlans` through the existing `patchDeal` path (and logs a scenario run).
- **Files:** `StudioNavbar.tsx`, `DealStudioPage.tsx` (modal state only), new `src/components/studio/modals/RemodelModal.tsx`.

### Phase 4: Compare studio column
- Add `'remodel'` to `ScenarioPresetType`; for an owned deal, each saved plan appears as an extra column next to Live and
  Baseline (overrides come from `applyRemodel`). Compare is where the full-deal side-by-side lives, so nothing new on Studio.
- "Compare" in the modal deep-links here (`/compare?deal=<id>&scope=owned`).
- **Test:** extend `src/lib/compare/compare.test.ts`.

### Phase 5: Commit it (when we actually do the remodel) [built]
- "Commit to live" in the modal sets the live deal's `inputs.remodel` (the same block the engine already understands, placed by
  its own dates), records `remodelCommitted`, and removes the plan from the list. Every page then includes the remodel.
- The Acquisition Baseline is untouched, so Compare shows exactly what the remodel changed. "Move back to plans" undoes it.
- One remodel can be committed at a time; evaluating another is disabled until it is moved back.
- **Test:** `src/lib/remodel/commit.test.ts`.

## Out of scope for now
Permit and entitlement timelines, multi-phase draw schedules, cost-overrun Monte Carlo (can reuse `runMonteCarloSimulation`
later), and PDF brief changes.

## Open questions (defaults assumed if you don't object)
1. **Expansion = more rent how?** Default: rent after is entered as a monthly total, % increase, or $/sf on added sf. OK?
2. **Financing:** default is cash or a new loan on the remodel only. Cash-out refi of the whole property deferred.
3. **Time axis for owned deals:** I haven't verified how the engine treats a past `closingDate` (stub year). Phase 1 starts by
   confirming this with a failing test before changing the loop.
