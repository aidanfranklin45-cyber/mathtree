// _shared/monte-carlo.ts
// Stochastic simulation of a deal's return. Pure: (inputs, options) -> result. Runs in the browser and in Deno, and is the ONE
// simulation behind both the app's Sensitivity tab and the PDF brief. Every run is scored by the ONE shared engine
// (calculateProjections), so it can never disagree with the numbers shown elsewhere. Nothing here is stored.
//
// What is random, and what is not:
//   * Contractual rent never varies (a signed lease with fixed bumps is fixed). Market rent after a lease ends drifts with the sampled
//     rent growth (marketRentDrift in the engine); without leases the sampled growth applies to the whole rent.
//   * Tenant default is an explicit, labelled risk: a probability over the hold and a downtime, not a hidden vacancy shock.
//   * Residential tenants (apartments and houses) move out: each tenant has a yearly chance of leaving, then the space sits vacant for a
//     stretch and costs a make-ready charge before a new tenant pays the same rent. The vacant stretch is calibrated so the average
//     vacancy matches the deal's own vacancy setting; the spread around that average is what the simulation adds. Fixed-term tenants
//     can only leave after their lease ends; month-to-month tenants can leave any time.
//   * Exit cap rate, appreciation, vacancy and cost inflation are sampled as before.
// Both profit in dollars and IRR are reported for every deal: IRR alone is unstable when equity is thin.

import { calculateProjections, createLeaseScheduleCache, normalizeAssetClass } from './math-engine.ts';

export interface MonteCarloOptions {
  runs?: number;
  rentGrowthVolPct?: number;
  vacancyVolPct?: number;
  exitCapSpreadBps?: number;
  apprecVolPct?: number;
  /** Chance (%) that a tenant defaults at some point in the hold. Default 10 for commercial and storage with income, else 0. */
  tenantDefaultProbPct?: number;
  /** Months with no rent after a default (then the rent resumes). Default 12. */
  tenantDefaultDowntimeMonths?: number;
  /** Residential: chance (%) that a tenant moves out in a year. Default 45 for apartments, 30 for houses (industry averages). */
  turnoverPct?: number;
  /** Residential: days a space sits vacant between tenants. Default: calibrated so the average vacancy matches the deal's vacancy rate. */
  turnoverDowntimeDays?: number;
  /** Residential: one-time make-ready cost per move-out ($). Default 1,500 for apartments, 2,000 for houses. */
  turnoverMakeReadyCost?: number;
  /** Return the investor wants to clear (%), for "probability of meeting the hurdle". Default: the deal's discount rate, else 8. */
  hurdleRatePct?: number;
  /** Makes a run repeatable: the same seed and inputs give the same result. Without a seed (or rng) every run is different. */
  seed?: number | string;
  /** Injectable uniform [0,1) source so tests can be deterministic. Takes precedence over `seed`. */
  rng?: () => number;
}

export interface MonteCarloHistogramBin {
  label: string;
  binStart: number;
  binEnd: number;
  count: number;
  isTail?: boolean;
}

export interface ProfitSummary {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p5: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  p95: number;
  /** Percent of runs that lose money (profit below zero). */
  probLoss: number;
  histogramBins: MonteCarloHistogramBin[];
}

export interface MonteCarloResult {
  runs: number;
  assetType: string;
  meanIrr: number;
  medianIrr: number;
  stdDev: number;
  minIrr: number;
  maxIrr: number;
  p5Irr: number;
  p10Irr: number;
  p25Irr: number;
  p50Irr: number;
  p75Irr: number;
  p90Irr: number;
  p95Irr: number;
  /** 95% Value-at-Risk expressed as the 5th-percentile IRR (the downside floor). */
  var95: number;
  /** Percent of runs with IRR > 0. */
  probabilityPositive: number;
  probNegativeIrr: number;
  probNegativeCashFlow: number;
  /** Percent of runs that clear the hurdle rate. */
  probAboveHurdle: number;
  hurdleRate: number;
  skewnessIndex: number;
  sharpeRatio: number;
  riskClassification: string;
  /** IRR distribution. */
  histogramBins: MonteCarloHistogramBin[];
  /** Net profit in dollars over the hold (all cash flows plus exit equity, minus the cash put in). */
  profit: ProfitSummary;
  /** Equity is thin when the cash put in is a small share of the price; IRR is then unstable and dollar profit is the steadier view. */
  equity: { cashInvested: number; pctOfPrice: number; thin: boolean };
  tenantDefault: { applies: boolean; probabilityPct: number; downtimeMonths: number; runsAffectedPct: number };
  turnover: {
    applies: boolean;
    annualPct: number;
    downtimeDays: number;
    makeReadyCost: number;
    /** True when the vacant stretch was set from the deal's vacancy rate (the default); false when the owner chose the days. */
    calibratedToVacancy: boolean;
    /** Average move-outs per run over the hold. */
    avgMoveOutsPerRun: number;
    /** Vacancy implied by the turnover rate and the vacant days (turnover x days / 365), as a percent. */
    impliedVacancyPct: number;
    dealVacancyPct: number;
  };
  seed: number | null;
  telemetry: {
    baselineRentGrowth: number;
    baselineVacancy: number;
    baselineExitMetric: number;
    exitMetricType: string;
    rentGrowthRange: [number, number];
    vacancyRange: [number, number];
    exitMetricRange: [number, number];
    /** What was varied and by how much (one standard deviation, in percentage points), so a report can state it. */
    volatility: {
      holdYears: number;
      /** True when signed lease rent is held fixed and only rent after a lease ends drifts. */
      contractualRentFixed: boolean;
      rentGrowthStdDev: number;
      /** Null for single-family, which uses a turnover-event model instead of a bell curve. */
      vacancyStdDev: number | null;
      exitMetricStdDev: number;
      appreciationStdDev: number;
      baselineAppreciation: number;
      costInflationMean: number;
      costInflationStdDev: number;
    };
  };
}

/** A simulation that can be advanced in slices, so a browser can keep the page responsive and cancel when inputs change. */
export interface MonteCarloRunner {
  readonly total: number;
  readonly completed: number;
  /** Runs up to `count` more trials (default: all that remain) and returns how many have completed. */
  step(count?: number): number;
  /** Summarises a finished simulation. */
  finish(): MonteCarloResult;
}

export const DEFAULT_TENANT_DEFAULT = { probabilityPct: 10, downtimeMonths: 12 } as const;

/**
 * Residential turnover defaults (industry averages, checked 2026-10): multifamily resident turnover runs about 40 to 50% a year with
 * about 41 vacant days per turn; single-family rentals run 30 to 45 vacant days per turn. Direct make-ready cost (lost rent is counted
 * separately as vacancy) is about $1,200 to $1,800 per apartment turn and $800 to $4,500 per house.
 */
export const DEFAULT_TURNOVER: Record<string, { annualPct: number; downtimeDays: number; makeReadyCost: number }> = {
  "multi-unit": { annualPct: 45, downtimeDays: 41, makeReadyCost: 1500 },
  "single-family": { annualPct: 30, downtimeDays: 40, makeReadyCost: 2000 },
};

const DAYS_PER_MONTH = 365 / 12;

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const p = parseFloat(String(v));
  return isNaN(p) ? undefined : p;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** A small, fast, well-distributed seeded generator (mulberry32). */
export function seededRandom(seed: number | string): () => number {
  let h = 1779033703;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^ (h >>> 16)) >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable numeric seed from any text (for example the deal's inputs), so the same deal always draws the same sample. */
export function seedFromText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/**
 * Fixed-width histogram over the 1st to 99th percentile, plus an overflow bar at each end only if something falls outside it.
 * Unlike a percentile-clipped chart it never lumps 5% into each end by construction, and it never invents a window: if every
 * value is (nearly) the same it returns one bar.
 */
export function buildFixedHistogram(
  sorted: number[],
  format: (v: number) => string,
  coreBins = 12,
): MonteCarloHistogramBin[] {
  const n = sorted.length;
  if (n === 0) return [];
  const lo = percentile(sorted, 0.01);
  const hi = percentile(sorted, 0.99);
  if (hi - lo < 1e-9) {
    return [{ label: format(lo), binStart: lo, binEnd: hi, count: n, isTail: false }];
  }
  const step = (hi - lo) / coreBins;
  const bins: MonteCarloHistogramBin[] = [];
  const below = sorted.filter((v) => v < lo).length;
  if (below > 0) bins.push({ label: `< ${format(lo)}`, binStart: sorted[0], binEnd: lo, count: below, isTail: true });
  const counts = new Array(coreBins).fill(0);
  for (const v of sorted) {
    if (v < lo || v > hi) continue;
    counts[Math.min(coreBins - 1, Math.floor((v - lo) / step))] += 1;
  }
  for (let i = 0; i < coreBins; i++) {
    const a = lo + i * step;
    const b = i === coreBins - 1 ? hi : a + step;
    bins.push({ label: `${format(a)} to ${format(b)}`, binStart: a, binEnd: b, count: counts[i], isTail: false });
  }
  const above = sorted.filter((v) => v > hi).length;
  if (above > 0) bins.push({ label: `> ${format(hi)}`, binStart: hi, binEnd: sorted[n - 1], count: above, isTail: true });
  return bins;
}

const money = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}M` : a >= 10_000 ? `${Math.round(a / 1000)}k` : a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${Math.round(a)}`;
  return `${v < 0 ? '-' : ''}$${s}`;
};

const summarizeProfit = (profits: number[]): ProfitSummary => {
  const n = profits.length;
  const sorted = [...profits].sort((a, b) => a - b);
  const mean = profits.reduce((s, x) => s + x, 0) / n;
  const variance = profits.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n;
  return {
    mean: Math.round(mean),
    median: Math.round(percentile(sorted, 0.5)),
    stdDev: Math.round(Math.sqrt(variance)),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[n - 1]),
    p5: Math.round(percentile(sorted, 0.05)),
    p10: Math.round(percentile(sorted, 0.1)),
    p25: Math.round(percentile(sorted, 0.25)),
    p75: Math.round(percentile(sorted, 0.75)),
    p90: Math.round(percentile(sorted, 0.9)),
    p95: Math.round(percentile(sorted, 0.95)),
    probLoss: round1((profits.filter((x) => x < 0).length / n) * 100),
    histogramBins: buildFixedHistogram(sorted, money),
  };
};

export function runMonteCarlo(
  rawAssetType: string,
  inputs: Record<string, any>,
  options: MonteCarloOptions = {},
): MonteCarloResult {
  const runner = createMonteCarloRunner(rawAssetType, inputs, options);
  runner.step(runner.total);
  return runner.finish();
}

export function createMonteCarloRunner(
  rawAssetType: string,
  inputs: Record<string, any>,
  options: MonteCarloOptions = {},
): MonteCarloRunner {
  const rng = options.rng ?? (options.seed !== undefined ? seededRandom(options.seed) : Math.random);
  const gaussian = (mean: number, stdDev: number): number => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return mean + Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * stdDev;
  };

  const assetType = normalizeAssetClass(rawAssetType);
  const runs = Math.min(Math.max(Math.round(options.runs ?? 1000), 100), 10000);
  const isCommercialOrStorage = assetType === 'commercial' || assetType === 'storage';

  const explicitLeases: any[] = Array.isArray(inputs.leases) ? inputs.leases : [];
  const rentedLeaseIdx: number[] = [];
  explicitLeases.forEach((l, i) => {
    if ((num(l?.monthlyRent) ?? 0) > 0) rentedLeaseIdx.push(i);
  });
  const leaseWeightTotal = rentedLeaseIdx.reduce((s, i) => s + (num(explicitLeases[i].monthlyRent) ?? 0), 0);
  const hasLeaseIncome = rentedLeaseIdx.length > 0;

  const isZeroIncome =
    (num(inputs.grossRentAnnual) ?? 0) <= 0 &&
    (num(inputs.grossRentPerMonth) ?? 0) <= 0 &&
    (num(inputs.monthlyRent) ?? 0) <= 0 &&
    !hasLeaseIncome;

  const baseGrowth = num(inputs.rentGrowth) ?? 2.5;
  const baseVacancy = num(inputs.vacancyRate) ?? 5.0;
  const baseApprec = num(inputs.appreciationRate) ?? 2.0;
  const baseExitCap =
    num(inputs.targetCapRate) ??
    num(inputs.targetExitCapRate) ??
    num(inputs.exitCapRate) ??
    (isCommercialOrStorage ? 6.5 : 0);
  const baseHoldingInflation = num(inputs.expenseGrowth) ?? num(inputs.expenseInflation) ?? num(inputs.expenseGrowthRate) ?? num(inputs.expenseGrowthPercent) ?? 2.5;

  const growthStdDev = options.rentGrowthVolPct ?? 1.5;
  const vacancyStdDev = options.vacancyVolPct ?? 2.5;
  const exitCapSpreadPct = (options.exitCapSpreadBps ?? 100) / 100;
  const apprecStdDev =
    options.apprecVolPct !== undefined
      ? options.apprecVolPct
      : isZeroIncome
        ? Math.max(1.0, (options.exitCapSpreadBps ?? 100) / 40)
        : 1.5;

  const unitCount = parseInt(String(inputs.unitCount || inputs.storageUnitCount || 0), 10);
  // One vacancy standard deviation per asset type, used by the sampler and reported in the result
  const vacancySigma =
    assetType === 'single-family' ? null
    : assetType === 'multi-unit' ? vacancyStdDev / Math.sqrt(Math.max(1, (unitCount || 8) / 4))
    : assetType === 'commercial' ? vacancyStdDev * 0.75
    : assetType === 'storage' ? vacancyStdDev * 1.15
    : vacancyStdDev;
  const holdYears = Math.max(1, Math.round(num(inputs.exitYear) ?? num(inputs.holdingPeriod) ?? 10));
  const holdMonths = holdYears * 12;
  const hurdleRate = options.hurdleRatePct ?? num(inputs.discountRate) ?? 8;

  // Tenant default risk: a labelled probability and downtime (commercial and storage with income only; other asset types model
  // turnover through their vacancy mechanics)
  const defaultApplies = isCommercialOrStorage && !isZeroIncome;
  const defaultProbPct = defaultApplies ? Math.min(100, Math.max(0, options.tenantDefaultProbPct ?? DEFAULT_TENANT_DEFAULT.probabilityPct)) : 0;
  const defaultDowntime = Math.max(0, Math.round(options.tenantDefaultDowntimeMonths ?? DEFAULT_TENANT_DEFAULT.downtimeMonths));
  // Residential turnover (apartments and houses with tenant leases): ordinary move-outs, tenant by tenant
  const turnoverDefaults = DEFAULT_TURNOVER[assetType];
  const turnoverApplies = !!turnoverDefaults && hasLeaseIncome;
  const turnoverPct = turnoverApplies ? Math.min(100, Math.max(0, options.turnoverPct ?? turnoverDefaults.annualPct)) : 0;
  const makeReady = turnoverApplies ? Math.max(0, options.turnoverMakeReadyCost ?? turnoverDefaults.makeReadyCost) : 0;
  const calibrated = options.turnoverDowntimeDays === undefined;
  // The deal's own vacancy setting is the anchor: pick the vacant stretch so turnover x stretch matches it (capped at six months)
  const calibratedMonths = turnoverPct > 0 ? Math.min(6, (baseVacancy / 100) * 12 / (turnoverPct / 100)) : 0;
  const downtimeMonthsMean = turnoverApplies ? (calibrated ? calibratedMonths : Math.max(0, options.turnoverDowntimeDays as number) / DAYS_PER_MONTH) : 0;
  const closing = String(inputs.closingDate ?? "").match(/(\d{4})[-/](\d{1,2})/);
  const closeIdx = (closing ? parseInt(closing[1], 10) : 2025) * 12 + (closing ? parseInt(closing[2], 10) : 7);
  const ymIdx = (v: unknown): number | null => {
    const m = String(v ?? "").match(/(\d{4})[-/](\d{1,2})/);
    return m ? parseInt(m[1], 10) * 12 + parseInt(m[2], 10) : null;
  };
  // Months after closing from which each tenant can leave: a fixed-term tenant only once the lease has ended, a month-to-month tenant at once
  const leaveFrom: Record<number, number> = {};
  for (const i of rentedLeaseIdx) {
    const l = explicitLeases[i];
    const month2month = String(l?.termType ?? "") === "month_to_month" || !ymIdx(l?.leaseEndDate);
    const endIdx = month2month ? null : ymIdx(l?.leaseEndDate);
    const startIdx = ymIdx(l?.leaseStartDate);
    leaveFrom[i] = Math.max(0, endIdx !== null ? endIdx + 1 - closeIdx : 0, startIdx !== null ? startIdx - closeIdx : 0);
  }
  let moveOutsTotal = 0;
  // Every run shares the rent roll, closing and hold: each lease's rent schedule is resolved once, on the first run
  const leaseScheduleCache = createLeaseScheduleCache();
  const seedUsed = options.rng ? null : options.seed !== undefined ? (typeof options.seed === 'number' ? options.seed : seedFromText(String(options.seed))) : null;

  const irrResults: number[] = new Array(runs);
  const profitResults: number[] = new Array(runs);
  let totalIrr = 0;
  let negativeIrrRuns = 0;
  let negativeCashFlowRuns = 0;
  let aboveHurdleRuns = 0;
  let defaultRuns = 0;
  let cashInvested = 0;
  let completed = 0;

  const pickDefaultedLease = (): number => {
    let roll = rng() * leaseWeightTotal;
    for (const i of rentedLeaseIdx) {
      roll -= num(explicitLeases[i].monthlyRent) ?? 0;
      if (roll <= 0) return i;
    }
    return rentedLeaseIdx[rentedLeaseIdx.length - 1];
  };

  const runOne = (r: number): void => {
    const sampledGrowth = gaussian(baseGrowth, growthStdDev);
    const sampledApprec = gaussian(baseApprec, apprecStdDev);
    const sampledExitCap = baseExitCap > 0 ? Math.max(3.0, gaussian(baseExitCap, exitCapSpreadPct)) : baseExitCap;
    const sampledHoldingInflation = gaussian(baseHoldingInflation, 1.0);

    // Asset-specific stochastic vacancy mechanics
    let sampledVacancy = baseVacancy;
    if (assetType === 'single-family') {
      const turnoverChance = Math.min(0.6, Math.max(0.1, (baseVacancy / 5.0) * 0.22));
      if (rng() < turnoverChance) {
        const downtimeRoll = rng();
        if (downtimeRoll < 0.65) sampledVacancy = 8.33;
        else if (downtimeRoll < 0.88) sampledVacancy = 16.67;
        else sampledVacancy = 25.0 + rng() * 20.0;
      } else {
        sampledVacancy = Math.max(0, gaussian(0.5, 0.4));
      }
    } else if (assetType === 'multi-unit') {
      sampledVacancy = Math.max(1.0, Math.min(45.0, gaussian(baseVacancy, vacancySigma as number)));
    } else if (assetType === 'commercial') {
      // Ordinary vacancy noise only: a tenant default is modelled separately and visibly
      sampledVacancy = isZeroIncome ? 0 : Math.max(0.5, Math.min(30.0, gaussian(baseVacancy, vacancySigma as number)));
    } else if (assetType === 'storage') {
      sampledVacancy = Math.max(2.0, Math.min(45.0, gaussian(baseVacancy, vacancySigma as number)));
    } else {
      sampledVacancy = Math.max(1.0, Math.min(45.0, gaussian(baseVacancy, vacancyStdDev)));
    }

    const scenario: Record<string, any> = {
      ...inputs,
      rentGrowth: sampledGrowth,
      vacancyRate: sampledVacancy,
      appreciationRate: sampledApprec,
      targetCapRate: sampledExitCap,
      targetExitCapRate: sampledExitCap,
      expenseGrowth: sampledHoldingInflation,
      expenseInflation: sampledHoldingInflation,
      holdingInflation: sampledHoldingInflation,
    };
    // With leases, contractual rent is fixed; only what the contract does not fix (rent after a lease ends) drifts with the sample
    if (hasLeaseIncome) scenario.marketRentDrift = sampledGrowth - baseGrowth;

    // Residential move-outs: each tenant has a yearly chance of leaving, then the space is vacant for a stretch and costs a make-ready charge
    const interruptions: Array<{ leaseIndex: number; startOffset: number; months: number; makeReadyCost: number }> = [];
    if (turnoverApplies && turnoverPct > 0) {
      for (const li of rentedLeaseIdx) {
        const from = leaveFrom[li];
        for (let blockStart = 0; blockStart < holdMonths; blockStart += 12) {
          const lo = Math.max(blockStart, from);
          const hi = Math.min(blockStart + 12, holdMonths); // exclusive
          if (hi <= lo) continue;
          // a part-year of eligibility carries a part-year of the yearly chance
          if (rng() >= (turnoverPct / 100) * ((hi - lo) / 12)) continue;
          const x = downtimeMonthsMean * (0.5 + rng()); // the stretch varies from half to one and a half times its average
          const months = Math.floor(x) + (rng() < x - Math.floor(x) ? 1 : 0);
          interruptions.push({ leaseIndex: li, startOffset: lo + Math.floor(rng() * (hi - lo)), months, makeReadyCost: makeReady * (0.75 + rng() * 0.5) });
        }
      }
      moveOutsTotal += interruptions.length;
      // The move-outs ARE the vacancy; adding the blanket vacancy rate as well would count it twice
      scenario.vacancyRate = 0;
      scenario.tenantInterruptions = interruptions;
    }

    if (defaultProbPct > 0 && rng() < defaultProbPct / 100) {
      defaultRuns += 1;
      if (hasLeaseIncome) {
        scenario.tenantInterruptions = [
          ...(scenario.tenantInterruptions ?? []),
          { leaseIndex: pickDefaultedLease(), startOffset: Math.floor(rng() * holdMonths), months: defaultDowntime },
        ];
      } else {
        // No lease objects to interrupt: spread the lost months across the hold as extra vacancy
        scenario.vacancyRate = Math.min(60, sampledVacancy + (defaultDowntime / holdMonths) * 100);
      }
    }

    // lean: numbers only (no per-month text), about 8x faster with leases and identical results; the cache makes large rent rolls cheap
    const res = calculateProjections(assetType, scenario, { lean: true, leaseScheduleCache });

    const runIrr = Number(res.irr) || 0;
    irrResults[r] = runIrr;
    totalIrr += runIrr;
    if (runIrr < 0) negativeIrrRuns++;
    if (runIrr >= hurdleRate) aboveHurdleRuns++;
    if ((res.projections?.[0]?.cashFlow ?? 0) < 0) negativeCashFlowRuns++;

    // Net profit over the hold: every year's cash flow plus the equity at exit, minus the cash put in (the same flows the IRR uses)
    const proj: any[] = res.projections ?? [];
    let profit = -(Number(res.initialCashInvested) || 0);
    for (const p of proj) profit += Number(p.cashFlow) || 0;
    profit += Number(proj[proj.length - 1]?.equity) || 0;
    profitResults[r] = profit;
    if (r === 0) cashInvested = Number(res.initialCashInvested) || 0;
  };

  const summarize = (): MonteCarloResult => {
    const irrSorted = [...irrResults].sort((a, b) => a - b);
    const p5 = percentile(irrSorted, 0.05);
    const p10 = percentile(irrSorted, 0.1);
    const p25 = percentile(irrSorted, 0.25);
    const p50 = percentile(irrSorted, 0.5);
    const p75 = percentile(irrSorted, 0.75);
    const p90 = percentile(irrSorted, 0.9);
    const p95 = percentile(irrSorted, 0.95);
    const minIrr = irrSorted[0];
    const maxIrr = irrSorted[runs - 1];
    const meanIrr = round2(totalIrr / runs);

    let sumSquares = 0;
    for (let i = 0; i < runs; i++) sumSquares += Math.pow(irrSorted[i] - meanIrr, 2);
    const stdDev = round2(Math.sqrt(sumSquares / runs));
    const probNegativeIrr = round1((negativeIrrRuns / runs) * 100);
    const probNegativeCashFlow = round1((negativeCashFlowRuns / runs) * 100);

    const skewnessIndex = round2((meanIrr - p50) / (stdDev || 1));
    const riskFreeRate = 4.25;
    const sharpeRatio = round2((meanIrr - riskFreeRate) / (stdDev || 1));

    let riskClassification = 'Balanced Core-Plus Risk';
    if (p5 > 25 && probNegativeCashFlow === 0) riskClassification = 'High-Yield Outperformer / Strong Downside Buffer';
    else if (p5 < 0) riskClassification = 'High Leverage / Asymmetric Tail Risk Vulnerable';
    else if (probNegativeCashFlow > 15) riskClassification = 'Capital Call Vulnerable (Operating Cash Flow Risk)';

    const usesCap = isCommercialOrStorage && !isZeroIncome;
    const price = num(inputs.purchasePrice) ?? 0;
    const pctOfPrice = price > 0 ? round1((cashInvested / price) * 100) : 0;

    return {
      runs,
      assetType,
      meanIrr,
      medianIrr: p50,
      stdDev,
      minIrr,
      maxIrr,
      p5Irr: p5,
      p10Irr: p10,
      p25Irr: p25,
      p50Irr: p50,
      p75Irr: p75,
      p90Irr: p90,
      p95Irr: p95,
      var95: p5,
      probabilityPositive: round1(100 - probNegativeIrr),
      probNegativeIrr,
      probNegativeCashFlow,
      probAboveHurdle: round1((aboveHurdleRuns / runs) * 100),
      hurdleRate,
      skewnessIndex,
      sharpeRatio,
      riskClassification,
      histogramBins: buildFixedHistogram(irrSorted, (v) => `${round1(v)}%`),
      profit: summarizeProfit(profitResults),
      equity: { cashInvested: Math.round(cashInvested), pctOfPrice, thin: price > 0 && pctOfPrice < 10 },
      tenantDefault: {
        applies: defaultApplies && defaultProbPct > 0,
        probabilityPct: defaultProbPct,
        downtimeMonths: defaultDowntime,
        runsAffectedPct: round1((defaultRuns / runs) * 100),
      },
      turnover: {
        applies: turnoverApplies && turnoverPct > 0,
        annualPct: turnoverPct,
        downtimeDays: Math.round(downtimeMonthsMean * DAYS_PER_MONTH),
        makeReadyCost: makeReady,
        calibratedToVacancy: calibrated,
        avgMoveOutsPerRun: round1(moveOutsTotal / runs),
        impliedVacancyPct: round1(turnoverPct * (downtimeMonthsMean * DAYS_PER_MONTH) / 365),
        dealVacancyPct: round1(baseVacancy),
      },
      seed: seedUsed,
      telemetry: {
        baselineRentGrowth: baseGrowth,
        baselineVacancy: baseVacancy,
        baselineExitMetric: usesCap ? baseExitCap : baseApprec,
        exitMetricType: usesCap ? 'Exit Cap Rate' : 'Annual Land Appreciation',
        rentGrowthRange: [round1(baseGrowth - growthStdDev), round1(baseGrowth + growthStdDev)],
        vacancyRange:
          assetType === 'single-family'
            ? [0.0, 25.0]
            : [round1(Math.max(0, baseVacancy - vacancyStdDev)), round1(baseVacancy + vacancyStdDev)],
        exitMetricRange: usesCap
          ? [round2(Math.max(1, baseExitCap - exitCapSpreadPct)), round2(baseExitCap + exitCapSpreadPct)]
          : [round1(baseApprec - apprecStdDev), round1(baseApprec + apprecStdDev)],
        volatility: {
          holdYears,
          contractualRentFixed: hasLeaseIncome,
          rentGrowthStdDev: growthStdDev,
          vacancyStdDev: vacancySigma === null ? null : round2(vacancySigma),
          exitMetricStdDev: usesCap ? exitCapSpreadPct : apprecStdDev,
          appreciationStdDev: apprecStdDev,
          baselineAppreciation: baseApprec,
          costInflationMean: round1(baseHoldingInflation),
          costInflationStdDev: 1.0,
        },
      },
    };
  };

  return {
    total: runs,
    get completed() {
      return completed;
    },
    step(count = runs) {
      const end = Math.min(runs, completed + Math.max(0, Math.floor(count)));
      while (completed < end) {
        runOne(completed);
        completed += 1;
      }
      return completed;
    },
    finish() {
      if (completed < runs) throw new Error(`Monte Carlo is incomplete (${completed}/${runs} runs)`);
      return summarize();
    },
  };
}
