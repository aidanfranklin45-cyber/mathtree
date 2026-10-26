/**
 * What a lender reads first, from the same engine run as the pro forma: coverage, debt yield, break-even occupancy, the
 * repayment picture at the end of the hold, and a DSCR stress. Nothing here changes an existing number; it re-reads the projections
 * (and re-runs them once with a higher rate for the rate stress).
 *
 * The stress sizes are lender convention and are named here, once, so the page and the tests quote the same figures.
 */
import { calculateProjections, firstFullYear, normalizeAssetClass } from './math-engine.ts';

export const LENDER_STRESS = { noiDeclinePercent: 10, rateIncreasePoints: 1 } as const;

export type StressId = 'base' | 'noi' | 'rate' | 'both';

export interface LenderStressRow {
  id: StressId;
  label: string;
  netOperatingIncome: number;
  debtService: number;
  /** Null when there is no loan. */
  dscr: number | null;
}

export interface LenderMetrics {
  /** Calendar year of the first full operating year, the year every figure below is read from. */
  basisYear: number;
  loanAmount: number;
  netOperatingIncome: number;
  debtService: number;
  dscr: number | null;
  /** NOI as a percent of the loan. Null when there is no loan. */
  debtYield: number | null;
  /**
   * Share of potential gross income the property must collect to pay operating expenses and debt service: (OpEx + debt service) / GPI.
   * Operating expenses are held at their underwritten dollars, as lenders do.
   */
  breakEvenOccupancyPct: number | null;
  stress: LenderStressRow[];
  /** The end of the hold: what is still owed against what the property is projected to be worth. */
  atExit: { year: number; calendarYear: number; propertyValue: number; loanBalance: number; ltvPct: number | null };
}

const n = (v: unknown): number => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);

export function calculateLenderMetrics(rawAssetType: string, inputs: Record<string, any>): LenderMetrics {
  const assetType = normalizeAssetClass(rawAssetType);
  const base = calculateProjections(assetType, inputs);
  const proj = (base.projections ?? []) as any[];
  const y1 = (firstFullYear(proj) ?? proj[0] ?? {}) as any;

  const loanAmount = n(base.loanAmount);
  const noi = n(y1.netOperatingIncome);
  const ds = n(y1.debtService);
  const gpi = n(y1.grossPotentialIncome ?? y1.grossPotentialRent);
  const opex = n(y1.operatingExpenses);
  const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

  // The rate stress re-prices the same loan: same amount, rate + 1 point
  const rateUp = calculateProjections(assetType, { ...inputs, interestRate: n(inputs.interestRate) + LENDER_STRESS.rateIncreasePoints });
  const upYear = (firstFullYear((rateUp.projections ?? []) as any[]) ?? (rateUp.projections ?? [])[0] ?? {}) as any;
  const noiDown = (v: number) => v * (1 - LENDER_STRESS.noiDeclinePercent / 100);
  const row = (id: StressId, label: string, noiV: number, dsV: number): LenderStressRow => ({
    id, label, netOperatingIncome: noiV, debtService: dsV, dscr: loanAmount > 0 ? ratio(noiV, dsV) : null,
  });
  const upNoi = n(upYear.netOperatingIncome);
  const upDs = n(upYear.debtService);

  const last = (proj[proj.length - 1] ?? {}) as any;
  const value = n(last.propertyValue);
  const balance = n(last.loanBalanceRemaining ?? last.endingLoanBalance);

  return {
    basisYear: n(y1.calendarYear),
    loanAmount,
    netOperatingIncome: noi,
    debtService: ds,
    dscr: loanAmount > 0 ? ratio(noi, ds) : null,
    debtYield: loanAmount > 0 ? (noi / loanAmount) * 100 : null,
    breakEvenOccupancyPct: gpi > 0 ? ((opex + ds) / gpi) * 100 : null,
    stress: [
      row('base', 'As underwritten', noi, ds),
      row('noi', `NOI down ${LENDER_STRESS.noiDeclinePercent}%`, noiDown(noi), ds),
      row('rate', `Rate up ${LENDER_STRESS.rateIncreasePoints * 100} bps`, upNoi, upDs),
      row('both', `Both: NOI down ${LENDER_STRESS.noiDeclinePercent}% and rate up ${LENDER_STRESS.rateIncreasePoints * 100} bps`, noiDown(upNoi), upDs),
    ],
    atExit: {
      year: n(last.year),
      calendarYear: n(last.calendarYear),
      propertyValue: value,
      loanBalance: balance,
      ltvPct: value > 0 ? (balance / value) * 100 : null,
    },
  };
}
