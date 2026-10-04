/**
 * Contract for the bankable PropertyFeatureVector library.
 * Pure functions for the numbers a commercial lender asks for.
 * Safety: Any value that cannot be computed is null with a one-line reason, never 0.
 */

export interface FeatureMetric {
  value: number | null;
  /** One plain-language explanation when null, or derivation note when computed. */
  reason?: string;
}

export interface TenantConcentration {
  /** Largest tenant's share of total contract rent (0 - 100%). */
  largestTenantShare: FeatureMetric;
  /** Herfindahl-Hirschman Index across all tenants (0 - 10,000). 10,000 = single tenant. */
  hhi: FeatureMetric;
}

export interface PropertyFeatureVector {
  dealId: string;
  asOf: string;
  /** Weighted Average Lease Term in years, weighted by contract rent. */
  walt: FeatureMetric;
  /** Tenant concentration metrics: largest tenant share and HHI. */
  tenantConcentration: TenantConcentration;
  /** Trailing 12-month collection rate: collected / billed (%). */
  trailingCollectionRate: FeatureMetric;
  /** Loan to Value ratio (0 - 100%). */
  ltv: FeatureMetric;
  /** Debt Service Coverage Ratio (headline first full year NOI / debt service). */
  dscr: FeatureMetric;
  /** Debt yield: first full year NOI / loan amount (%). */
  debtYield: FeatureMetric;
  /** Purchase price or current value per square foot ($/sqft). */
  pricePerSqFt: FeatureMetric;
  /** Break-even occupancy: (OpEx + Debt Service) / Potential Gross Rent (%). */
  breakEvenOccupancy: FeatureMetric;
}

export interface ComputeFeatureVectorArgs {
  deal: Record<string, any>;
  leases?: Record<string, any>[];
  payments?: Record<string, any>[];
  metrics?: Record<string, any> | null;
  asOf?: Date | string;
}
