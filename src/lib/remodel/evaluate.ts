import type { DealMetrics, DealRecord } from '../math/types';
import { computeDealMetrics } from '../engine/compute';
import { calculateIRR } from '../engine';
import { applyRemodel, planStartYear, type RemodelPlan } from './plan';

type EvalDeal = Pick<DealRecord, 'asset_class' | 'inputs' | 'purchase_price' | 'assetType'>;

export interface RemodelEvaluation {
  ok: true;
  base: DealMetrics;
  after: DealMetrics;
  /** Added NOI in the first full year after completion, divided by the cost. Percent. */
  yieldOnCost: number | null;
  /** Added value in that year, minus the cost. */
  valueCreated: number | null;
  /** IRR on the remodel dollars alone: the after case minus the base case, including the change in exit equity. Percent. */
  incrementalIrr: number | null;
  incrementalMultiple: number | null;
  /** Years from the start of work until cumulative extra cash flow turns positive; null if it never does within the hold. */
  paybackYears: number | null;
  /** Most extra cash the owner has to put in at once (a positive number). */
  peakCashNeeded: number;
  /** Lowest DSCR from the start of work through the completion year, and the base case's in the same years. */
  minDscrDuringWorks: number | null;
  baseMinDscrDuringWorks: number | null;
  /** Whole-deal change: after minus base. */
  irrChange: number;
  npvChange: number;
  equityMultipleChange: number;
  /** The extra cash flow per calendar year (after minus base), with the exit-equity change on the last year. */
  incrementalCashFlows: Array<{ calendarYear: number; cashFlow: number }>;
  /** Plain-language things the owner should know (never blocks the numbers). */
  warnings: string[];
}

export type RemodelEvaluationResult = RemodelEvaluation | { ok: false; reason: string };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const dscrOf = (p: any): number | null => (p?.dscr === null || p?.dscr === undefined || isNaN(Number(p.dscr)) ? null : Number(p.dscr));

/** Run a plan against doing nothing, through the same engine as everything else. Pure: nothing is stored or changed. */
export function evaluateRemodel(deal: EvalDeal, plan: RemodelPlan): RemodelEvaluationResult {
  if ((deal.inputs as any)?.remodel) return { ok: false, reason: 'A remodel is already committed on this property. Move it back to the plans to compare another.' };
  if (!(num(plan.cost) > 0)) return { ok: false, reason: 'Enter what the remodel will cost.' };
  const startYear = planStartYear(plan);
  if (startYear === null) return { ok: false, reason: 'Enter a start month.' };

  const overrides = applyRemodel(deal, plan);
  const rem: any = overrides.remodel;
  if (!(rem.rentUpliftMonthly > 0) && plan.valueMode !== 'manual') {
    return { ok: false, reason: 'The plan does not add any rent. Enter the new rent.' };
  }

  let base: DealMetrics;
  let after: DealMetrics;
  try {
    base = computeDealMetrics(deal);
    after = computeDealMetrics(deal, overrides);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'The numbers could not be calculated.' };
  }
  const meta: any = (after as any).remodel;
  if (!meta) return { ok: false, reason: 'This plan could not be applied. Check the start month and cost.' };

  const bp: any[] = base.projections ?? [];
  const ap: any[] = after.projections ?? [];
  const warnings: string[] = [];
  const exitYearIdx = Math.max(1, Math.min(ap.length, Math.round(num((deal.inputs as any)?.exitYear)) || ap.length));
  const completionYear = Math.floor((meta.completionIdx - 1) / 12);
  const lastYear = num(ap[ap.length - 1]?.calendarYear);
  if (startYear > lastYear) return { ok: false, reason: 'The work starts after the hold period ends.' };

  // Extra cash flow by year; the change in exit equity lands on the exit year
  const incremental = ap.slice(0, exitYearIdx).map((p, i) => ({ calendarYear: p.calendarYear as number, cashFlow: num(p.cashFlow) - num(bp[i]?.cashFlow) }));
  if (incremental.length > 0) incremental[incremental.length - 1].cashFlow += num(ap[exitYearIdx - 1]?.exitProceedsNet) - num(bp[exitYearIdx - 1]?.exitProceedsNet);

  // Incremental IRR and multiple, starting at the first year money goes out
  const firstOut = incremental.findIndex((r) => r.cashFlow < -0.5);
  let incrementalIrr: number | null = null;
  let incrementalMultiple: number | null = null;
  if (firstOut >= 0) {
    const series = incremental.slice(firstOut).map((r) => r.cashFlow);
    const rest = series.slice(1);
    if (rest.some((x) => x > 0)) {
      const irr = calculateIRR(-series[0], rest);
      incrementalIrr = irr !== 0 ? irr : null;
    }
    const invested = series.filter((x) => x < 0).reduce((s, x) => s - x, 0);
    const returned = series.filter((x) => x > 0).reduce((s, x) => s + x, 0);
    incrementalMultiple = invested > 0 ? Math.round((returned / invested) * 100) / 100 : null;
  }

  // Peak cash and payback, from operating cash flow only (exit equity excluded: payback is about getting the money back)
  let cumulative = 0;
  let peak = 0;
  let paybackYears: number | null = null;
  const opDeltas = ap.slice(0, exitYearIdx).map((p, i) => num(p.cashFlow) - num(bp[i]?.cashFlow));
  const startIdx = Math.max(0, ap.findIndex((p) => p.calendarYear === startYear));
  for (let i = startIdx; i < opDeltas.length; i++) {
    const before = cumulative;
    cumulative += opDeltas[i];
    peak = Math.max(peak, -cumulative);
    if (paybackYears === null && before < 0 && cumulative >= 0) {
      paybackYears = Math.round(((i - startIdx) + (-before) / (cumulative - before)) * 10) / 10;
    }
  }

  // Stabilised year: the first full year after completion
  const stabIdx = ap.findIndex((p) => p.calendarYear === completionYear + 1);
  let yieldOnCost: number | null = null;
  let valueCreated: number | null = null;
  if (stabIdx >= 0 && bp[stabIdx]) {
    const addedNoi = num(ap[stabIdx].netOperatingIncome) - num(bp[stabIdx].netOperatingIncome);
    yieldOnCost = Math.round((addedNoi / num(plan.cost)) * 10000) / 100;
    valueCreated = Math.round(num(ap[stabIdx].propertyValue) - num(bp[stabIdx].propertyValue) - num(plan.cost));
  } else {
    warnings.push('The work finishes too late in the hold period to measure a full year of benefit.');
  }

  // Coverage while the building is torn up
  const inWorks = (p: any) => p.calendarYear >= startYear && p.calendarYear <= completionYear;
  const dscrs = ap.filter(inWorks).map(dscrOf).filter((x): x is number => x !== null);
  const baseDscrs = bp.filter(inWorks).map(dscrOf).filter((x): x is number => x !== null);
  const minDscrDuringWorks = dscrs.length ? Math.min(...dscrs) : null;
  const baseMinDscrDuringWorks = baseDscrs.length ? Math.min(...baseDscrs) : null;
  if (minDscrDuringWorks !== null && minDscrDuringWorks < 1) {
    warnings.push(`Income does not cover the loan payments during the work (lowest coverage ${minDscrDuringWorks.toFixed(2)}x). The owner funds the gap.`);
  }
  if (num(plan.rentDuringWorksPct) >= 100 && num(plan.durationMonths) > 0) warnings.push('Rent is assumed unaffected during construction.');

  return {
    ok: true,
    base,
    after,
    yieldOnCost,
    valueCreated,
    incrementalIrr,
    incrementalMultiple,
    paybackYears,
    peakCashNeeded: Math.round(peak),
    minDscrDuringWorks,
    baseMinDscrDuringWorks,
    irrChange: Math.round((num(after.irr) - num(base.irr)) * 100) / 100,
    npvChange: Math.round(num(after.npv) - num(base.npv)),
    equityMultipleChange: Math.round((num((after as any).equityMultiplier) - num((base as any).equityMultiplier)) * 100) / 100,
    incrementalCashFlows: incremental,
    warnings,
  };
}
