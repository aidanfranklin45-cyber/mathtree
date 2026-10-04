/**
 * TEST FIXTURES ONLY. Not imported by the app.
 *
 * The engine no longer assumes any input: a deal that does not state them is refused (see `inputRequirements.ts`). Many tests were
 * written for behaviour other than defaults and built deals that left several inputs out, relying on the old engine to fill them in.
 * `withLegacyDefaults` states those inputs explicitly, with the values the old engine used to assume, so such a test keeps its meaning
 * and its numbers. A test about the requirements themselves must not use it (see `inputRequirements.test.ts`).
 *
 * Differences from the old engine that this cannot reproduce on purpose: a multi-unit property that was not managed used to be charged a
 * hidden 3% management fee, and management is now charged only when the owner states a fee.
 */

const has = (inputs: Record<string, any>, ...keys: string[]): boolean =>
  keys.some((k) => inputs[k] !== undefined && inputs[k] !== null && inputs[k] !== '' && Number.isFinite(Number(inputs[k])));
const num = (inputs: Record<string, any>, ...keys: string[]): number | undefined => {
  for (const k of keys) if (has(inputs, k)) return Number(inputs[k]);
  return undefined;
};

const asset = (raw: string): 'single-family' | 'multi-unit' | 'commercial' | 'storage' => {
  const s = String(raw ?? '').toLowerCase().replace(/[_\s]/g, '-');
  if (s === 'residential' || s === 'single-family') return 'single-family';
  if (s === 'multi-family' || s === 'multifamily' || s === 'multi-unit') return 'multi-unit';
  if (s === 'storage' || s === 'self-storage') return 'storage';
  return 'commercial';
};

export function withLegacyDefaults(assetClass: string, inputs: Record<string, any> = {}): Record<string, any> {
  const a = asset(assetClass);
  const o: Record<string, any> = { ...inputs };
  const set = (key: string, value: unknown, ...aliases: string[]) => { if (!has(o, key, ...aliases)) o[key] = value; };
  const hasLeases = Array.isArray(o.leases) && o.leases.length > 0;

  // The old engine started at July 2025 when no date was given, but only prorated that first year when leases were present
  if (!String(o.closingDate ?? '').trim()) o.closingDate = hasLeases ? '2025-07-01' : '2025-01-01';
  set('holdingPeriod', 10, 'exitYear', 'holdYears');
  set('discountRate', 8);
  set('sellingCostPercent', 0);
  set('vacancyRate', 0, 'vacancyRatePercent');
  set('expenseRatio', 0, 'operatingExpenseRatio');
  if (!hasLeases) set('rentGrowth', 0, 'rentGrowthPercent', 'annualRentGrowth');
  set('appreciationRate', 2);
  set('targetCapRate', 6.5, 'targetExitCapRate', 'exitCapRate');
  if (hasLeases) o.leases = o.leases.map((l: any) => (has(l ?? {}, 'escalationRate') ? l : { ...l, escalationRate: 3 }));

  // Financing: the old engine read loanTerm, then loanTermYears, then amortizationYears, then 30, all as the amortization
  set('downPaymentPercent', 0, 'loanAmount');
  set('interestRate', 0);
  if (!has(o, 'amortizationYears', 'loanTerm')) o.amortizationYears = num(o, 'loanTermYears') ?? 30;
  const amort = num(o, 'amortizationYears', 'loanTerm') as number;
  const hold = num(o, 'holdingPeriod', 'exitYear', 'holdYears') as number;
  if (!has(o, 'loanMaturityYears')) o.loanMaturityYears = Math.max(amort, hold);
  const rate = num(o, 'interestRate') as number;
  if (String(o.financingType ?? 'fixed') === 'arm') {
    set('armInitialYears', 5);
    set('armAdjustmentRate', rate + 1.5);
    set('armRateCap', rate + 4);
  }
  if (o.financingType === 'interest_only') set('interestOnlyYears', 3);

  // Reserves, management and payroll: the rules the old engine had built in, now stated
  const units = Math.max(1, parseInt(String(o.unitCount || o.numUnits || o.totalUnits || 0), 10) || 0);
  const isRawLand = /vacant|land|dirt|lot/i.test(o.facilityType || '') || /vacant|land/i.test(o.useCode || '');
  const gla = isRawLand ? 0 : (parseFloat(o.gla) || 15000);
  if (!has(o, 'capexReserveAnnual', 'capexReserve', 'capexReservePercent')) {
    if (a === 'multi-unit') o.capexReserveAnnual = units * 350;
    else if (a === 'storage') o.capexReservePercent = 3;
    else if (a === 'commercial') o.capexReserveAnnual = o.leaseType === 'NNN' ? 0 : gla * 1.5;
    else o.capexReserveAnnual = 0;
  }
  if (o.manageProperty && !has(o, 'managementFeePercent')) {
    o.managementFeePercent = a === 'single-family' ? 10 : a === 'multi-unit' ? (units <= 4 ? 9 : 5) : a === 'storage' ? 6 : (o.leaseType === 'NNN' ? 0 : 3.5);
  }
  if (a === 'storage') set('payrollMarketingPercent', o.isAutomated ? 4 : 13);
  if (a === 'commercial') {
    const assessed = parseFloat(o.totalAssessedValue) || parseFloat(o.combinedAssessedValue) || parseFloat(o.purchasePrice) || 0;
    set('annualTaxes', assessed * 0.011, 'propertyTaxes');
    set('annualInsurance', 600, 'insurance');
    set('annualMaintenance', 600, 'maintenance');
  }
  return o;
}

/** A deal's tax inputs as the old module assumed them (20% land, 24% rate). */
export function withLegacyTaxDefaults(inputs: Record<string, any> = {}): Record<string, any> {
  return { landPercent: 20, taxRate: 24, ...inputs };
}
