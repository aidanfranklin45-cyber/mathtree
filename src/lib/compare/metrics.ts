import { ComparisonSummary } from './compareTypes';
import { formatCurrency } from '../format';

/** How a metric's number is read: it decides formatting and how a difference against the benchmark is written. */
export type MetricKind = 'pct' | 'money' | 'multiple' | 'number';

export interface MetricDef {
  key: string;
  label: string;
  /** Short label for chips, cards and chart axes. */
  short: string;
  description: string;
  kind: MetricKind;
  get: (s: ComparisonSummary) => number | null;
  format: (v: number | null) => string;
  lowerBetter?: boolean;
  highlight?: boolean;
}

export interface MetricGroup {
  id: string;
  title: string;
  accentColor: string;
  metrics: MetricDef[];
}

const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && !isNaN(v);
export const fmtPct = (v: number | null) => (ok(v) ? `${v.toFixed(2)}%` : '—');
export const fmtMultiple = (v: number | null) => (ok(v) ? `${v.toFixed(2)}x` : '—');
export const fmtMoney = (v: number | null) => (ok(v) ? formatCurrency(v) : '—');
const fmtPerMonth = (v: number | null) => (ok(v) ? `${formatCurrency(v)}/mo` : '—');
const fmtYears = (v: number | null) => (ok(v) ? `${v} yrs` : '—');
const fmtDscr = (v: number | null) => (ok(v) ? `${v.toFixed(2)}x` : 'N/A (All Cash)');

export const METRIC_GROUPS: MetricGroup[] = [
  {
    id: 'returns',
    title: 'FINANCIAL RETURNS & INVESTMENT YIELD',
    accentColor: 'text-brand-400',
    metrics: [
      { key: 'irr', label: '10-Year Levered IRR', short: 'IRR', description: 'Annualized rate of return taking into account debt service and 10-year terminal sale equity', kind: 'pct', get: (s) => s.irr, format: fmtPct, highlight: true },
      { key: 'cashOnCash', label: 'Year 1 Cash-on-Cash Return', short: 'Cash-on-cash', description: 'Year 1 net cash flow divided by total initial cash equity invested', kind: 'pct', get: (s) => s.cashOnCashYear1, format: fmtPct, highlight: true },
      { key: 'blendedCoC', label: '10-Year Blended CoC Yield', short: 'Blended CoC', description: 'Average annual operational cash-on-cash yield over the 10-year holding period', kind: 'pct', get: (s) => s.blendedCoC, format: fmtPct },
      { key: 'equityMultiple', label: '10-Year Equity Multiple', short: 'Equity multiple', description: 'Total cumulative cash flow plus exit equity divided by initial cash invested', kind: 'multiple', get: (s) => s.equityMultiple, format: fmtMultiple, highlight: true },
      { key: 'npv', label: '10-Year Net Present Value (NPV)', short: 'NPV', description: 'Discounted net present value of all cash flows and residual equity at underwriting hurdle rate', kind: 'money', get: (s) => s.npv, format: fmtMoney },
      { key: 'totalWealth', label: '10-Year Net Wealth Created', short: 'Wealth created', description: 'Total net dollars generated after initial equity return', kind: 'money', get: (s) => s.totalWealthCreated, format: fmtMoney, highlight: true },
    ],
  },
  {
    id: 'capital',
    title: 'CAPITAL STACK & FINANCING BASIS',
    accentColor: 'text-cyan-400',
    metrics: [
      { key: 'purchasePrice', label: 'Purchase Basis', short: 'Price', description: 'Total contract purchase price / asset acquisition basis', kind: 'money', get: (s) => s.purchasePrice, format: fmtMoney, lowerBetter: true },
      { key: 'initialCash', label: 'Initial Cash Equity Required', short: 'Cash required', description: 'Total upfront out-of-pocket cash (down payment + closing costs + initial CapEx)', kind: 'money', get: (s) => s.initialCash, format: fmtMoney, lowerBetter: true },
      { key: 'loanAmount', label: 'Senior Debt Financed', short: 'Loan', description: 'Principal loan balance at acquisition', kind: 'money', get: (s) => s.loanAmount, format: fmtMoney },
      { key: 'ltv', label: 'Loan-to-Value (LTV %)', short: 'LTV', description: 'Debt divided by purchase price at acquisition', kind: 'pct', get: (s) => (s.purchasePrice > 0 ? (s.loanAmount / s.purchasePrice) * 100 : 0), format: fmtPct, lowerBetter: true },
      { key: 'interestRate', label: 'Mortgage Interest Rate', short: 'Rate', description: 'Annual interest rate on senior financing', kind: 'pct', get: (s) => s.interestRate, format: fmtPct, lowerBetter: true },
      { key: 'loanTerm', label: 'Amortization Term', short: 'Term', description: 'Length of loan amortization schedule in years', kind: 'number', get: (s) => s.loanTerm, format: fmtYears },
      { key: 'monthlyDebt', label: 'Monthly Debt Service', short: 'Monthly debt', description: 'Monthly principal and interest payment obligation', kind: 'money', get: (s) => s.monthlyDebt, format: fmtPerMonth, lowerBetter: true },
      { key: 'annualDebt', label: 'Annual Debt Service', short: 'Annual debt', description: 'Total year 1 debt service payments', kind: 'money', get: (s) => s.annualDebt, format: fmtMoney, lowerBetter: true },
    ],
  },
  {
    id: 'operations',
    title: 'OPERATING CASH FLOW & ASSET HEALTH',
    accentColor: 'text-emerald-400',
    metrics: [
      { key: 'grossRentAnnual', label: 'Gross Potential Rent (Annual)', short: 'Gross rent', description: 'Top-line gross rent roll scheduled at 100% occupancy', kind: 'money', get: (s) => s.grossRentAnnual, format: fmtMoney },
      { key: 'grossRentMonthly', label: 'Gross Rent (Monthly)', short: 'Monthly rent', description: 'Monthly scheduled revenue at 100% occupancy', kind: 'money', get: (s) => s.grossRentMonthly, format: fmtPerMonth },
      { key: 'vacancyRate', label: 'Underwritten Vacancy Rate', short: 'Vacancy', description: 'Estimated vacancy allowance percentage', kind: 'pct', get: (s) => s.vacancyRate, format: fmtPct, lowerBetter: true },
      { key: 'operatingExpenses', label: 'Operating Expenses (Yr 1)', short: 'OpEx', description: 'Annual property taxes, insurance, repairs, management, and utilities', kind: 'money', get: (s) => s.operatingExpenses, format: fmtMoney, lowerBetter: true },
      { key: 'expenseRatio', label: 'Operating Expense Ratio', short: 'Expense ratio', description: 'Operating expenses divided by gross revenue', kind: 'pct', get: (s) => s.expenseRatio, format: fmtPct, lowerBetter: true },
      { key: 'noi', label: 'Net Operating Income (NOI)', short: 'NOI', description: 'Effective gross income minus total operating expenses (pre-debt cash flow)', kind: 'money', get: (s) => s.noi, format: fmtMoney, highlight: true },
      { key: 'capRateYear1', label: 'Going-In Cap Rate Yield', short: 'Cap rate', description: 'Year 1 Net Operating Income divided by purchase price', kind: 'pct', get: (s) => s.capRateYear1, format: fmtPct, highlight: true },
      { key: 'exitCapRate', label: 'Exit / Terminal Cap Rate', short: 'Exit cap', description: 'Projected cap rate used to determine Year 10 exit sale valuation', kind: 'pct', get: (s) => s.exitCapRate, format: fmtPct },
      { key: 'dscr', label: 'Senior DSCR (Debt Coverage)', short: 'DSCR', description: 'Net Operating Income divided by annual debt service (lender coverage ratio)', kind: 'multiple', get: (s) => s.dscr, format: fmtDscr, highlight: true },
      { key: 'cashFlowYear1', label: 'Year 1 Net Operational Cash Flow', short: 'Cash flow', description: 'NOI minus debt service (actual bottom-line cash pocketed in year 1)', kind: 'money', get: (s) => s.cashFlowYear1, format: fmtMoney, highlight: true },
    ],
  },
  {
    id: 'projections',
    title: '10-YEAR EXIT & TERMINAL OUTLOOK',
    accentColor: 'text-amber-400',
    metrics: [
      { key: 'tenYearCashFlow', label: '10-Year Cumulative Cash Flow', short: '10-yr cash flow', description: 'Total aggregate post-debt cash flows over 10 years of operation', kind: 'money', get: (s) => s.tenYearCashFlow, format: fmtMoney },
      { key: 'terminalValue', label: 'Year 10 Terminal Value', short: 'Terminal value', description: 'Projected property resale value in Year 10 based on capitalized NOI', kind: 'money', get: (s) => s.tenYearTerminalValue, format: fmtMoney },
    ],
  },
];

export const ALL_METRICS: MetricDef[] = METRIC_GROUPS.flatMap((g) => g.metrics);
const BY_KEY = new Map(ALL_METRICS.map((m) => [m.key, m]));

export const getMetric = (key: string): MetricDef | undefined => BY_KEY.get(key);

/** Ready-made metric selections, in the order shown in the Metrics panel. */
export interface MetricSet {
  id: string;
  label: string;
  keys: string[];
}

export const CORE_METRIC_KEYS = ['irr', 'cashOnCash', 'equityMultiple', 'npv', 'dscr', 'cashFlowYear1', 'purchasePrice'];

export const METRIC_SETS: MetricSet[] = [
  { id: 'core', label: 'Core', keys: CORE_METRIC_KEYS },
  { id: 'returns', label: 'Returns', keys: METRIC_GROUPS[0].metrics.map((m) => m.key) },
  { id: 'financing', label: 'Financing', keys: METRIC_GROUPS[1].metrics.map((m) => m.key) },
  { id: 'operations', label: 'Operations', keys: METRIC_GROUPS[2].metrics.map((m) => m.key) },
  { id: 'everything', label: 'Everything', keys: ALL_METRICS.map((m) => m.key) },
];

/** Drop unknown keys (an old saved view may name a metric that no longer exists) and fall back to Core when nothing is left. */
export function normalizeMetricKeys(keys: unknown): string[] {
  const list = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string' && BY_KEY.has(k)) : [];
  const unique = Array.from(new Set(list));
  return unique.length > 0 ? unique : [...CORE_METRIC_KEYS];
}

/** The metric set a selection matches exactly, or null when it is a custom pick. */
export function matchingMetricSet(keys: string[]): MetricSet | null {
  const sel = new Set(keys);
  return METRIC_SETS.find((s) => s.keys.length === sel.size && s.keys.every((k) => sel.has(k))) ?? null;
}

/** Groups narrowed to the selected metrics (empty groups dropped), keeping the canonical order. */
export function groupsForKeys(keys: string[]): MetricGroup[] {
  const sel = new Set(keys);
  return METRIC_GROUPS.map((g) => ({ ...g, metrics: g.metrics.filter((m) => sel.has(m.key)) })).filter((g) => g.metrics.length > 0);
}

/** A column's difference against the benchmark, written the way the metric is read. */
export function formatVariance(metric: MetricDef, diff: number): string {
  const sign = diff > 0 ? '+' : '';
  if (metric.kind === 'pct') return `${sign}${diff.toFixed(2)}%`;
  if (metric.kind === 'money') return `${diff > 0 ? '+$' : '-$'}${Math.abs(Math.round(diff)).toLocaleString()}`;
  return `${sign}${diff.toFixed(2)}`;
}

/** Best value of a metric among columns (ignoring missing values), respecting which direction is better. */
export function bestColumnId(metric: MetricDef, cols: Array<{ id: string; summary: ComparisonSummary }>): string | null {
  let best: { id: string; v: number } | null = null;
  for (const c of cols) {
    const v = metric.get(c.summary);
    if (!ok(v)) continue;
    if (!best || (metric.lowerBetter ? v < best.v : v > best.v)) best = { id: c.id, v };
  }
  return best?.id ?? null;
}

/** Columns ordered by a metric, best first (missing values last). Stable for ties. */
export function rankColumns<T extends { summary: ComparisonSummary }>(cols: T[], metric: MetricDef, dir: 'best' | 'worst' = 'best'): T[] {
  const sign = (metric.lowerBetter ? 1 : -1) * (dir === 'best' ? 1 : -1);
  return cols
    .map((c, i) => ({ c, i, v: metric.get(c.summary) }))
    .sort((a, b) => {
      const am = !ok(a.v);
      const bm = !ok(b.v);
      if (am || bm) return am === bm ? a.i - b.i : am ? 1 : -1;
      return (a.v! - b.v!) * sign || a.i - b.i;
    })
    .map((x) => x.c);
}
