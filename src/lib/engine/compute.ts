import type { DealInputs, DealMetrics, DealRecord, SensitivityMatrix, TaxMetrics } from '../math/types';
import { calculateProjections, calculateSensitivityMatrix, calculateTaxMetrics, IncompleteInputsError } from './index';
import { applyLeaseExpiryDefaults } from '../../../supabase/functions/_shared/leaseExpiry';
import { getExpiryDefaults } from './expiryDefaults';
import { getAssumptionDefaults } from './assumptionDefaults';
import { KEYS, checkEngineInputs, parseClosingDate, stated, type MissingInput } from '../../../supabase/functions/_shared/inputRequirements';
import { seedFromAssumptions, type InputBasis } from '../../../supabase/functions/_shared/underwritingAssumptions';

/**
 * Compute-on-the-fly entry points. Everything derived from a deal (projections, amortization, IRR,
 * LTV, DSCR, tax shield, sensitivity grid) is calculated here from the deal's *facts* (its inputs).
 * Nothing is persisted; results are memoised in-process only, keyed by the exact inputs.
 */

type AnyDeal = Pick<DealRecord, 'asset_class'> & Partial<Pick<DealRecord, 'inputs' | 'purchase_price' | 'assetType'>>;

/**
 * The assumptions a property relies on the owner's profile for. A property that states its own figure always wins; these are only for the
 * assumptions the engine needs and the property leaves unstated. Facts (closing date, the loan, a lease's rent) are never filled here.
 * Returns each filled figure with its source and the owner's reason.
 */
const PROFILE_FILLS: Record<string, readonly string[]> = {
  exitYear: KEYS.hold,
  discountRate: KEYS.discountRate,
  vacancyRate: KEYS.vacancy,
  expenseRatio: KEYS.expenseRatio,
  operatingExpenseRatio: KEYS.expenseRatio,
  rentGrowth: KEYS.rentGrowth,
  targetCapRate: KEYS.exitCap,
  targetExitCapRate: KEYS.exitCap,
  appreciationRate: ['appreciationRate'],
  sellingCostPercent: KEYS.sellingCost,
  closingCosts: ['closingCosts'],
  capexReserveAnnual: [...KEYS.capexAnnual, ...KEYS.capexPercent],
  capexReservePercent: [...KEYS.capexAnnual, ...KEYS.capexPercent],
  managementFeePercent: ['managementFeePercent'],
  payrollMarketingPercent: ['payrollMarketingPercent'],
  annualTaxes: KEYS.taxes,
  annualInsurance: KEYS.insurance,
  annualMaintenance: KEYS.maintenance,
};

export function resolveProfileAssumptions(deal: AnyDeal, overrides?: Partial<DealInputs>): { filled: Record<string, number>; basis: Record<string, InputBasis> } {
  const base: Record<string, any> = { ...(deal.inputs ?? {}), ...(overrides ?? {}) };
  const asset = String(deal.asset_class ?? deal.assetType ?? 'commercial');
  const defaults = getAssumptionDefaults();
  const price = Number(base.purchasePrice || deal.purchase_price) || null;
  const units = asset === 'single-family' || asset === 'residential' ? 1 : Number(base.unitCount || base.storageUnitCount || base.numUnits) || null;
  const seeded = seedFromAssumptions(defaults.assumptions, {
    assetClass: asset,
    leaseType: base.leaseType,
    purchasePrice: price,
    unitCount: units,
    squareFeet: Number(base.gla || base.buildingSqFt || base.storageSqFt || base.totalSqFt) || null,
    discountRate: defaults.discountRate ?? null,
    exitYear: defaults.exitYear ?? null,
    assessedValue: Number(base.taxableValue || base.totalAssessedValue || base.combinedAssessedValue) || null,
  });
  const filled: Record<string, number> = {};
  const basis: Record<string, InputBasis> = {};
  for (const [key, value] of Object.entries(seeded.inputs)) {
    const group = PROFILE_FILLS[key];
    if (!group) continue; // not an assumption the engine needs
    if (stated({ ...base, ...filled }, ...group) !== undefined) continue; // the property states its own, or an alias was just filled
    filled[key] = value;
    if (seeded.basis[key]) basis[key] = seeded.basis[key];
  }
  return { filled, basis };
}

/** What a property still lacks once the owner's assumptions have been applied: the facts only the property can state. */
export function missingInputsFor(deal: AnyDeal, overrides?: Partial<DealInputs>): MissingInput[] {
  return checkEngineInputs(String(deal.asset_class ?? deal.assetType ?? 'commercial'), prepareEngineInputs(deal, overrides));
}

/** Merge facts into engine-ready inputs (same normalisation the old edge function applied), then the owner's assumptions for what is unstated. */
export function prepareEngineInputs(deal: AnyDeal, overrides?: Partial<DealInputs>): Record<string, any> {
  const inputs: Record<string, any> = { ...(deal.inputs ?? {}), ...(overrides ?? {}) };

  if (!inputs.purchasePrice && deal.purchase_price) inputs.purchasePrice = Number(deal.purchase_price);

  // The owner's own assumptions fill what the property leaves unstated, live (a property's own figure always wins)
  Object.assign(inputs, resolveProfileAssumptions(deal, overrides).filled);

  // A pipeline deal being sized for feasibility has no closing date yet. It is assumed to close the owner's stated number of weeks after the
  // day the analysis is run, and the preliminary amortization schedule starts there. Dated leases are measured from a real closing date,
  // which stays required; so does a closing date when the owner has set no such assumption.
  const hasDatedLeases = Array.isArray(inputs.leases) && inputs.leases.some((l: any) => l?.leaseStartDate || l?.leaseEndDate);
  const weeks = getAssumptionDefaults().assumptions.assumedClosingWeeks;
  if (!parseClosingDate(inputs.closingDate) && !hasDatedLeases && weeks !== undefined) {
    inputs.closingDate = new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10);
  }

  // An ARV that merely echoes the county assessment is not a real post-rehab value
  const assessed = Number(inputs.totalAssessedValue || inputs.combinedAssessedValue || 0);
  if (inputs.arv && Number(inputs.arv) === assessed) delete inputs.arv;

  // Leases with no expiry assumption of their own get the investor default from their profile
  return applyLeaseExpiryDefaults(inputs, getExpiryDefaults());
}

const assetOf = (deal: AnyDeal): string => String(deal.asset_class ?? deal.assetType ?? 'commercial');

// Small bounded memo so list views re-rendering don't recompute identical deals.
const MEMO_LIMIT = 200;
const memo = new Map<string, unknown>();
function memoized<T>(key: string, compute: () => T): T {
  if (memo.has(key)) {
    const hit = memo.get(key) as T;
    memo.delete(key); // refresh recency
    memo.set(key, hit);
    return hit;
  }
  const value = compute();
  memo.set(key, value);
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
  return value;
}

export function computeDealMetrics(deal: AnyDeal, overrides?: Partial<DealInputs>): DealMetrics {
  const asset = assetOf(deal);
  const inputs = prepareEngineInputs(deal, overrides);
  return memoized(`m|${asset}|${JSON.stringify(inputs)}`, () => toDealMetrics(calculateProjections(asset, inputs)));
}

/**
 * The engine names a few per-year fields differently from the UI's ProFormaYear contract
 * (grossPotentialIncome / loanBalanceRemaining). Reconcile once here so no component has to care.
 */
function toDealMetrics(raw: any): DealMetrics {
  let cumulative = 0;
  const projections = (Array.isArray(raw.projections) ? raw.projections : []).map((p: any) => {
    cumulative += Number(p.cashFlow) || 0;
    return {
      ...p,
      grossPotentialRent: p.grossPotentialRent ?? p.grossPotentialIncome ?? 0,
      endingLoanBalance: p.endingLoanBalance ?? p.loanBalanceRemaining ?? p.endingDebt ?? 0,
      cumulativeCashFlow: p.cumulativeCashFlow ?? cumulative,
    };
  });
  return { ...raw, projections } as DealMetrics;
}

/** For list views: one malformed deal must not blank the whole page. */
export function tryComputeDealMetrics(deal: AnyDeal, overrides?: Partial<DealInputs>): DealMetrics | null {
  try {
    return computeDealMetrics(deal, overrides);
  } catch (err) {
    // A property that does not yet state everything is an expected state (the screens say what is missing), not a fault worth logging
    if (!(err instanceof IncompleteInputsError)) console.warn('[engine] could not compute deal', (deal as { id?: string }).id, err);
    return null;
  }
}

export function computeTaxMetrics(deal: AnyDeal, overrides?: Partial<DealInputs>): TaxMetrics {
  const asset = assetOf(deal);
  const inputs = prepareEngineInputs(deal, overrides);
  return memoized(`t|${asset}|${JSON.stringify(inputs)}`, () => calculateTaxMetrics(asset, inputs as DealInputs));
}

/**
 * The engine returns a generic `{ rowValues, colValues, matrix[r][c] }` grid; the studio's
 * SensitivityMatrix is `{ capRateSteps (rows), vacancySteps (cols), irrGrid[cap][vac] }`.
 */
export function computeSensitivity(deal: AnyDeal, overrides?: Partial<DealInputs>): SensitivityMatrix {
  const asset = assetOf(deal);
  const inputs = prepareEngineInputs(deal, overrides);
  return memoized(`s|${asset}|${JSON.stringify(inputs)}`, () => {
    const grid = calculateSensitivityMatrix(asset, inputs, 'targetCapRate', undefined, 'vacancyRate', undefined);
    return {
      capRateSteps: grid.rowValues as number[],
      vacancySteps: grid.colValues as number[],
      irrGrid: (grid.matrix as any[][]).map((row) => row.map((cell) => Number(cell.irr) || 0)),
    };
  });
}
