// supabase/functions/_shared/underwritingAssumptions.ts
//
// The owner's underwriting assumptions: the one place defaults live. The engine assumes nothing (see inputRequirements.ts); a new deal
// is seeded from these, copied onto the deal as plain inputs, and each copied figure carries its source and the owner's rationale so
// it can be defended to a lender. Nothing here has a built-in value: an assumption the owner has not set stays blank and the deal
// reports it as missing.
//
// Pure (no imports), shared by the browser and the edge functions.

export type AssetKey = 'single-family' | 'multi-unit' | 'commercial' | 'storage';
export const ASSET_KEYS: AssetKey[] = ['single-family', 'multi-unit', 'commercial', 'storage'];

/** The standard underwriting convention for a pipeline deal with no closing date: it closes this many weeks after the project is created. The owner can set another number in the profile. */
export const DEFAULT_CLOSING_WEEKS = 6;

export type CapexBasis = 'perUnit' | 'perSqFt' | 'percentOfIncome' | 'percentOfValue';

/** Every assumption the owner can set for an asset class. All optional; none has a built-in value. */
export interface AssetAssumptions {
  vacancyRate?: number; // %
  /** Operating expenses as a % of gross rent. For commercial this is the gross / modified-gross lease ratio. */
  expenseRatio?: number;
  /** Commercial only: the ratio when tenants pay the building's costs (NNN). */
  expenseRatioNNN?: number;
  rentGrowth?: number; // % a year
  expenseGrowth?: number; // % a year
  holdingPeriod?: number; // years
  /** Commercial and storage: valued at exit by capitalising income. */
  exitCapRate?: number;
  /** The other asset classes: valued by appreciation. */
  appreciationRate?: number;
  sellingCostPercent?: number; // % of sale price
  closingCostPercent?: number; // % of purchase price
  managementFeePercent?: number; // % of collected income, applied when the owner has a manager
  /** Whether the owner hires a property manager for this kind of property. Their decision: a new property starts with it, and may differ. */
  usesPropertyManager?: boolean;
  capexBasis?: CapexBasis;
  capexValue?: number; // $ per unit a year, $ per sq ft a year, % of income, or % of value, per capexBasis
  /** What the building costs to insure, as a % of its value (the purchase price, else the county assessed value) a year. */
  insuranceRatePercent?: number;
  /** What it costs to keep up, as a % of its value a year. This is also what you carry while it is vacant. */
  maintenanceRatePercent?: number;
  /** Power, water, sewer and garbage, in dollars per square foot a year. Carried while a space is vacant or where tenants reimburse the cost. */
  utilitiesPerSqFt?: number;
  payrollMarketingPercent?: number; // storage only, % of gross income
  /** The owner's reason for each figure, shown with it on every deal it seeds. */
  rationale?: Partial<Record<AssumptionField, string>>;
}

export interface UnderwritingAssumptions {
  assets: Partial<Record<AssetKey, AssetAssumptions>>;
  /** The owner's marginal income tax rate (%), used by the tax tab. */
  taxRate?: number;
  taxRateRationale?: string;
  /**
   * Property tax as a % of the county's assessed value, from the levy rates your county publishes for the tax code area. County GIS
   * records give the assessed value but not the bill, so a vacant or net-leased property's tax is estimated as value x this rate.
   */
  propertyTaxRatePercent?: number;
  propertyTaxRateRationale?: string;
  /** A pipeline deal with no closing date is assumed to close this many weeks after the day the analysis is run. */
  assumedClosingWeeks?: number;
}

export type AssumptionField = Exclude<keyof AssetAssumptions, 'rationale' | 'capexBasis' | 'usesPropertyManager'>;

export interface FieldSpec {
  key: AssumptionField;
  label: string;
  unit: '%' | 'years' | '$';
  min: number;
  max: number;
  assets: AssetKey[];
  hint: string;
}

const ALL: AssetKey[] = ASSET_KEYS;

/** What each assumption means, its allowed range (for catching typos, not for judging them) and where it applies. */
export const FIELD_SPECS: FieldSpec[] = [
  { key: 'vacancyRate', label: 'Vacancy and credit loss', unit: '%', min: 0, max: 60, assets: ALL, hint: 'Share of rent not collected. Anchor it to the submarket and your own history.' },
  { key: 'expenseRatio', label: 'Operating expense ratio', unit: '%', min: 0, max: 100, assets: ALL, hint: 'Operating expenses as a share of gross rent, before vacancy. For commercial, the gross-lease ratio.' },
  { key: 'expenseRatioNNN', label: 'Operating expense ratio, NNN leases', unit: '%', min: 0, max: 100, assets: ['commercial'], hint: 'What the landlord still pays when tenants cover taxes, insurance and upkeep.' },
  { key: 'rentGrowth', label: 'Rent growth', unit: '%', min: -20, max: 30, assets: ALL, hint: 'Yearly growth of rent that is not fixed by a lease.' },
  { key: 'expenseGrowth', label: 'Expense growth', unit: '%', min: -20, max: 30, assets: ALL, hint: 'Yearly growth of operating expenses. Leave blank to have expenses follow income at the ratio.' },
  { key: 'holdingPeriod', label: 'Hold period', unit: 'years', min: 1, max: 30, assets: ALL, hint: 'Years until the assumed sale. A loan cannot mature before it.' },
  { key: 'exitCapRate', label: 'Exit cap rate', unit: '%', min: 0.5, max: 25, assets: ['commercial', 'storage'], hint: 'The cap rate the property is assumed to sell at.' },
  { key: 'appreciationRate', label: 'Appreciation', unit: '%', min: -20, max: 30, assets: ALL, hint: 'Yearly growth in value (used for what the property is worth along the way, and for the sale value of residential).' },
  { key: 'sellingCostPercent', label: 'Selling costs (only if you plan to sell)', unit: '%', min: 0, max: 20, assets: ALL, hint: 'Brokerage and closing costs at sale, as a share of the sale price. Leave at 0 if you plan to hold or refinance.' },
  { key: 'closingCostPercent', label: 'Buyer closing costs', unit: '%', min: 0, max: 20, assets: ALL, hint: 'As a share of the purchase price, until a lender quote or settlement statement replaces it.' },
  { key: 'managementFeePercent', label: 'Management fee', unit: '%', min: 0, max: 30, assets: ALL, hint: 'Share of collected income, charged only on deals where you use a manager.' },
  { key: 'insuranceRatePercent', label: 'Insurance', unit: '%', min: 0, max: 5, assets: ALL, hint: 'A share of value a year (purchase price, else assessed value), until a quote replaces it. In a normal year insurance is part of your expense ratio; this amount is used for a year with no rent and for vacant months.' },
  { key: 'maintenanceRatePercent', label: 'Maintenance and upkeep', unit: '%', min: 0, max: 10, assets: ALL, hint: 'A share of value a year. In a normal year upkeep is part of your expense ratio; this amount is used for a year with no rent, for vacant months, and where tenants pay the costs.' },
  { key: 'utilitiesPerSqFt', label: 'Utilities: power, water, sewer, garbage', unit: '$', min: 0, max: 50, assets: ALL, hint: 'Dollars per square foot a year, scaling with the size of the building. In a normal year utilities are part of your expense ratio; this amount is used for a year with no rent, for vacant months, and where tenants reimburse the cost.' },
  { key: 'capexValue', label: 'Replacement reserve', unit: '$', min: 0, max: 1_000_000, assets: ALL, hint: 'Amount per the basis chosen beside it.' },
  { key: 'payrollMarketingPercent', label: 'Payroll and marketing', unit: '%', min: 0, max: 60, assets: ['storage'], hint: 'On-site payroll and marketing as a share of gross income.' },
];

const SPEC_BY_KEY: Record<string, FieldSpec> = Object.fromEntries(FIELD_SPECS.map((s) => [s.key, s]));

const finite = (v: unknown): number | undefined => {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const text = (v: unknown, max = 500): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : undefined;
};

/** Cleans whatever was stored or posted. Drops anything that is not a number in range; never fills a gap. */
export function sanitizeAssumptions(raw: unknown): UnderwritingAssumptions {
  const out: UnderwritingAssumptions = { assets: {} };
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const taxRate = finite(r.taxRate);
  if (taxRate !== undefined && taxRate >= 0 && taxRate <= 70) out.taxRate = taxRate;
  const taxWhy = text(r.taxRateRationale);
  if (taxWhy) out.taxRateRationale = taxWhy;
  const propTax = finite(r.propertyTaxRatePercent);
  if (propTax !== undefined && propTax >= 0 && propTax <= 10) out.propertyTaxRatePercent = propTax;
  const weeks = finite(r.assumedClosingWeeks);
  if (weeks !== undefined && weeks >= 0 && weeks <= 52) out.assumedClosingWeeks = Math.round(weeks);
  const propTaxWhy = text(r.propertyTaxRateRationale);
  if (propTaxWhy && out.propertyTaxRatePercent !== undefined) out.propertyTaxRateRationale = propTaxWhy;

  const assets = (r.assets && typeof r.assets === 'object' ? r.assets : {}) as Record<string, any>;
  for (const asset of ASSET_KEYS) {
    const a = assets[asset];
    if (!a || typeof a !== 'object') continue;
    const clean: AssetAssumptions = {};
    for (const spec of FIELD_SPECS) {
      if (!spec.assets.includes(asset)) continue;
      const n = finite(a[spec.key]);
      if (n !== undefined && n >= spec.min && n <= spec.max) (clean as Record<string, unknown>)[spec.key] = n;
    }
    if (a.capexBasis === 'perUnit' || a.capexBasis === 'perSqFt' || a.capexBasis === 'percentOfIncome' || a.capexBasis === 'percentOfValue') clean.capexBasis = a.capexBasis;
    if (clean.capexValue !== undefined && !clean.capexBasis) delete clean.capexValue; // an amount with no basis means nothing
    if (typeof a.usesPropertyManager === 'boolean') clean.usesPropertyManager = a.usesPropertyManager;
    const why: Partial<Record<AssumptionField, string>> = {};
    const rawWhy = (a.rationale && typeof a.rationale === 'object' ? a.rationale : {}) as Record<string, unknown>;
    for (const spec of FIELD_SPECS) {
      const t = text(rawWhy[spec.key]);
      if (t && (clean as Record<string, unknown>)[spec.key] !== undefined) why[spec.key] = t;
    }
    if (Object.keys(why).length) clean.rationale = why;
    if (Object.keys(clean).length) out.assets[asset] = clean;
  }
  return out;
}

export function normAssetKey(raw: unknown): AssetKey {
  const s = String(raw ?? '').toLowerCase().replace(/[_\s]/g, '-');
  if (s === 'residential' || s === 'single-family') return 'single-family';
  if (s === 'multi-family' || s === 'multifamily' || s === 'multi-unit') return 'multi-unit';
  if (s === 'storage' || s === 'self-storage') return 'storage';
  return 'commercial';
}

/** Whether the owner hires a property manager for this kind of property (null when they have not said), and the fee they underwrite. */
export function managerChoice(assumptions: UnderwritingAssumptions | null | undefined, assetClass: unknown): { uses: boolean | null; fee?: number } {
  const a = assumptions?.assets?.[normAssetKey(assetClass)];
  return { uses: typeof a?.usesPropertyManager === 'boolean' ? a.usesPropertyManager : null, fee: a?.managementFeePercent };
}

/** Where a figure on a deal came from. Stored on the deal as `assumptionBasis` so a lender can be shown the reason for each number. */
export interface InputBasis {
  source: 'profile' | 'owner' | 'county_record' | 'document';
  label: string;
  rationale?: string;
  /** The value this basis describes. If the deal's figure later differs, the owner changed it and the basis is no longer this one. */
  value?: number;
}

export interface SeededInputs {
  /** Engine input keys and values to copy onto the deal. */
  inputs: Record<string, number>;
  basis: Record<string, InputBasis>;
  /** Engine input keys the owner's assumptions could not supply (nothing set, or something needed was not yet known). */
  unfilled: string[];
}

export interface SeedContext {
  assetClass: string;
  leaseType?: string | null;
  purchasePrice?: number | null;
  unitCount?: number | null;
  squareFeet?: number | null;
  /** The profile's own hurdle rate and hold, which predate this module and live beside it. */
  discountRate?: number | null;
  /** Accepted: set on the deal as the hold period. */
  exitYear?: number | null;
  /** The county's assessed (or taxable) value for the property, when the county record gives one. */
  assessedValue?: number | null;
}

/**
 * Seeds a deal's inputs from the owner's assumptions. Returns only what the owner has actually set, each with its rationale; the rest
 * is `unfilled` so the screen can ask for it. Never invents or averages anything.
 */
export function seedFromAssumptions(assumptions: UnderwritingAssumptions | null | undefined, ctx: SeedContext): SeededInputs {
  const asset = normAssetKey(ctx.assetClass);
  const a: AssetAssumptions = assumptions?.assets?.[asset] ?? {};
  const inputs: Record<string, number> = {};
  const basis: Record<string, InputBasis> = {};
  const unfilled: string[] = [];

  const put = (key: string, value: number | undefined, label: string, why?: string, extraKeys: string[] = [], source: InputBasis['source'] = 'profile') => {
    if (value === undefined) { unfilled.push(key); return; }
    for (const k of [key, ...extraKeys]) {
      inputs[k] = value;
      basis[k] = { source, label, value, ...(why ? { rationale: why } : {}) };
    }
  };
  const why = (f: AssumptionField) => a.rationale?.[f];
  // The value a rate is applied to: what is being paid, else the county's assessed value
  const valueBase = ctx.purchasePrice && ctx.purchasePrice > 0 ? ctx.purchasePrice : (ctx.assessedValue && ctx.assessedValue > 0 ? ctx.assessedValue : undefined);
  const valueLabel = ctx.purchasePrice && ctx.purchasePrice > 0 ? 'purchase price' : 'county assessed value';

  put('vacancyRate', a.vacancyRate, 'Vacancy', why('vacancyRate'));
  const nnn = String(ctx.leaseType ?? '') === 'NNN';
  if (asset === 'commercial' && nnn) put('expenseRatio', a.expenseRatioNNN, 'Expense ratio (NNN)', why('expenseRatioNNN'), ['operatingExpenseRatio']);
  else put('expenseRatio', a.expenseRatio, 'Expense ratio', why('expenseRatio'), ['operatingExpenseRatio']);
  put('rentGrowth', a.rentGrowth, 'Rent growth', why('rentGrowth'), ['annualRentGrowth']);
  if (a.expenseGrowth !== undefined) put('expenseGrowth', a.expenseGrowth, 'Expense growth', why('expenseGrowth'), ['expenseInflation']);
  put('exitYear', a.holdingPeriod ?? ctx.exitYear ?? undefined, 'Hold period', a.holdingPeriod !== undefined ? why('holdingPeriod') : undefined);
  put('discountRate', ctx.discountRate ?? undefined, 'Discount rate');
  if (asset === 'commercial' || asset === 'storage') put('targetCapRate', a.exitCapRate, 'Exit cap rate', why('exitCapRate'), ['targetExitCapRate']);
  else put('appreciationRate', a.appreciationRate, 'Appreciation', why('appreciationRate'));
  // Appreciation also drives what an income-valued property is worth along the way, so it follows the profile for every asset class
  if ((asset === 'commercial' || asset === 'storage') && a.appreciationRate !== undefined) put('appreciationRate', a.appreciationRate, 'Appreciation', why('appreciationRate'));
  put('sellingCostPercent', a.sellingCostPercent, 'Selling costs', why('sellingCostPercent'));
  put('managementFeePercent', a.managementFeePercent, 'Management fee', why('managementFeePercent'));
  if (asset === 'storage') put('payrollMarketingPercent', a.payrollMarketingPercent, 'Payroll and marketing', why('payrollMarketingPercent'));

  if (a.closingCostPercent !== undefined && ctx.purchasePrice && ctx.purchasePrice > 0) {
    put('closingCosts', Math.round(ctx.purchasePrice * a.closingCostPercent) / 100, `Closing costs (${a.closingCostPercent}% of price)`, why('closingCostPercent'));
  } else unfilled.push('closingCosts');

  // Reserves: a basis and an amount. Per unit and per square foot need the deal's own count or size, which may not be known yet.
  if (a.capexValue !== undefined && a.capexBasis) {
    if (a.capexBasis === 'percentOfIncome') put('capexReservePercent', a.capexValue, `Reserve (${a.capexValue}% of income)`, why('capexValue'));
    else if (a.capexBasis === 'perUnit' && ctx.unitCount && ctx.unitCount > 0) put('capexReserveAnnual', Math.round(a.capexValue * ctx.unitCount * 100) / 100, `Reserve ($${a.capexValue} a unit x ${ctx.unitCount} units)`, why('capexValue'));
    else if (a.capexBasis === 'perSqFt' && ctx.squareFeet && ctx.squareFeet > 0) put('capexReserveAnnual', Math.round(a.capexValue * ctx.squareFeet * 100) / 100, `Reserve ($${a.capexValue} a sq ft x ${Math.round(ctx.squareFeet).toLocaleString()} sq ft)`, why('capexValue'));
    else if (a.capexBasis === 'percentOfValue' && valueBase) put('capexReserveAnnual', Math.round(valueBase * a.capexValue) / 100, `Reserve (${a.capexValue}% of value $${Math.round(valueBase).toLocaleString()})`, why('capexValue'));
    else unfilled.push('capexReserveAnnual');
  } else unfilled.push('capexReserveAnnual');

  // What it costs to carry: insurance and upkeep as rates on value
  if (a.insuranceRatePercent !== undefined && valueBase) put('annualInsurance', Math.round(valueBase * a.insuranceRatePercent) / 100, `Insurance (${a.insuranceRatePercent}% of ${valueLabel} $${Math.round(valueBase).toLocaleString()})`, why('insuranceRatePercent'));
  else unfilled.push('annualInsurance');
  if (a.maintenanceRatePercent !== undefined && valueBase) put('annualMaintenance', Math.round(valueBase * a.maintenanceRatePercent) / 100, `Maintenance (${a.maintenanceRatePercent}% of ${valueLabel} $${Math.round(valueBase).toLocaleString()})`, why('maintenanceRatePercent'));
  else unfilled.push('annualMaintenance');
  // Utilities scale with the size of the building, so they need its square footage
  if (a.utilitiesPerSqFt !== undefined && ctx.squareFeet && ctx.squareFeet > 0) put('annualUtilities', Math.round(a.utilitiesPerSqFt * ctx.squareFeet * 100) / 100, `Utilities ($${a.utilitiesPerSqFt} a sq ft x ${Math.round(ctx.squareFeet).toLocaleString()} sq ft)`, why('utilitiesPerSqFt'));
  else unfilled.push('annualUtilities');

  // Property tax: the county's assessed value times the owner's own rate for that tax code area. Neither alone is a tax bill.
  const rate = assumptions?.propertyTaxRatePercent;
  if (rate !== undefined && ctx.assessedValue && ctx.assessedValue > 0) {
    put('annualTaxes', Math.round((ctx.assessedValue * rate) / 100), `Property tax (${rate}% of county assessed value $${Math.round(ctx.assessedValue).toLocaleString()})`, assumptions?.propertyTaxRateRationale, [], 'county_record');
  } else if (rate !== undefined && ctx.purchasePrice && ctx.purchasePrice > 0) {
    // No county value yet: taxes follow market value, so the price is the best available stand-in, and the basis says so
    put('annualTaxes', Math.round((ctx.purchasePrice * rate) / 100), `Property tax (${rate}% of purchase price $${Math.round(ctx.purchasePrice).toLocaleString()}; no county assessed value)`, assumptions?.propertyTaxRateRationale);
  } else unfilled.push('annualTaxes');

  if (assumptions?.taxRate !== undefined) put('taxRate', assumptions.taxRate, 'Marginal tax rate', assumptions.taxRateRationale);

  return { inputs, basis, unfilled };
}

/**
 * Conventional starting points for every assumption, so a new profile is not blank. They apply until the owner saves their own, and each
 * is labelled as a convention, not a sourced market figure. They are meant to be identifiable and explainable, not exhaustive: a
 * lender can be told "this is a common underwriting convention, and here is where I changed it for this market".
 */
const CONVENTION = 'Common underwriting convention';

interface Row {
  vacancyRate: number;
  expenseRatio: number;
  expenseRatioNNN?: number;
  rentGrowth: number;
  expenseGrowth: number;
  exitCapRate?: number;
  appreciationRate?: number;
  sellingCostPercent: number;
  managementFeePercent: number;
  payrollMarketingPercent?: number;
  capexBasis: CapexBasis;
  capexValue: number;
  utilitiesPerSqFt: number;
}

const STARTING_POINTS: Record<AssetKey, Row> = {
  'single-family': { vacancyRate: 5, expenseRatio: 35, rentGrowth: 3, expenseGrowth: 3, appreciationRate: 3, sellingCostPercent: 0, managementFeePercent: 8, capexBasis: 'perUnit', capexValue: 300, utilitiesPerSqFt: 1.2 },
  'multi-unit': { vacancyRate: 5, expenseRatio: 40, rentGrowth: 3, expenseGrowth: 3, appreciationRate: 3, sellingCostPercent: 0, managementFeePercent: 6, capexBasis: 'perUnit', capexValue: 300, utilitiesPerSqFt: 0.8 },
  commercial: { vacancyRate: 6, expenseRatio: 35, expenseRatioNNN: 10, rentGrowth: 3, expenseGrowth: 3, appreciationRate: 3, exitCapRate: 7, sellingCostPercent: 0, managementFeePercent: 4, capexBasis: 'perSqFt', capexValue: 0.25, utilitiesPerSqFt: 0.75 },
  storage: { vacancyRate: 10, expenseRatio: 35, rentGrowth: 3, expenseGrowth: 3, appreciationRate: 3, exitCapRate: 6.5, sellingCostPercent: 0, managementFeePercent: 6, payrollMarketingPercent: 8, capexBasis: 'percentOfIncome', capexValue: 3, utilitiesPerSqFt: 0.5 },
};

export function suggestedStartingPoints(current: UnderwritingAssumptions | null | undefined): UnderwritingAssumptions {
  const base = sanitizeAssumptions(current);
  const out: UnderwritingAssumptions = { ...base, assets: { ...base.assets } };
  // A typical purchase takes about six weeks from agreement to closing; used only for a deal with no closing date yet
  if (out.assumedClosingWeeks === undefined) out.assumedClosingWeeks = DEFAULT_CLOSING_WEEKS;
  if (out.propertyTaxRatePercent === undefined) {
    out.propertyTaxRatePercent = 1;
    out.propertyTaxRateRationale = 'Washington effective rates run about 0.8% to 1.1% of assessed value; adjust to your tax code area';
  }
  for (const asset of ASSET_KEYS) {
    const a: AssetAssumptions = { ...(out.assets[asset] ?? {}) };
    const why: Partial<Record<AssumptionField, string>> = { ...(a.rationale ?? {}) };
    const row = STARTING_POINTS[asset];
    const fill = <K extends AssumptionField>(key: K, value: number | undefined, note: string = CONVENTION) => {
      if (value === undefined || (a as Record<string, unknown>)[key] !== undefined) return;
      (a as Record<string, unknown>)[key] = value;
      why[key] = note;
    };
    fill('vacancyRate', row.vacancyRate);
    fill('expenseRatio', row.expenseRatio, asset === 'commercial' ? 'Common underwriting convention for gross and modified-gross leases' : CONVENTION);
    fill('expenseRatioNNN', row.expenseRatioNNN, 'What the landlord still pays under a triple-net lease');
    fill('rentGrowth', row.rentGrowth);
    fill('expenseGrowth', row.expenseGrowth);
    fill('exitCapRate', row.exitCapRate, 'Set near market cap rates for the type; adjust per property');
    fill('appreciationRate', row.appreciationRate);
    fill('sellingCostPercent', row.sellingCostPercent, 'Assumes you hold or refinance, not sell; enter a percent if you plan to sell');
    fill('closingCostPercent', 2, 'Typical buyer closing costs');
    fill('managementFeePercent', row.managementFeePercent, 'Typical property management fee');
    fill('payrollMarketingPercent', row.payrollMarketingPercent);
    fill('insuranceRatePercent', 0.35, 'Roughly 0.3% to 0.5% of value a year; replace with a quote');
    fill('maintenanceRatePercent', 0.5, 'Upkeep carried when vacant or tenants pay costs');
    fill('utilitiesPerSqFt', row.utilitiesPerSqFt, 'Rough power, water, sewer and garbage for the size; replace with local rates');
    if (a.capexValue === undefined) { a.capexBasis = row.capexBasis; a.capexValue = row.capexValue; why.capexValue = 'Typical replacement reserve'; }
    a.rationale = why;
    out.assets[asset] = a;
  }
  return out;
}

/** The inputs whose origin a lender may ask about, and what to call each. */
export const TRACKED_INPUTS: Record<string, string> = {
  vacancyRate: 'Vacancy',
  expenseRatio: 'Expense ratio',
  rentGrowth: 'Rent growth',
  expenseGrowth: 'Expense growth',
  exitYear: 'Hold period',
  discountRate: 'Discount rate',
  targetCapRate: 'Exit cap rate',
  appreciationRate: 'Appreciation',
  sellingCostPercent: 'Selling costs',
  closingCosts: 'Closing costs',
  managementFeePercent: 'Management fee',
  capexReserveAnnual: 'Replacement reserve',
  capexReservePercent: 'Replacement reserve',
  payrollMarketingPercent: 'Payroll and marketing',
  landPercent: 'Land share of price',
  taxRate: 'Marginal tax rate',
  annualTaxes: 'Property taxes',
  annualInsurance: 'Insurance',
  annualMaintenance: 'Maintenance',
  annualUtilities: 'Utilities',
};

/**
 * Brings a deal's record of where its numbers came from in line with the numbers it now has. A figure still equal to the value a basis
 * describes keeps that basis (profile, county record, document); one the owner has changed becomes the owner's own, with no reason until
 * they write one. Only inputs that are present get a basis; nothing is invented.
 */
export function reconcileBasis(prev: Record<string, InputBasis> | null | undefined, inputs: Record<string, any>): Record<string, InputBasis> {
  const out: Record<string, InputBasis> = {};
  for (const [key, label] of Object.entries(TRACKED_INPUTS)) {
    const raw = inputs[key];
    const value = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(value)) continue;
    const before = prev?.[key];
    if (before && before.value === value) out[key] = before;
    else out[key] = { source: 'owner', label: before?.label ?? label, value };
  }
  return out;
}

export { SPEC_BY_KEY };
