import { DealRecord, DealInputs, DealMetrics } from '../math/types';
import { computeDealMetrics, prepareEngineInputs } from '../engine/compute';
import { firstFullYear } from '../engine';

export type ComparisonMode = 'properties' | 'versions' | 'custom';

export type ScenarioPresetType = 'live' | 'baseline' | 'bull' | 'bear' | 'history' | 'remodel' | 'custom';

/** Which deals the studio works with: prospective deals (the default), the portfolio you own, or both. */
export type CompareScope = 'pipeline' | 'owned' | 'all';

export const COMPARE_SCOPES: CompareScope[] = ['pipeline', 'owned', 'all'];

export const isCompareScope = (v: unknown): v is CompareScope => v === 'pipeline' || v === 'owned' || v === 'all';

/** A deal is "owned" when its status says so; otherwise it is pipeline, unless it is archived (archived shows only under All). */
export function dealScope(deal: Pick<DealRecord, 'status'>): 'owned' | 'pipeline' | 'archived' {
  if (deal.status === 'owned') return 'owned';
  if (deal.status === 'archived') return 'archived';
  return 'pipeline';
}

export function filterDealsByScope<T extends Pick<DealRecord, 'status'>>(deals: T[], scope: CompareScope): T[] {
  if (scope === 'all') return deals;
  return deals.filter((d) => dealScope(d) === scope);
}

export function countDealsByScope(deals: Array<Pick<DealRecord, 'status'>>): Record<CompareScope, number> {
  return { pipeline: filterDealsByScope(deals, 'pipeline').length, owned: filterDealsByScope(deals, 'owned').length, all: deals.length };
}

/**
 * The scope to open with. A requested scope (from the URL) wins, unless a deal asked for by link falls outside it (then All,
 * so a shared link never hides its own deals). With no request: Pipeline, or All when there are no prospective deals at all.
 */
export function resolveInitialScope(
  deals: Array<Pick<DealRecord, 'id' | 'status'>>,
  requested: unknown,
  requestedDealIds: string[] = [],
): CompareScope {
  const counts = countDealsByScope(deals);
  let scope: CompareScope = isCompareScope(requested) ? requested : counts.pipeline > 0 ? 'pipeline' : 'all';
  if (scope !== 'all' && requestedDealIds.length > 0) {
    const visible = new Set(filterDealsByScope(deals, scope).map((d) => d.id));
    const asked = deals.filter((d) => requestedDealIds.includes(d.id));
    if (asked.some((d) => !visible.has(d.id))) scope = 'all';
  }
  return scope;
}

export interface ComparisonSummary {
  purchasePrice: number;
  initialCash: number;
  loanAmount: number;
  interestRate: number;
  loanTerm: number;
  monthlyDebt: number;
  annualDebt: number;
  grossRentAnnual: number;
  grossRentMonthly: number;
  vacancyRate: number;
  operatingExpenses: number;
  expenseRatio: number;
  noi: number;
  dscr: number | null;
  cashFlowYear1: number;
  capRateYear1: number;
  exitCapRate: number;
  cashOnCashYear1: number;
  blendedCoC: number;
  irr: number;
  equityMultiple: number;
  npv: number;
  tenYearCashFlow: number;
  tenYearTerminalValue: number;
  totalWealthCreated: number;
}

export interface ComparisonColumn {
  id: string;
  dealId: string;
  dealTitle: string;
  assetClass: string;
  status: 'owned' | 'prospect';
  location: string;
  scenarioName: string;
  scenarioType: ScenarioPresetType;
  overrides?: Partial<DealInputs>;
  /** Which board entry this column is (see config.ts ScenarioKey), so a board can be saved and rebuilt. */
  scenarioKey?: string;
  deal: DealRecord;
  metrics: DealMetrics;
  summary: ComparisonSummary;
  isBenchmark?: boolean;
}

export interface WinnerAnalysis {
  maxIrrId: string | null;
  maxCashFlowId: string | null;
  maxMultipleId: string | null;
  maxDscrId: string | null;
  maxNoiId: string | null;
  minPriceId: string | null;
}

/** Pre-set definitions for scenario variations */
export function getPresetOverrides(preset: ScenarioPresetType, dealInputs: Record<string, any>): Partial<DealInputs> {
  const currentRent = Number(dealInputs.grossRentAnnual || (dealInputs.monthlyRent ? dealInputs.monthlyRent * 12 : 0));
  const currentVacancy = Number(dealInputs.vacancyRate);
  const currentRate = Number(dealInputs.interestRate);

  switch (preset) {
    case 'bull':
      return {
        grossRentAnnual: currentRent > 0 ? Math.round(currentRent * 1.08) : undefined,
        monthlyRent: dealInputs.monthlyRent ? Math.round(dealInputs.monthlyRent * 1.08) : undefined,
        vacancyRate: Math.max(1, +(currentVacancy - 1.5).toFixed(1)),
      };
    case 'bear':
      return {
        grossRentAnnual: currentRent > 0 ? Math.round(currentRent * 0.92) : undefined,
        monthlyRent: dealInputs.monthlyRent ? Math.round(dealInputs.monthlyRent * 0.92) : undefined,
        vacancyRate: Math.min(25, +(currentVacancy + 3.0).toFixed(1)),
        interestRate: +(currentRate + 0.5).toFixed(2),
      };
    case 'baseline':
    case 'live':
    default:
      return {};
  }
}

/** Summarize computed engine metrics into comparison-ready key figures */
export function extractComparisonSummary(deal: DealRecord, overrides?: Partial<DealInputs>): { metrics: DealMetrics; summary: ComparisonSummary } {
  const metrics = computeDealMetrics(deal, overrides);
  const inputs = prepareEngineInputs(deal, overrides);

  const purchasePrice = Number(inputs.purchasePrice || deal.purchase_price || 0);
  // Every figure here comes from the engine's result for a deal that states its own inputs; none is assumed
  const downPaymentPct = Number(inputs.downPaymentPercent);
  const initialCash = Number(metrics.initialCashInvested);

  const p0: any = metrics.projections?.[0] || {};
  const firstFull: any = firstFullYear(metrics.projections) || p0;

  const loanAmount = Number((metrics as any).loanAmount);
  const interestRate = Number(inputs.interestRate || 0);
  const loanTerm = Number(inputs.amortizationYears ?? inputs.loanTerm);
  const annualDebt = Number(firstFull.debtService ?? 0);
  const monthlyDebt = annualDebt > 0 ? annualDebt / 12 : Number((metrics as any).monthlyMortgagePayment || 0);

  const grossRentAnnual = Number(inputs.grossRentAnnual || (inputs.monthlyRent ? inputs.monthlyRent * 12 : firstFull.grossPotentialRent || 0));
  const grossRentMonthly = grossRentAnnual > 0 ? grossRentAnnual / 12 : Number(inputs.monthlyRent || 0);

  const vacancyRate = Number(inputs.vacancyRate);
  const operatingExpenses = Number(firstFull.operatingExpenses ?? 0);
  const expenseRatio = Number(inputs.expenseRatio ?? (grossRentAnnual > 0 ? (operatingExpenses / grossRentAnnual) * 100 : 0));

  const noi = Number(firstFull.netOperatingIncome ?? (metrics as any).noi ?? 0);
  const rawDscr = firstFull.dscr ?? (metrics as any).dscr;
  const dscr = rawDscr !== null && rawDscr !== undefined && !isNaN(Number(rawDscr)) ? Number(rawDscr) : null;

  const cashFlowYear1 = Number(firstFull.cashFlow ?? (metrics as any).year1Cashflow ?? 0);
  const capRateYear1 = Number(firstFull.capRate ?? (metrics as any).capRate ?? (purchasePrice > 0 ? (noi / purchasePrice) * 100 : 0));
  const exitCapRate = Number(inputs.targetCapRate ?? inputs.targetExitCapRate ?? inputs.exitCapRate ?? 6.0);

  const cashOnCashYear1 = Number(firstFull.cashOnCash ?? (metrics as any).cashOnCash ?? (initialCash > 0 ? (cashFlowYear1 / initialCash) * 100 : 0));
  const irr = Number(metrics.irr || 0);
  const equityMultiple = Number(metrics.equityMultiplier || (metrics as any).equityMultiple || 0);
  const npv = Number(metrics.npv || 0);

  // 10-Year cumulative cash flows and terminal value
  let tenYearCashFlow = 0;
  if (Array.isArray(metrics.projections)) {
    metrics.projections.forEach((p: any) => {
      tenYearCashFlow += Number(p.cashFlow) || 0;
    });
  }

  const pLast: any = metrics.projections?.[metrics.projections.length - 1] || {};
  const tenYearTerminalValue = Number(pLast.propertyValue ?? (pLast.noi && exitCapRate > 0 ? (pLast.noi / (exitCapRate / 100)) : 0));
  const totalNetEquityExit = Number(pLast.exitProceedsNet ?? pLast.equity ?? (tenYearTerminalValue - (pLast.endingLoanBalance ?? 0)));
  const totalWealthCreated = Math.round(tenYearCashFlow + totalNetEquityExit - initialCash);

  const blendedCoC = initialCash > 0 && metrics.projections?.length
    ? (tenYearCashFlow / metrics.projections.length / initialCash) * 100
    : cashOnCashYear1;

  return {
    metrics,
    summary: {
      purchasePrice,
      initialCash,
      loanAmount,
      interestRate,
      loanTerm,
      monthlyDebt,
      annualDebt,
      grossRentAnnual,
      grossRentMonthly,
      vacancyRate,
      operatingExpenses,
      expenseRatio,
      noi,
      dscr,
      cashFlowYear1,
      capRateYear1,
      exitCapRate,
      cashOnCashYear1,
      blendedCoC,
      irr,
      equityMultiple,
      npv,
      tenYearCashFlow,
      tenYearTerminalValue,
      totalWealthCreated,
    },
  };
}

/** Determine winning items across columns */
export function evaluateWinners(columns: ComparisonColumn[]): WinnerAnalysis {
  if (columns.length === 0) {
    return {
      maxIrrId: null,
      maxCashFlowId: null,
      maxMultipleId: null,
      maxDscrId: null,
      maxNoiId: null,
      minPriceId: null,
    };
  }

  let maxIrr = -Infinity;
  let maxIrrId: string | null = null;

  let maxCashFlow = -Infinity;
  let maxCashFlowId: string | null = null;

  let maxMultiple = -Infinity;
  let maxMultipleId: string | null = null;

  let maxDscr = -Infinity;
  let maxDscrId: string | null = null;

  let maxNoi = -Infinity;
  let maxNoiId: string | null = null;

  let minPrice = Infinity;
  let minPriceId: string | null = null;

  columns.forEach((col) => {
    const s = col.summary;

    if (s.irr > maxIrr && s.irr > 0) {
      maxIrr = s.irr;
      maxIrrId = col.id;
    }
    if (s.cashFlowYear1 > maxCashFlow) {
      maxCashFlow = s.cashFlowYear1;
      maxCashFlowId = col.id;
    }
    if (s.equityMultiple > maxMultiple && s.equityMultiple > 0) {
      maxMultiple = s.equityMultiple;
      maxMultipleId = col.id;
    }
    if (s.dscr !== null && s.dscr > maxDscr && s.dscr > 0) {
      maxDscr = s.dscr;
      maxDscrId = col.id;
    }
    if (s.noi > maxNoi && s.noi > 0) {
      maxNoi = s.noi;
      maxNoiId = col.id;
    }
    if (s.purchasePrice < minPrice && s.purchasePrice > 0) {
      minPrice = s.purchasePrice;
      minPriceId = col.id;
    }
  });

  return {
    maxIrrId,
    maxCashFlowId,
    maxMultipleId,
    maxDscrId,
    maxNoiId,
    minPriceId,
  };
}

// ---------------------------------------------------------------------------
// Identical scenarios
// ---------------------------------------------------------------------------

/** Two columns of the same deal that produce the same figures tell the reader nothing the first one does not. */
export function columnFingerprint(c: Pick<ComparisonColumn, 'dealId' | 'summary'>): string {
  const s = c.summary;
  const r = (v: number | null): string => (v === null || v === undefined ? 'na' : String(Math.round(Number(v) * 100) / 100));
  // Results only, not the inputs that were nudged: a scenario that changes an input the deal does not use (e.g. vacancy on a deal
  // with no rent) still produces the same answer, and that is what makes the column redundant.
  const figures = [
    s.purchasePrice, s.initialCash, s.loanAmount, s.grossRentAnnual, s.operatingExpenses, s.noi, s.dscr, s.cashFlowYear1,
    s.capRateYear1, s.irr, s.equityMultiple, s.npv, s.tenYearCashFlow, s.tenYearTerminalValue, s.totalWealthCreated,
  ].map((v) => r(v as number | null));
  return [c.dealId, ...figures].join('|');
}

/** A short label for a column's scenario, for merged headings and notes. */
export function scenarioShortLabel(c: Pick<ComparisonColumn, 'scenarioType' | 'scenarioName'>): string {
  switch (c.scenarioType) {
    case 'live': return 'Live Model';
    case 'baseline': return 'Acquisition Baseline';
    case 'bull': return 'Bull Case';
    case 'bear': return 'Bear Case';
    case 'remodel': return c.scenarioName ? `Remodel: ${c.scenarioName}` : 'Remodel';
    default: return c.scenarioName || 'Scenario';
  }
}

export interface MergedColumnNote {
  kept: string;
  dropped: string[];
  /** The deal has no rental income, so a rent scenario cannot change anything. */
  noRent: boolean;
}

/**
 * Within one deal, columns with identical results collapse into the first one (so Live = Baseline = Bull becomes a single column).
 * The kept column's heading names everything it stands for, and the benchmark flag moves to it if a dropped column held it.
 */
export function mergeIdenticalColumns(columns: ComparisonColumn[]): { columns: ComparisonColumn[]; notes: MergedColumnNote[] } {
  const keptByPrint = new Map<string, ComparisonColumn>();
  const alsoByPrint = new Map<string, ComparisonColumn[]>();
  const out: ComparisonColumn[] = [];
  for (const col of columns) {
    const print = columnFingerprint(col);
    const first = keptByPrint.get(print);
    if (!first) {
      keptByPrint.set(print, col);
      out.push(col);
      continue;
    }
    alsoByPrint.set(print, [...(alsoByPrint.get(print) ?? []), col]);
    if (col.isBenchmark) first.isBenchmark = true;
  }
  const notes: MergedColumnNote[] = [];
  const merged = out.map((col) => {
    const dropped = alsoByPrint.get(columnFingerprint(col));
    if (!dropped || dropped.length === 0) return col;
    notes.push({ kept: scenarioShortLabel(col), dropped: dropped.map(scenarioShortLabel), noRent: col.summary.grossRentAnnual <= 0 });
    // Name what the single column stands for (a long list stays readable because only the first two are spelled out)
    const labels = [scenarioShortLabel(col), ...dropped.map(scenarioShortLabel)];
    const heading = labels.length > 3 ? `${labels[0]} = ${labels[1]} +${labels.length - 2}` : labels.join(' = ');
    return { ...col, scenarioName: heading };
  });
  return { columns: merged, notes };
}

/** Plain-English line for each merge, shown above the table. */
export function describeMergedNote(n: MergedColumnNote): string {
  const list = n.dropped.join(' and ');
  const why = n.noRent ? ' This deal has no rental income, so a rent scenario cannot change the results.' : '';
  return `${list} give the same results as ${n.kept}, so they are shown as one column.${why}`;
}
