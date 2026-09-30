import type { DealInputs, DealMetrics, DealRecord, SensitivityMatrix, TaxMetrics } from '../math/types';
import { calculateProjections, calculateSensitivityMatrix, calculateTaxMetrics } from './index';
import { applyLeaseExpiryDefaults } from '../../../supabase/functions/_shared/leaseExpiry';
import { getExpiryDefaults } from './expiryDefaults';

/**
 * Compute-on-the-fly entry points. Everything derived from a deal (projections, amortization, IRR,
 * LTV, DSCR, tax shield, sensitivity grid) is calculated here from the deal's *facts* (its inputs).
 * Nothing is persisted; results are memoised in-process only, keyed by the exact inputs.
 */

type AnyDeal = Pick<DealRecord, 'asset_class'> & Partial<Pick<DealRecord, 'inputs' | 'purchase_price' | 'assetType'>>;

/** Merge facts into engine-ready inputs (same normalisation the old edge function applied). */
export function prepareEngineInputs(deal: AnyDeal, overrides?: Partial<DealInputs>): Record<string, any> {
  const inputs: Record<string, any> = { ...(deal.inputs ?? {}), ...(overrides ?? {}) };

  if (!inputs.purchasePrice && deal.purchase_price) inputs.purchasePrice = Number(deal.purchase_price);

  // An ARV that merely echoes the county assessment is not a real post-rehab value
  const assessed = Number(inputs.totalAssessedValue || inputs.combinedAssessedValue || 0);
  if (inputs.arv && Number(inputs.arv) === assessed) delete inputs.arv;

  if (inputs.discountRate === undefined || inputs.discountRate === null) inputs.discountRate = 8.0;
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
    console.warn('[engine] could not compute deal', (deal as { id?: string }).id, err);
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
