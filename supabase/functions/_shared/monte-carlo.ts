// _shared/monte-carlo.ts
// Stochastic IRR simulation. Pure: (inputs, options) -> result. Runs in the browser and in Deno.
// Every run is scored by the ONE shared engine (calculateProjections), so it can never disagree
// with the numbers shown elsewhere. Nothing here is stored.

import { buildAdaptiveHistogramBins, calculateProjections, normalizeAssetClass } from './math-engine.ts';

export interface MonteCarloOptions {
  runs?: number;
  rentGrowthVolPct?: number;
  vacancyVolPct?: number;
  exitCapSpreadBps?: number;
  apprecVolPct?: number;
  /** Injectable uniform [0,1) source so tests can be deterministic. Defaults to Math.random. */
  rng?: () => number;
}

export interface MonteCarloHistogramBin {
  label: string;
  binStart: number;
  binEnd: number;
  count: number;
  isTail?: boolean;
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
  skewnessIndex: number;
  sharpeRatio: number;
  riskClassification: string;
  histogramBins: MonteCarloHistogramBin[];
  telemetry: {
    baselineRentGrowth: number;
    baselineVacancy: number;
    baselineExitMetric: number;
    exitMetricType: string;
    rentGrowthRange: [number, number];
    vacancyRange: [number, number];
    exitMetricRange: [number, number];
  };
}

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const p = parseFloat(String(v));
  return isNaN(p) ? undefined : p;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** A simulation that can be advanced in slices, so a browser can keep the page responsive and cancel when inputs change. */
export interface MonteCarloRunner {
  readonly total: number;
  readonly completed: number;
  /** Runs up to `count` more trials (default: all that remain) and returns how many have completed. */
  step(count?: number): number;
  /** Summarises a finished simulation. */
  finish(): MonteCarloResult;
}

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
  const rng = options.rng ?? Math.random;
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

  const isZeroIncome =
    (num(inputs.grossRentAnnual) ?? 0) <= 0 &&
    (num(inputs.grossRentPerMonth) ?? 0) <= 0 &&
    (num(inputs.monthlyRent) ?? 0) <= 0 &&
    (!Array.isArray(inputs.leases) || !inputs.leases.some((l: any) => (num(l.monthlyRent) ?? 0) > 0));

  const baseGrowth = num(inputs.rentGrowth) ?? 2.5;
  const baseVacancy = num(inputs.vacancyRate) ?? 5.0;
  const baseApprec = num(inputs.appreciationRate) ?? 3.5;
  const baseExitCap =
    num(inputs.targetCapRate) ??
    num(inputs.targetExitCapRate) ??
    num(inputs.exitCapRate) ??
    (isCommercialOrStorage ? 6.5 : 0);

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

  const irrResults: number[] = new Array(runs);
  let totalIrr = 0;
  let negativeIrrRuns = 0;
  let negativeCashFlowRuns = 0;
  let completed = 0;

  const runOne = (r: number): void => {
    const sampledGrowth = gaussian(baseGrowth, growthStdDev);
    const sampledApprec = gaussian(baseApprec, apprecStdDev);
    const sampledExitCap = baseExitCap > 0 ? Math.max(3.0, gaussian(baseExitCap, exitCapSpreadPct)) : baseExitCap;
    const sampledHoldingInflation = gaussian(2.5, 1.0);

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
      const effectiveStdDev = vacancyStdDev / Math.sqrt(Math.max(1, (unitCount || 8) / 4));
      sampledVacancy = Math.max(1.0, Math.min(45.0, gaussian(baseVacancy, effectiveStdDev)));
    } else if (assetType === 'commercial') {
      if (isZeroIncome) {
        sampledVacancy = 0;
      } else if (rng() < 0.06) {
        sampledVacancy = Math.min(60.0, 25.0 + rng() * 25.0);
      } else {
        sampledVacancy = Math.max(0.5, Math.min(30.0, gaussian(baseVacancy, vacancyStdDev * 0.75)));
      }
    } else if (assetType === 'storage') {
      sampledVacancy = Math.max(2.0, Math.min(45.0, gaussian(baseVacancy, vacancyStdDev * 1.15)));
    } else {
      sampledVacancy = Math.max(1.0, Math.min(45.0, gaussian(baseVacancy, vacancyStdDev)));
    }

    // lean: numbers only (no per-month text), about 8x faster with leases and identical results
    const res = calculateProjections(assetType, {
      ...inputs,
      rentGrowth: sampledGrowth,
      vacancyRate: sampledVacancy,
      appreciationRate: sampledApprec,
      targetCapRate: sampledExitCap,
      targetExitCapRate: sampledExitCap,
      holdingInflation: sampledHoldingInflation,
    }, { lean: true });

    const runIrr = Number(res.irr) || 0;
    irrResults[r] = runIrr;
    totalIrr += runIrr;
    if (runIrr < 0) negativeIrrRuns++;
    if ((res.projections?.[0]?.cashFlow ?? 0) < 0) negativeCashFlowRuns++;
  };

  const summarize = (): MonteCarloResult => {
    irrResults.sort((a, b) => a - b);
    const pct = (p: number) => irrResults[Math.min(runs - 1, Math.floor(runs * p))];
    const p5 = pct(0.05);
    const p10 = pct(0.1);
    const p25 = pct(0.25);
    const p50 = pct(0.5);
    const p75 = pct(0.75);
    const p90 = pct(0.9);
    const p95 = pct(0.95);
    const minIrr = irrResults[0];
    const maxIrr = irrResults[runs - 1];
    const meanIrr = round2(totalIrr / runs);

    let sumSquares = 0;
    for (let i = 0; i < runs; i++) sumSquares += Math.pow(irrResults[i] - meanIrr, 2);
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
      skewnessIndex,
      sharpeRatio,
      riskClassification,
      histogramBins: buildAdaptiveHistogramBins(irrResults, 10),
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
