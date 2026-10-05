/**
 * Pure functions for the bankable numbers a commercial lender asks for:
 * WALT, tenant concentration (largest tenant share and HHI), trailing collection rate,
 * LTV, DSCR, debt yield, price per sq ft, break-even occupancy.
 *
 * Safety contract:
 * Any value that cannot be computed is null with a one-line reason, never 0.
 */

import type {
  FeatureMetric,
  TenantConcentration,
  PropertyFeatureVector,
  ComputeFeatureVectorArgs,
} from './types';
import { isLeaseInForce, leaseMonthlyRent, isoDay } from '@engine/leaseInForce';
import { tryComputeDealMetrics } from '../engine/compute';

const pick = (obj: Record<string, any>, ...keys: string[]): any => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
};

/**
 * Weighted Average Lease Term (WALT) in years, weighted by contract rent.
 * Month-to-month leases or leases without an explicit end date are excluded from term weighting.
 */
export function computeWalt(
  leases: Record<string, any>[] = [],
  asOf: Date = new Date(),
): FeatureMetric {
  const asOfTime = asOf.getTime();
  const inForce = leases.filter((l) => isLeaseInForce(l, asOf));

  if (inForce.length === 0) {
    return { value: null, reason: 'No active leases in force on as-of date' };
  }

  let totalWeight = 0;
  let weightedTermSum = 0;
  let termLeasesCount = 0;

  for (const l of inForce) {
    const rent = leaseMonthlyRent(l);
    if (!rent || rent <= 0) continue;

    const termType = String(pick(l, 'term_type', 'termType') ?? '').toLowerCase();
    if (termType === 'month_to_month') continue;

    const rawEnd = pick(l, 'lease_end_date', 'leaseEndDate');
    if (!rawEnd) continue;

    const endDate = new Date(rawEnd);
    if (isNaN(endDate.getTime())) continue;

    const remainingYears = Math.max(0, (endDate.getTime() - asOfTime) / (1000 * 60 * 60 * 24 * 365.25));
    weightedTermSum += rent * remainingYears;
    totalWeight += rent;
    termLeasesCount++;
  }

  if (termLeasesCount === 0 || totalWeight <= 0) {
    return { value: null, reason: 'No active fixed-term leases with expiration dates and stated rent' };
  }

  const walt = Math.round((weightedTermSum / totalWeight) * 100) / 100;
  return { value: walt, reason: `Weighted across ${termLeasesCount} fixed-term lease${termLeasesCount === 1 ? '' : 's'}` };
}

/**
 * Tenant Concentration:
 * 1. Largest tenant's share of total contract rent (0 - 100%).
 * 2. Herfindahl-Hirschman Index (HHI, 0 - 10,000). A single tenant produces 10,000.
 */
export function computeTenantConcentration(
  leases: Record<string, any>[] = [],
  asOf: Date = new Date(),
): TenantConcentration {
  const inForce = leases.filter((l) => isLeaseInForce(l, asOf));

  if (inForce.length === 0) {
    return {
      largestTenantShare: { value: null, reason: 'No active leases in force on as-of date' },
      hhi: { value: null, reason: 'No active leases in force on as-of date' },
    };
  }

  const tenantRentMap = new Map<string, number>();
  let totalRent = 0;

  for (const l of inForce) {
    const rent = leaseMonthlyRent(l);
    if (!rent || rent <= 0) continue;

    const tenantName = String(pick(l, 'tenant_name', 'tenantName') || 'Unnamed Tenant').trim().toLowerCase();
    tenantRentMap.set(tenantName, (tenantRentMap.get(tenantName) || 0) + rent);
    totalRent += rent;
  }

  if (totalRent <= 0 || tenantRentMap.size === 0) {
    return {
      largestTenantShare: { value: null, reason: 'Active leases have no stated contract rent' },
      hhi: { value: null, reason: 'Active leases have no stated contract rent' },
    };
  }

  let maxRent = 0;
  let sumSquaredShares = 0;

  for (const rent of tenantRentMap.values()) {
    if (rent > maxRent) maxRent = rent;
    const sharePercent = (rent / totalRent) * 100;
    sumSquaredShares += sharePercent * sharePercent;
  }

  const largestShare = Math.round((maxRent / totalRent) * 1000) / 10;
  const hhi = Math.round(sumSquaredShares);

  return {
    largestTenantShare: {
      value: largestShare,
      reason: `Largest tenant generates ${largestShare}% of contract rent across ${tenantRentMap.size} tenant${tenantRentMap.size === 1 ? '' : 's'}`,
    },
    hhi: {
      value: hhi,
      reason: `HHI of ${hhi} across ${tenantRentMap.size} tenant${tenantRentMap.size === 1 ? '' : 's'} (scale 0 - 10,000)`,
    },
  };
}

/**
 * Trailing 12-month collection rate: total paid / total billed (%).
 * Requires at least 3 distinct recorded months to avoid misleading volatility.
 */
export function computeTrailingCollectionRate(
  payments: Record<string, any>[] = [],
  asOf: Date = new Date(),
): FeatureMetric {
  if (!payments || payments.length === 0) {
    return { value: null, reason: 'No payment records available' };
  }

  const asOfTime = asOf.getTime();
  const twelveMonthsAgo = new Date(asOf);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const cutoffTime = twelveMonthsAgo.getTime();

  let billed = 0;
  let paid = 0;
  const monthsSeen = new Set<string>();

  for (const p of payments) {
    const rawDate = pick(p, 'due_date', 'dueDate', 'period_start', 'periodStart', 'payment_date', 'paymentDate');
    if (!rawDate) continue;

    const d = new Date(rawDate);
    const t = d.getTime();
    if (isNaN(t) || t < cutoffTime || t > asOfTime) continue;

    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthsSeen.add(ym);

    const dueAmount = Number(pick(p, 'amount_due', 'amountDue', 'amount_billed', 'amountBilled') ?? 0);
    const paidAmount = Number(pick(p, 'amount_paid', 'amountPaid') ?? 0);

    if (dueAmount > 0) billed += dueAmount;
    if (paidAmount > 0) paid += paidAmount;
  }

  if (monthsSeen.size < 3) {
    return {
      value: null,
      reason: `Fewer than 3 months of payment records observed (${monthsSeen.size} month${monthsSeen.size === 1 ? '' : 's'})`,
    };
  }

  if (billed <= 0) {
    return { value: null, reason: 'No rent charges billed in trailing 12-month window' };
  }

  const rate = Math.round((paid / billed) * 1000) / 10;
  return {
    value: rate,
    reason: `${rate}% collected over ${monthsSeen.size} observed months in trailing 12-month window`,
  };
}

/**
 * Loan to Value (LTV) ratio (%).
 */
export function computeLtv(
  deal: Record<string, any>,
  metrics: Record<string, any> | null | undefined,
): FeatureMetric {
  const inputs = deal.inputs || {};
  const price = Number(deal.purchase_price || inputs.purchasePrice || metrics?.currentVal || 0);

  if (price <= 0) {
    return { value: null, reason: 'Purchase price or property value not stated' };
  }

  const explicitLoan = pick(inputs, 'loanAmount', 'baseLoanAmount');
  const downPct = pick(inputs, 'downPaymentPercent');

  let debt = 0;
  if (explicitLoan !== undefined && explicitLoan !== null) {
    debt = Number(explicitLoan);
  } else if (downPct !== undefined && downPct !== null) {
    const down = Number(downPct);
    debt = price * Math.max(0, 1 - down / 100);
  } else if (metrics?.baseLoanAmount !== undefined || metrics?.loanAmount !== undefined) {
    debt = Number(metrics.baseLoanAmount ?? metrics.loanAmount ?? 0);
  } else {
    return { value: null, reason: 'Loan terms (loan amount or down payment) not stated' };
  }

  if (debt === 0) {
    return { value: 0, reason: 'Property is 100% equity (unencumbered)' };
  }

  const ltv = Math.round((debt / price) * 1000) / 10;
  return { value: ltv, reason: `${ltv}% loan-to-value on stated purchase price` };
}

/**
 * Debt Service Coverage Ratio (DSCR).
 */
export function computeDscr(
  metrics: Record<string, any> | null | undefined,
): FeatureMetric {
  if (!metrics) {
    return { value: null, reason: 'Engine metrics not computed' };
  }

  const rawDscr = metrics.dscr;
  if (rawDscr !== undefined && rawDscr !== null && rawDscr !== 'N/A') {
    const num = Number(rawDscr);
    if (!isNaN(num) && num > 0) {
      return { value: Math.round(num * 100) / 100, reason: `Headline first full year DSCR of ${num.toFixed(2)}x` };
    }
  }

  const debtService = Number(metrics.annualDebtService ?? metrics.projections?.[0]?.debtService ?? 0);
  if (debtService <= 0) {
    return { value: null, reason: 'Property has no annual debt service' };
  }

  return { value: null, reason: 'DSCR could not be computed from available metrics' };
}

/**
 * Debt Yield: First full year Net Operating Income / Initial Loan Amount (%).
 */
export function computeDebtYield(
  deal: Record<string, any>,
  metrics: Record<string, any> | null | undefined,
): FeatureMetric {
  const inputs = deal.inputs || {};
  const price = Number(deal.purchase_price || inputs.purchasePrice || 0);
  const explicitLoan = pick(inputs, 'loanAmount', 'baseLoanAmount');
  const downPct = pick(inputs, 'downPaymentPercent');

  let loanAmount = 0;
  if (explicitLoan !== undefined && explicitLoan !== null) {
    loanAmount = Number(explicitLoan);
  } else if (downPct !== undefined && downPct !== null && price > 0) {
    loanAmount = price * Math.max(0, 1 - Number(downPct) / 100);
  } else if (metrics?.baseLoanAmount || metrics?.loanAmount) {
    loanAmount = Number(metrics.baseLoanAmount ?? metrics.loanAmount);
  }

  if (loanAmount <= 0) {
    return { value: null, reason: 'Property has no outstanding debt' };
  }

  const y1 = metrics?.projections?.[0];
  const noi = Number(metrics?.year1NOI ?? y1?.noi ?? 0);

  if (noi <= 0) {
    return { value: null, reason: 'First full year NOI is zero, negative, or not available' };
  }

  const yieldPct = Math.round((noi / loanAmount) * 1000) / 10;
  return { value: yieldPct, reason: `${yieldPct}% debt yield on initial loan balance` };
}

/**
 * Price per Square Foot ($/sqft).
 */
export function computePricePerSqFt(
  deal: Record<string, any>,
): FeatureMetric {
  const inputs = deal.inputs || {};
  const price = Number(deal.purchase_price || inputs.purchasePrice || 0);

  if (price <= 0) {
    return { value: null, reason: 'Purchase price not stated' };
  }

  const sqft = Number(
    pick(inputs, 'buildingSqft', 'squareFeet', 'totalSqFt', 'grossBuildingArea', 'rentableSqft') ?? 0,
  );

  if (sqft <= 0) {
    return { value: null, reason: 'Building square footage not stated' };
  }

  const perSqFt = Math.round((price / sqft) * 100) / 100;
  return { value: perSqFt, reason: `$${perSqFt.toFixed(2)}/sqft across ${sqft.toLocaleString()} sqft` };
}

/**
 * Break-Even Occupancy: (Operating Expenses + Annual Debt Service) / Gross Potential Rent (%).
 * Measures the minimum occupancy rate required to cover all operating expenses and debt service.
 */
export function computeBreakEvenOccupancy(
  deal: Record<string, any>,
  metrics: Record<string, any> | null | undefined,
): FeatureMetric {
  const y1 = metrics?.projections?.[0];

  const opex = Number(y1?.operatingExpenses ?? metrics?.year1Expenses ?? 0);
  const debtService = Number(y1?.debtService ?? metrics?.annualDebtService ?? 0);
  const grossRent = Number(
    y1?.potentialGrossRevenue ?? y1?.grossPotentialRent ?? metrics?.grossPotentialRent ?? deal.inputs?.grossRentAnnual ?? 0,
  );

  if (grossRent <= 0) {
    return { value: null, reason: 'Gross potential rent is zero or unstated' };
  }

  const totalRequired = opex + debtService;
  const breakEven = Math.round((totalRequired / grossRent) * 1000) / 10;

  return {
    value: breakEven,
    reason: `${breakEven}% occupancy required to cover $${Math.round(totalRequired).toLocaleString()} in OpEx and debt service`,
  };
}

/**
 * Master assembler: constructs the complete PropertyFeatureVector for a deal.
 */
export function computePropertyFeatureVector({
  deal,
  leases,
  payments = [],
  metrics,
  asOf = new Date(),
}: ComputeFeatureVectorArgs): PropertyFeatureVector {
  const asOfDate = typeof asOf === 'string' ? new Date(asOf) : asOf;
  const activeLeases = leases ?? (Array.isArray(deal.inputs?.leases) ? deal.inputs.leases : []);
  const dealMetrics = metrics ?? tryComputeDealMetrics(deal as any);

  return {
    dealId: String(deal.id || ''),
    asOf: isoDay(asOfDate),
    walt: computeWalt(activeLeases, asOfDate),
    tenantConcentration: computeTenantConcentration(activeLeases, asOfDate),
    trailingCollectionRate: computeTrailingCollectionRate(payments, asOfDate),
    ltv: computeLtv(deal, dealMetrics),
    dscr: computeDscr(dealMetrics),
    debtYield: computeDebtYield(deal, dealMetrics),
    pricePerSqFt: computePricePerSqFt(deal),
    breakEvenOccupancy: computeBreakEvenOccupancy(deal, dealMetrics),
  };
}
