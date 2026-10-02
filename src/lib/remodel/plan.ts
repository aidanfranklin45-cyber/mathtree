import type { DealInputs, DealRecord } from '../math/types';
import type { RemodelInput } from '../../../supabase/functions/_shared/remodel';
import { computeDealMetrics } from '../engine/compute';

/**
 * A remodel or expansion the owner is considering for a property they already own. This is the stored fact (it lives in the
 * deal's inputs as `remodelPlans`); nothing derived from it is ever stored. Run it through `applyRemodel` to get the engine
 * overrides and `evaluateRemodel` for the verdict.
 */
export interface RemodelPlan {
  id: string;
  name: string; // "Add 2 units", "Expand rear 4,000 sf"
  startDate: string; // 'YYYY-MM' (or 'YYYY-MM-DD'): when work begins
  durationMonths: number;
  cost: number; // total capex
  financing: 'cash' | 'new_loan';
  ltcPct?: number; // new_loan: share of the cost borrowed (engine default 80)
  loanRatePct?: number; // default: the deal's own rate
  loanTermYears?: number; // engine default 20
  rentDuringWorksPct: number; // 0 = fully down while building, 100 = unaffected
  rentAfter: {
    mode: 'monthly' | 'pct_increase' | 'per_sf';
    /** monthly: the property's new TOTAL monthly rent. pct_increase: % on today's rent. per_sf: $ per sf per YEAR on `addedSf`. */
    value: number;
    addedSf?: number;
  };
  /** Extra operating cost per year once complete. Left out = the deal's own expense ratio on the added rent when the deal's
   *  expenses are fixed (expense growth set), or nothing when expenses already scale with rent (the engine does that itself). */
  extraOpexAnnual?: number;
  valueMode: 'cap_rate' | 'manual';
  capRatePct?: number;
  manualValue?: number;
}

type PlanDeal = Pick<DealRecord, 'asset_class' | 'inputs' | 'purchase_price' | 'assetType'>;

const num = (v: unknown, fallback = 0): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : fallback;
};

/** The saved plans on a deal (tolerates a missing or malformed field). */
export function getRemodelPlans(deal: Pick<DealRecord, 'inputs'>): RemodelPlan[] {
  const raw = (deal.inputs as Record<string, unknown> | undefined)?.remodelPlans;
  return Array.isArray(raw) ? (raw.filter((p) => p && typeof p === 'object') as RemodelPlan[]) : [];
}

/** Year of a plan's start date, or null when unreadable. */
export function planStartYear(plan: Pick<RemodelPlan, 'startDate'>): number | null {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(plan.startDate ?? '').trim());
  return m ? parseInt(m[1], 10) : null;
}

/** What the property earns per month, in the year the work starts (the base case, with no remodel). */
function currentMonthlyRent(deal: PlanDeal, plan: RemodelPlan): number {
  const rows: any[] = computeDealMetrics(deal).projections ?? [];
  if (rows.length === 0) return 0;
  const startYear = planStartYear(plan);
  const row = rows.find((p) => p.calendarYear === startYear)
    ?? (startYear !== null && startYear < rows[0].calendarYear ? rows[0] : rows[rows.length - 1]);
  const months = Number(row.operatingMonths) || 12;
  return (Number(row.grossPotentialIncome ?? row.grossPotentialRent) || 0) / months;
}

/** True when the deal's expenses are fixed to year-1 rent (the engine then needs the added upkeep stated explicitly). */
function expensesAreFixed(inputs: Record<string, any>): boolean {
  const g = inputs.expenseGrowth ?? inputs.expenseInflation ?? inputs.expenseGrowthRate ?? inputs.expenseGrowthPercent ?? inputs.holdingInflation;
  return g !== undefined && g !== null && g !== '';
}

/** The monthly rent a plan adds, in the dollars of its start year (the engine grows it from completion). */
export function planRentUpliftMonthly(deal: PlanDeal, plan: RemodelPlan): number {
  const { mode, value, addedSf } = plan.rentAfter ?? { mode: 'monthly', value: 0 };
  switch (mode) {
    case 'pct_increase':
      return Math.max(0, currentMonthlyRent(deal, plan) * (num(value) / 100));
    case 'per_sf':
      return Math.max(0, (num(addedSf) * num(value)) / 12);
    case 'monthly':
    default:
      return Math.max(0, num(value) - currentMonthlyRent(deal, plan));
  }
}

/**
 * The engine overrides that turn the live deal into the "after the remodel" deal: `{ remodel }`. Pure; the deal is not touched.
 * Pass the result as `overrides` to `computeDealMetrics` (or as a Compare column's overrides).
 */
export function applyRemodel(deal: PlanDeal, plan: RemodelPlan): Partial<DealInputs> {
  const uplift = planRentUpliftMonthly(deal, plan);
  const inputs = (deal.inputs ?? {}) as Record<string, any>;
  const ratio = num(inputs.expenseRatio ?? inputs.operatingExpenseRatio, 0);
  const extra = plan.extraOpexAnnual !== undefined && plan.extraOpexAnnual !== null
    ? Math.max(0, num(plan.extraOpexAnnual))
    : expensesAreFixed(inputs) ? Math.round(uplift * 12 * (ratio / 100)) : 0;

  const remodel: RemodelInput = {
    startDate: plan.startDate,
    durationMonths: plan.durationMonths,
    cost: plan.cost,
    financing: plan.financing,
    rentDuringWorksPct: plan.rentDuringWorksPct,
    rentUpliftMonthly: Math.round(uplift * 100) / 100,
    extraOpexAnnual: extra,
    valueMode: plan.valueMode,
    ...(plan.financing === 'new_loan' ? { ltcPct: plan.ltcPct, loanRatePct: plan.loanRatePct, loanTermYears: plan.loanTermYears } : {}),
    ...(plan.capRatePct !== undefined ? { capRatePct: plan.capRatePct } : {}),
    ...(plan.manualValue !== undefined ? { manualValue: plan.manualValue } : {}),
  };
  return { remodel };
}
