/**
 * Numbers behind the deal Overview charts, as plain functions of the engine's yearly projections (nothing stored, nothing
 * re-derived from the database). Each chart answers one question about the deal.
 */

type Proj = Record<string, any>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface IncomeSlice {
  key: 'vacancy' | 'opex' | 'interest' | 'principal' | 'cashFlow';
  label: string;
  value: number;
  color: string;
}

export interface IncomeBreakdown {
  /** Gross potential rent: the whole pie. */
  gross: number;
  slices: IncomeSlice[];
  /** Cash flow below zero (the deal costs money that year). Not drawn as a slice; shown as a note. */
  shortfall: number;
}

/** Where one year's gross rent goes: lost to vacancy, spent running the building, paid to the lender (interest, then principal that becomes equity), or kept. */
export function incomeBreakdown(p: Proj | undefined): IncomeBreakdown {
  if (!p) return { gross: 0, slices: [], shortfall: 0 };
  const gross = Math.max(0, num(p.grossPotentialRent ?? p.grossPotentialIncome));
  const cash = num(p.cashFlow);
  const raw: IncomeSlice[] = [
    { key: 'vacancy', label: 'Vacancy', value: Math.max(0, num(p.vacancyLoss)), color: '#64748b' },
    { key: 'opex', label: 'Operating expenses', value: Math.max(0, num(p.operatingExpenses)), color: '#f59e0b' },
    { key: 'interest', label: 'Loan interest', value: Math.max(0, num(p.interestPaid)), color: '#f43f5e' },
    { key: 'principal', label: 'Loan principal (builds equity)', value: Math.max(0, num(p.principalPaid)), color: '#3b82f6' },
    { key: 'cashFlow', label: 'Cash flow to you', value: Math.max(0, cash), color: '#10b981' },
  ];
  return { gross, slices: raw.filter((s) => s.value > 0), shortfall: cash < 0 ? Math.abs(cash) : 0 };
}

export interface EquityPoint {
  /** 0 is the day of purchase. */
  year: number;
  value: number;
  loan: number;
  equity: number;
  cumulativeCash: number;
  /** Equity plus cash collected so far. */
  total: number;
}

/** Equity (value less loan) and cash collected, year by year, starting from what you put in at purchase. */
export function equityGrowth(projections: Proj[], purchasePrice: number, loanAmount: number): EquityPoint[] {
  const start: EquityPoint = {
    year: 0,
    value: purchasePrice,
    loan: loanAmount,
    equity: Math.max(0, purchasePrice - loanAmount),
    cumulativeCash: 0,
    total: Math.max(0, purchasePrice - loanAmount),
  };
  let cum = 0;
  const rows = projections.map((p, i) => {
    cum += num(p.cashFlow);
    const value = num(p.propertyValue);
    const loan = num(p.endingLoanBalance ?? p.loanBalanceRemaining);
    const equity = value - loan;
    return { year: num(p.year) || i + 1, value, loan, equity, cumulativeCash: cum, total: equity + cum };
  });
  return [start, ...rows];
}

/** First year equity plus cash collected is at least the cash you put in, or null if not within the projection. */
export function paybackYear(points: EquityPoint[], initialCash: number): number | null {
  const hit = points.find((pt) => pt.year > 0 && pt.total >= initialCash);
  return hit ? hit.year : null;
}

export interface CoveragePoint {
  year: number;
  noi: number;
  debtService: number;
  /** Null when there is no debt service (all-cash). */
  dscr: number | null;
}

/** Income against loan payments each year. Coverage below 1.0 means the building does not cover its loan. */
export function coverageSeries(projections: Proj[]): CoveragePoint[] {
  return projections.map((p, i) => {
    const noi = num(p.netOperatingIncome);
    const debtService = num(p.debtService);
    return { year: num(p.year) || i + 1, noi, debtService, dscr: debtService > 0 ? Math.round((noi / debtService) * 100) / 100 : null };
  });
}

/** Lenders commonly want at least this much coverage; used only as a reference line. */
export const DSCR_REFERENCE = 1.25;
