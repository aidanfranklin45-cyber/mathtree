// supabase/functions/_shared/remodel.ts
// Pure helpers for the optional `inputs.remodel` block: a major remodel or expansion of a property that is already owned.
// The projection loop in math-engine.ts calls these only when a valid remodel is present, so deals without one are untouched.
//
// Months are indexed as year*12 + month (month 1 to 12), the same index the engine uses for tenant interruptions.

export interface RemodelInput {
  /** First month of work, 'YYYY-MM' or 'YYYY-MM-DD'. Before the closing month it is moved to the closing month. */
  startDate: string;
  /** Months of construction. Rent is reduced for these months, then the uplift begins. */
  durationMonths?: number | string;
  /** Total remodel cost, spent at the start of work. */
  cost: number | string;
  financing?: 'cash' | 'new_loan';
  /** new_loan: share of the cost borrowed (default 80) and the loan's rate (default: the deal's rate) and term (default 20). */
  ltcPct?: number | string;
  loanRatePct?: number | string;
  loanTermYears?: number | string;
  /** Share of current rent still collected while work is under way (0 = fully down, 100 = unaffected). Default 0. */
  rentDuringWorksPct?: number | string;
  /** Rent added per month once the work completes, in the dollars of the completion year (it then grows with rent growth). */
  rentUpliftMonthly?: number | string;
  /** Extra operating cost per year once complete (more taxes, insurance, upkeep for the bigger building). */
  extraOpexAnnual?: number | string;
  /** cap_rate: the added income is valued at capRatePct (default: the deal's target cap rate). manual: value after completion is manualValue. */
  valueMode?: 'cap_rate' | 'manual';
  capRatePct?: number | string;
  manualValue?: number | string;
}

export interface ResolvedRemodel {
  startIdx: number;
  completionIdx: number;
  completionYear: number;
  cost: number;
  loanAmount: number;
  cashPortion: number;
  loanRatePct: number;
  loanTermYears: number;
  rentDuringWorks: number; // 0..1
  rentUpliftMonthly: number;
  extraOpexAnnual: number;
  valueMode: 'cap_rate' | 'manual';
  capRatePct: number; // 0 = use the deal's target cap rate
  manualValue: number;
}

const num = (v: unknown, fallback = 0): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : fallback;
};

const idxToYear = (idx: number): number => Math.floor((idx - 1) / 12);

/** Returns null when there is no usable remodel (missing, unparseable date, or nothing spent and nothing gained). */
export function resolveRemodel(
  raw: unknown,
  closeIdx: number,
  defaults: { interestRate: number },
): ResolvedRemodel | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as RemodelInput;

  const m = /^(\d{4})-(\d{1,2})/.exec(String(r.startDate ?? '').trim());
  if (!m) return null;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;

  const cost = Math.max(0, num(r.cost));
  const uplift = Math.max(0, num(r.rentUpliftMonthly));
  if (cost <= 0 && uplift <= 0) return null;

  const startIdx = Math.max(closeIdx, parseInt(m[1], 10) * 12 + month);
  const duration = Math.max(0, Math.round(num(r.durationMonths)));
  const completionIdx = startIdx + duration;

  const financing = r.financing === 'new_loan' ? 'new_loan' : 'cash';
  const ltc = Math.min(100, Math.max(0, num(r.ltcPct, 80)));
  const loanAmount = financing === 'new_loan' ? cost * (ltc / 100) : 0;

  return {
    startIdx,
    completionIdx,
    completionYear: idxToYear(completionIdx),
    cost,
    loanAmount,
    cashPortion: cost - loanAmount,
    loanRatePct: Math.max(0, num(r.loanRatePct, defaults.interestRate)),
    loanTermYears: Math.max(1, Math.round(num(r.loanTermYears, 20))),
    rentDuringWorks: Math.min(100, Math.max(0, num(r.rentDuringWorksPct, 0))) / 100,
    rentUpliftMonthly: uplift,
    extraOpexAnnual: Math.max(0, num(r.extraOpexAnnual)),
    valueMode: r.valueMode === 'manual' ? 'manual' : 'cap_rate',
    capRatePct: Math.max(0, num(r.capRatePct)),
    manualValue: Math.max(0, num(r.manualValue)),
  };
}

/** Of the months `firstMonth`..12 of `calYear`, how many fall before the work, during it, and after it. */
export function remodelMonthCounts(r: ResolvedRemodel, calYear: number, firstMonth: number): { pre: number; works: number; post: number; total: number } {
  let pre = 0;
  let works = 0;
  let post = 0;
  for (let mo = firstMonth; mo <= 12; mo++) {
    const idx = calYear * 12 + mo;
    if (idx < r.startIdx) pre++;
    else if (idx < r.completionIdx) works++;
    else post++;
  }
  return { pre, works, post, total: pre + works + post };
}

/** True when the work has finished by the end of `calYear` (the completion month counts as the first finished month). */
export const remodelDoneByYearEnd = (r: ResolvedRemodel, calYear: number): boolean => r.completionIdx <= calYear * 12 + 12;

/** True when the work starts in `calYear` (that is the year the cash is spent and the loan is drawn). */
export const remodelStartsInYear = (r: ResolvedRemodel, calYear: number): boolean => idxToYear(r.startIdx) === calYear;

/**
 * The remodel loan, month by month: drawn in full when work starts, amortizing from that month. Returns this calendar year's
 * payments, principal and interest, and the balance at its end.
 */
export function remodelLoanYear(r: ResolvedRemodel, monthlyPayment: number, calYear: number): { debtService: number; principal: number; interest: number; endBalance: number } {
  const out = { debtService: 0, principal: 0, interest: 0, endBalance: 0 };
  if (r.loanAmount <= 0) return out;
  const rate = r.loanRatePct / 100 / 12;
  const yearStart = calYear * 12 + 1;
  const yearEnd = calYear * 12 + 12;
  let balance = r.loanAmount;
  for (let idx = r.startIdx; idx <= yearEnd && balance > 0; idx++) {
    const interest = balance * rate;
    const principal = Math.min(balance, Math.max(0, monthlyPayment - interest));
    balance -= principal;
    if (idx >= yearStart) {
      out.interest += interest;
      out.principal += principal;
      out.debtService += interest + principal;
    }
  }
  out.endBalance = Math.max(0, balance);
  return out;
}
