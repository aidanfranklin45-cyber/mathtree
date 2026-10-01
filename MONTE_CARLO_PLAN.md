# Monte Carlo: why it is slow, why it stopped looking normal, and the plan to fix both

Status: **Phase A is implemented** (this branch). Phases B1, B2 and C are next. Decisions from the owner are in section 4.
Measured 2026-09-30 on the owner's real deals (read-only), 1,000 runs, node, a seeded random source so runs are repeatable.

## Summary

| Symptom | Cause | Size of the problem |
|---|---|---|
| Takes seconds to populate | A projection of a deal **with lease objects** costs **3.2 ms** vs **0.05 ms** without (about 65x). About three quarters of that is building human-readable text (`toLocaleString`) that the simulation never reads. The simulation runs on the browser's main thread, re-runs on every change, and nothing caches it. | 1,000 runs = **1.9 to 3.4 s** on lease-based deals (the code comment still claims 16 ms) |
| Not a bell curve any more | (1) **Rent-growth volatility is ignored whenever the deal has leases** (a whole input is dead). (2) Lease income is contractual, so it really is low-variance. (3) With almost no equity (Stop and Go: $12k on $300k) IRR is insensitive to everything except early cash flow. (4) The histogram builder always lumps the bottom and top 5% into end bars and can fabricate a window. | 80% of runs land in one bar; p25 to p95 spans about 3 IRR points |
| "Something is wrong with the engine?" | **No.** Today's engine fixes (going-in cap, lease-expiry default) barely moved the shape. The same spiky distribution appears on every engine version since the migration. The change you noticed is the move to explicit leases. | see table 3 |

## 1. Evidence: speed

Table 1: cost per projection and per 1,000-run simulation (current `main`, engine 2026-09-30.4)

| Deal | Leases | Hold | 1 projection | 1,000-run simulation |
|---|---|---|---|---|
| Spokane Dirt Pit | 0 | 10 y | 0.07 ms | 24 ms |
| The Fields | 1 | 10 y | 2.07 ms | 1.9 s |
| 301 Pleasant | 1 | 15 y | 3.67 ms | 2.9 s |
| Stop and Go (two lease periods) | 2 | 15 y | 3.62 ms | 3.2 s |

Table 2: where a lease projection spends its time (Stop and Go)

| Variant | ms per projection |
|---|---|
| As is (2 leases, 15 years) | 3.20 |
| Leases removed | 0.05 |
| Same, `Number.prototype.toLocaleString` stubbed out | 0.80 |
| `resolveLeaseMonthlyRent` alone, 360 calls (what the engine makes) | 2.33 |

The engine evaluates every lease for every month of the hold (2 leases x 12 months x 15 years = 360 calls per projection). Each call builds a provenance string (`$2,600/mo (3x +3% Escalation)`) with `toLocaleString`, pushes a per-month receipt object, and re-parses the lease dates with regular expressions. The Monte Carlo needs none of that text. About 75% of the time is string formatting; most of the rest is repeated date parsing.

The UI makes it feel worse (`src/components/studio/tabs/SensitivityTab.tsx`):
* The effect depends on `merged`, which is memoized on the `deal` object. Any re-render that hands over a new deal object re-runs all 1,000 runs.
* Moving a volatility slider re-runs the whole simulation (250 ms debounce, then a blocking 3 s).
* It runs synchronously on the main thread, so the page freezes. There is no cancel, no progress and no cache.

## 2. Evidence: shape

Stop and Go, seed 4242, 1,000 runs. "Bins" are the 10 histogram bars, left to right.

Table 3: it is not today's engine changes

| Engine | mean | median | sd | p5 | p95 | bins |
|---|---|---|---|---|---|---|
| PR #50 (migration) | 55.85 | 59.27 | 11.33 | 21.84 | 60.34 | 50,5,3,0,0,0,1,93,802,46 |
| before lease-expiry defaults | 55.85 | 59.27 | 11.33 | 21.84 | 60.34 | identical |
| before cap-rate fix | 57.61 | 60.60 | 9.67 | 27.86 | 61.64 | 50,6,2,0,0,0,3,105,784,50 |
| current `main` | 57.61 | 60.60 | 9.67 | 27.86 | 61.64 | identical |

Table 4: which inputs move the result (Stop and Go, leases present)

| Run | mean | sd | p5 | p50 | p95 | bins |
|---|---|---|---|---|---|---|
| rent-growth volatility **0**, others 0 | 58.05 | 9.86 | 27.13 | 60.6 | 60.6 | 50,14,0,0,0,0,0,0,936,0 |
| rent-growth volatility **3**, others 0 | 58.05 | 9.86 | 27.13 | 60.6 | 60.6 | **identical** |
| exit-cap volatility 200 bps only | 58.18 | 9.81 | 27.14 | 60.57 | 61.59 | 50,14,0,0,0,0,0,0,886,50 |
| 25% down, defaults | 21.63 | 2.64 | 14.54 | 22.22 | 23.43 | 50,12,2,0,0,0,62,441,384,49 |
| **no lease objects**, defaults | 61.72 | 11.71 | 30.21 | 64.13 | 72.77 | 50,10,3,1,17,56,227,351,235,50 |
| **no lease objects**, 25% down | 22.60 | 3.71 | 15.80 | 23.13 | 27.40 | 50,21,34,57,140,190,199,174,86,49 (a bell) |
| The Fields (1 lease, normal equity) | 6.95 | 1.16 | 4.94 | 6.99 | 8.80 | 49,43,79,123,158,180,142,105,71,50 (a bell) |

### Root causes

1. **Dead input.** `runMonteCarlo` samples `rentGrowth`, but with explicit leases the engine takes rent from each lease's own `escalationRate` (`resolveLeaseMonthlyRent`). Sampled rent growth is never read. The "no lease objects" rows prove it: growth applies there and the curve returns.
2. **Contract income is low-variance by nature.** A signed NNN lease with fixed bumps should not swing much. A spike is partly the right answer. The model should say so rather than look broken.
3. **IRR is degenerate at near-zero equity.** With 0% down, $12k of cash on a $300k asset, IRR is roughly "early cash flow / $12k". The exit value is discounted by about 1.6^15, so exit cap and appreciation barely register. A normal-looking curve is not achievable for IRR on this deal; a different measure (profit in dollars, equity multiple, NPV) would be.
4. **Vacancy shock regime.** For commercial deals 6% of runs draw a 25% to 50% vacancy. That is one deliberate fat tail, not a normal draw. It fills the left end bar.
5. **Histogram builder** (`buildAdaptiveHistogramBins`): the first and last bars are always the bottom 5% and top 5% (about 50 runs each by construction), and if the middle 90% spans under 1 point it invents a 5-point window. Both make a tight distribution look like a spike with two stumps.
6. **Not random-seeded.** Every render draws new random numbers, so the chart changes shape and numbers each time it re-runs.

## 3. Implementation plan

Each phase is its own PR. Phases A and B1 change no numbers a user relies on. Do them first.

### Phase A: make it fast (no change in results): **DONE on `perf/monte-carlo-phase-a`**

Result: 1,000 runs went from 2.9 s / 3.2 s / 1.9 s to **0.21 s / 0.39 s / 0.16 s** on 301 Pleasant / Stop and Go / The Fields (about 8 to 14 times faster), with the same seeded results to the last digit. What shipped: lean evaluation (`calculateProjections(..., { lean: true })`, `resolveLeaseMonthlyRent(..., { lean: true })`), lease dates parsed once and cached, the simulation as a runner that advances in slices (`createMonteCarloRunner`), the tab running it in slices with cancel and no re-run when the deal object is merely re-created, the unused legacy `runMonteCarloSimulation` removed, and tests (lean equals full, slices equal one-shot, a speed budget). Not done from the original list: a Web Worker (not needed at this speed; slices keep the page responsive).
1. **Lean evaluation in the engine.** Add an options flag (for example `calculateProjections(asset, inputs, { lean: true })`) that skips provenance text, the per-month receipt list and rate buckets. `resolveLeaseMonthlyRent` gets a lean path that returns only rent and active state.
2. **Parse lease dates once per projection**, not once per lease-month.
3. **Monte Carlo calls the lean path.** Target at most 0.4 ms per lease projection, so 1,000 runs finish in under half a second.
4. **Run it off the main thread** (a Web Worker) in chunks of about 200 runs, with a progress indicator and cancel on input change.
5. **Stop auto-thrashing.** Re-run on slider release (not on every tick), key the result cache by a hash of the inputs, and keep the previous result on screen while recomputing. Make `merged` depend on the deal's inputs, not on the object identity.
6. **Tests:** lean and full output must be identical for all fixtures (no result change allowed); a generous performance budget test (for example under 2 ms per projection with leases) to catch regressions.

### Phase B1: remove misleading display (no model change)
1. Replace the percentile-clipped end bars with fixed-width bins across the 1st to 99th percentile plus two labelled overflow bars. Never invent a window; if the range is tiny, say "outcomes are tightly clustered".
2. Seed the random source from the deal (a hash of its inputs), so the same deal gives the same chart until it changes. Add an explicit "Re-run with a new seed" button.
3. Replace the stale "about 16 ms" comment with a measured note.

### Phase B2: fix the model (needs the owner's decisions below)
1. **Make rent growth live with leases.** Apply the sampled growth to everything not fixed by contract: rent steps at renewal or re-let, percentage escalators if the lease says "market" (CPI-style), and any uncontracted period. Fixed dollar bumps and fixed percentage bumps stay fixed unless the owner chooses "vary contractual escalators".
2. **Add tenant default as an explicit, labelled risk** (probability over the hold and a downtime length) in place of the hidden 6% vacancy shock, and let the owner set it.
3. **Add a dollar-profit view** (and equity multiple) next to IRR, and show a note when equity is under about 10% of price ("IRR is not a stable measure here"). Offer the choice in the chart.
4. **PDF brief uses the shared simulation** (`runMonteCarlo`, 1,000 runs, seeded from the deal id so the brief is repeatable) instead of its own 500-trial model. The brief shows the same tenant-default assumption, IRR and dollar-profit percentiles as the app.
5. **Antithetic sampling** (pair each draw with its mirror) to halve run-to-run noise at the same run count.

### Phase C: tests that would have caught this
* **Every sampled input must matter.** For each volatility the simulation exposes, a fixture where setting it to 0 versus a large value changes the output (this is the test that would have flagged the dead rent-growth input).
* Seeded golden outputs for three fixtures: a normal-equity single lease, a zero-equity deal, a no-income deal.
* A shape test on a normal-equity fixture: excess kurtosis and skew within agreed bounds, and no bin holding over 40% of runs.
* The performance budget from Phase A.

### Rollout
A (PR 1) then B1 (PR 2) are safe to ship straight away. B2 changes the numbers shown on the Sensitivity tab (not the pro-forma, baselines or PDF headline figures), so bump the engine version note and say so in the PR. Nothing here touches the database.

## 4. Decisions (owner, 2026-09-30)

1. **Contractual escalators do not vary** in the simulation. Only what the contract does not fix varies (renewals, re-lets, uncontracted periods).
2. **Tenant default is modelled as a labelled probability with downtime**, shown to the user and adjustable, replacing the hidden 6% vacancy shock.
3. **Show both profit in dollars and IRR**, for high loan-to-value deals as well as moderate ones. IRR is not hidden for high leverage; it gets a plain-language note when equity is thin, and dollar profit is shown beside it.
4. **Run when the Monte Carlo is run**: when the Sensitivity / Monte Carlo view is opened, and again on a deliberate change (re-run button, slider release), not on every re-render.
5. **Keep 1,000 runs.** The earlier bell curves at 1,000 runs showed that more runs add little; the fix is the model, not the run count. (The PDF moves from 500 to the same 1,000.)
6. **The PDF brief must use the same simulation.** `generate-pdf-brief` has its own separate 500-trial simulation (a different model that perturbs top-level rent, which the engine ignores whenever leases exist). It must call the shared `runMonteCarlo` so the brief and the app tell the same story (Phase B2).

## 5. Things I checked and ruled out
* The engine fixes from today (going-in cap, lease-expiry default, two lease periods): same shape before and after (table 3).
* The legacy `runMonteCarloSimulation` in `math-engine.ts` (500 iterations) is exported but nothing calls it; it can be deleted in Phase A.
* The 2D sensitivity grid is cheap (25 projections, about 90 ms with leases) and is not the slow part.
