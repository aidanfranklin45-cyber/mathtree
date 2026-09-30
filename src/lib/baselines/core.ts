/**
 * Baselines: the frozen pro-forma "what we expected when we bought it".
 *
 * Everything else in the app is computed on demand from inputs. A baseline is the one deliberate exception: it is a
 * dated record (like a signed underwriting memo), so it is captured once with the shared engine and never recomputed;
 * a newer engine must not quietly rewrite past expectations. This file is pure (no database access) so it is testable.
 */
import { computeDealMetrics } from '../engine/compute';
import { ENGINE_VERSION } from '../engine/version';
import type { DealMetrics, DealRecord } from '../math/types';

export const BASELINE_TYPE = 'initial_underwriting';

/** Compact per-year projection kept inside a baseline (enough to compare with actual revenue, NOI and cash flow). */
export interface SlimProjection {
  year: number;
  calendarYear: number;
  operatingMonths: number;
  grossPotentialIncome: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  debtService: number;
  cashFlow: number;
  cashOnCash: number | null;
  dscr: number | null;
  propertyValue: number;
  loanBalanceRemaining: number;
}

export interface BaselineDraft {
  deal_id: string;
  user_id: string;
  baseline_type: string;
  purchase_price: number;
  projected_gross_rent_annual: number;
  projected_noi: number;
  projected_cash_flow: number;
  projected_irr: number | null;
  projected_cash_on_cash: number | null;
  inputs_snapshot: Record<string, unknown>;
  metrics_snapshot: Record<string, unknown>;
}

export interface BaselineRow extends BaselineDraft {
  id: string;
  captured_at: string;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return isNaN(x) ? 0 : x;
};
const nOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const x = Number(v);
  return isNaN(x) ? null : x;
};

/** First full operating year (year 1 is a short stub when closing is mid-year), the same basis as the headline DSCR. */
export function firstFullYear<T extends { operatingMonths?: number }>(projections: T[]): T | undefined {
  const p0 = projections[0];
  if (p0 && Number(p0.operatingMonths) < 12 && projections[1]) return projections[1];
  return p0;
}

function toSlim(p: Record<string, any>, i: number): SlimProjection {
  return {
    year: n(p.year) || i + 1,
    calendarYear: n(p.calendarYear),
    operatingMonths: n(p.operatingMonths) || 12,
    grossPotentialIncome: n(p.grossPotentialIncome ?? p.grossPotentialRent),
    effectiveGrossIncome: n(p.effectiveGrossIncome),
    operatingExpenses: n(p.operatingExpenses),
    netOperatingIncome: n(p.netOperatingIncome),
    debtService: n(p.debtService),
    cashFlow: n(p.cashFlow ?? p.netCashFlow),
    cashOnCash: nOrNull(p.cashOnCash),
    dscr: nOrNull(p.dscr),
    propertyValue: n(p.propertyValue),
    loanBalanceRemaining: n(p.loanBalanceRemaining ?? p.endingLoanBalance),
  };
}

export function slimProjections(m: DealMetrics): SlimProjection[] {
  return ((m.projections ?? []) as Array<Record<string, any>>).map(toSlim);
}

/** Freeze a deal's current pro-forma. Uses the same engine and inputs the app shows. */
export function buildBaselineDraft(
  deal: Pick<DealRecord, 'id' | 'asset_class' | 'purchase_price' | 'inputs'>,
  userId: string,
): BaselineDraft {
  const m: any = computeDealMetrics(deal as DealRecord);
  const slim = slimProjections(m);
  const ff = firstFullYear(slim);

  // Parcel / assessor blobs are large and not part of the underwriting assumptions
  const { assessorData: _a, parcels: _p, ...frozenInputs } = (deal.inputs ?? {}) as Record<string, unknown>;

  return {
    deal_id: deal.id,
    user_id: userId,
    baseline_type: BASELINE_TYPE,
    purchase_price: n(deal.purchase_price) || n((deal.inputs as any)?.purchasePrice),
    projected_gross_rent_annual: ff?.grossPotentialIncome ?? 0,
    projected_noi: ff?.netOperatingIncome ?? 0,
    projected_cash_flow: ff?.cashFlow ?? 0,
    projected_irr: nOrNull(m.irr),
    projected_cash_on_cash: ff?.cashOnCash ?? null,
    inputs_snapshot: frozenInputs,
    metrics_snapshot: {
      engineVersion: ENGINE_VERSION,
      capturedBy: 'app',
      basis: 'first_full_year',
      irr: nOrNull(m.irr),
      npv: nOrNull(m.npv),
      equityMultiplier: nOrNull(m.equityMultiplier),
      dscr: nOrNull(m.dscr),
      loanAmount: nOrNull(m.loanAmount),
      annualDebtService: nOrNull(m.annualDebtService),
      monthlyMortgagePayment: nOrNull(m.monthlyMortgagePayment),
      initialCashInvested: nOrNull(m.initialCashInvested),
      projections: slim,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Comparison: expected (frozen baseline) vs current outlook (live engine) vs actual (rent roll and payments)
// ---------------------------------------------------------------------------------------------------------------------

export interface HeadlineRow {
  key: string;
  label: string;
  expected: number | null;
  current: number | null;
  delta: number | null;
  kind: 'pct' | 'currency' | 'multiple';
}

export interface MonthRow {
  month: string; // YYYY-MM
  expected: number;
  contractual: number;
  collected: number;
  isCurrent: boolean;
}

export interface Comparison {
  headline: HeadlineRow[];
  hasYearDetail: boolean;
  engineVersion: string | null;
  year: number;
  monthsElapsed: number;
  expectedYtd: number;
  contractualYtd: number;
  collectedYtd: number;
  /** The last 12 months (including the current one): projected at purchase vs what the rent roll and payments show. */
  trailing12: { expected: number; contractual: number; collected: number };
  months: MonthRow[];
}

export interface PaymentLite {
  period_month: string;
  amount_due: number | null;
  amount_paid: number | null;
  status: string;
}
export interface LeaseLite {
  monthly_rent: number | null;
  is_active: boolean | null;
}

/** Reads a baseline year defensively: older snapshots used different field names and may have no year detail. */
function baselineYear(baseline: Pick<BaselineRow, 'metrics_snapshot'>, calendarYear: number): SlimProjection | undefined {
  const list = (baseline.metrics_snapshot as any)?.projections;
  if (!Array.isArray(list)) return undefined;
  return (list as Array<Record<string, any>>).map(toSlim).find((p) => p.calendarYear === calendarYear);
}

/** Expected effective rent for one calendar month from the baseline's projection of that year (0 before acquisition). */
function expectedForMonth(baseline: Pick<BaselineRow, 'metrics_snapshot'>, year: number, month1: number): number {
  const py = baselineYear(baseline, year);
  if (!py) return 0;
  const months = Math.max(1, py.operatingMonths);
  const firstOperatingMonth = 12 - months + 1; // stub year: operation starts late in the year
  if (month1 < firstOperatingMonth) return 0;
  const income = py.effectiveGrossIncome || py.grossPotentialIncome;
  return income / months;
}

export function compareToBaseline(args: {
  baseline: BaselineRow;
  live: DealMetrics;
  payments: PaymentLite[];
  leases: LeaseLite[];
  now?: Date;
}): Comparison {
  const { baseline, live, payments, leases } = args;
  const now = args.now ?? new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const liveProj = (live.projections ?? []) as Array<Record<string, any>>;
  const liveFF = firstFullYear(liveProj as Array<{ operatingMonths?: number }>) as Record<string, any> | undefined;
  const snap = (baseline.metrics_snapshot ?? {}) as Record<string, any>;

  const row = (key: string, label: string, expected: number | null, current: number | null, kind: HeadlineRow['kind']): HeadlineRow => ({
    key,
    label,
    expected,
    current,
    kind,
    delta: expected !== null && current !== null ? current - expected : null,
  });

  const headline: HeadlineRow[] = [
    row('irr', 'Target IRR', nOrNull(baseline.projected_irr ?? snap.irr), nOrNull(live.irr), 'pct'),
    row('noi', 'NOI (first full year)', nOrNull(baseline.projected_noi), nOrNull(liveFF?.netOperatingIncome), 'currency'),
    row('cashFlow', 'Cash flow (first full year)', nOrNull(baseline.projected_cash_flow), nOrNull(liveFF?.cashFlow), 'currency'),
    row('coc', 'Cash-on-cash', nOrNull(baseline.projected_cash_on_cash), nOrNull(liveFF?.cashOnCash), 'pct'),
    row('dscr', 'DSCR', nOrNull(snap.dscr), nOrNull(live.dscr), 'multiple'),
    row('em', 'Equity multiple', nOrNull(snap.equityMultiplier ?? snap.equityMultiple), nOrNull((live as any).equityMultiplier), 'multiple'),
  ].filter((r) => r.expected !== null || r.current !== null);

  const contractualNow = leases.filter((l) => l.is_active).reduce((s, l) => s + n(l.monthly_rent), 0);
  const byMonth = new Map<string, { due: number; paid: number }>();
  for (const p of payments) {
    const key = String(p.period_month).slice(0, 7);
    const cur = byMonth.get(key) ?? { due: 0, paid: 0 };
    cur.due += n(p.amount_due);
    if (p.status === 'paid' || p.status === 'partial') cur.paid += n(p.amount_paid);
    byMonth.set(key, cur);
  }

  const ym = (y: number, m1: number) => `${y}-${String(m1).padStart(2, '0')}`;
  const monthRow = (y: number, m1: number): MonthRow => {
    const pay = byMonth.get(ym(y, m1));
    return {
      month: ym(y, m1),
      expected: expectedForMonth(baseline, y, m1),
      contractual: pay && pay.due > 0 ? pay.due : contractualNow,
      collected: pay ? pay.paid : 0,
      isCurrent: y === year && m1 === month,
    };
  };

  const ytd: MonthRow[] = [];
  for (let m1 = 1; m1 <= month; m1++) ytd.push(monthRow(year, m1));

  const months: MonthRow[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    months.push(monthRow(d.getFullYear(), d.getMonth() + 1));
  }

  const t12: MonthRow[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    t12.push(monthRow(d.getFullYear(), d.getMonth() + 1));
  }

  return {
    headline,
    hasYearDetail: !!baselineYear(baseline, year) || !!baselineYear(baseline, year - 1),
    engineVersion: typeof snap.engineVersion === 'string' ? snap.engineVersion : null,
    year,
    monthsElapsed: month,
    expectedYtd: ytd.reduce((s, r) => s + r.expected, 0),
    contractualYtd: ytd.reduce((s, r) => s + (r.expected > 0 || r.collected > 0 ? r.contractual : 0), 0),
    collectedYtd: ytd.reduce((s, r) => s + r.collected, 0),
    trailing12: {
      expected: t12.reduce((s, r) => s + r.expected, 0),
      contractual: t12.reduce((s, r) => s + (r.expected > 0 || r.collected > 0 ? r.contractual : 0), 0),
      collected: t12.reduce((s, r) => s + r.collected, 0),
    },
    months,
  };
}
