/**
 * Documents into the new-project wizard. What the owner accepts from a read document is written into the wizard's own form fields (so
 * they see it in the steps they are about to go through and can change any of it); what the form has no field for (the tenant list,
 * parcel number, loan amount) is carried to creation and saved with the project. Nothing is invented: a figure the documents do not give
 * leaves its field as it was.
 */

import type { IntakeDocument } from './intake';
import { val } from './intake';
import type { Proposal } from './apply';
import { DEFAULT_CLOSING_WEEKS, seedFromAssumptions, type InputBasis, type UnderwritingAssumptions } from '@engine/underwritingAssumptions';

export type WizardAsset = 'single-family' | 'multi-unit' | 'commercial' | 'storage';
type Form = Record<string, string>;

const OM_ASSET: Record<string, WizardAsset> = { commercial: 'commercial', multi_family: 'multi-unit', residential: 'single-family', storage: 'storage' };

export const ASSET_LABEL: Record<WizardAsset, string> = { 'single-family': 'Single-family', 'multi-unit': 'Multi-unit', commercial: 'Commercial', storage: 'Storage' };

export interface DeducedAsset {
  asset: WizardAsset;
  /** One line on how it was decided, for the review. */
  why: string;
}

/**
 * The asset class the documents point to. A memorandum often states it outright; when it does not, plain facts decide: a unit mix or several
 * units is multi-unit, a single unit is a single-family home. Null when nothing points either way (the owner picks).
 */
export function deduceAsset(docs: IntakeDocument[]): DeducedAsset | null {
  for (const d of docs) if (d.documentType === 'offering_memorandum') {
    const c = val(d.assetClass);
    if (c && OM_ASSET[c]) {
      const ev = d.assetClass.evidence;
      return { asset: OM_ASSET[c], why: ev ? `From the offering memorandum: "${ev.replace(/\s+/g, ' ').slice(0, 80)}"` : 'Stated in the offering memorandum' };
    }
  }
  for (const d of docs) if (d.documentType === 'offering_memorandum') {
    const units = val(d.unitCount) ?? d.unitMix.reduce((s, r) => s + (val(r.unitCount) ?? 0), 0);
    if (d.unitMix.length > 0 || units >= 2) return { asset: 'multi-unit', why: `Deduced: the offering memorandum has a unit mix of ${units || d.unitMix.length} units` };
    if (units === 1) return { asset: 'single-family', why: 'Deduced: the offering memorandum describes a single unit' };
  }
  for (const d of docs) if (d.documentType === 'rent_roll') {
    const units = d.rows.filter((r) => val(r.unit) !== null || val(r.tenantName) !== null).length;
    if (units >= 2) return { asset: 'multi-unit', why: `Deduced: the rent roll lists ${units} units` };
  }
  return null;
}

/** The asset class the documents point to, when one can be told. */
export function assetFromDocs(docs: IntakeDocument[]): WizardAsset | null {
  return deduceAsset(docs)?.asset ?? null;
}

const SQFT_FIELD: Record<WizardAsset, string> = { 'single-family': 'sfrSqft', 'multi-unit': 'multiSqft', commercial: 'commSqft', storage: 'storageSqft' };
const UNIT_FIELD: Partial<Record<WizardAsset, string>> = { 'multi-unit': 'multiUnits', storage: 'storageUnits' };
const LEASE_TYPES = new Set(['NNN', 'Gross', 'Modified Gross', 'Absolute Net']);
const FINANCING = new Set(['fixed', 'arm', 'interest_only']);

const DIRECT: Record<string, string> = {
  purchasePrice: 'price', closingDate: 'closingDate', closingCosts: 'closing', downPaymentPercent: 'down', interestRate: 'rate',
  amortizationYears: 'amort', interestOnlyYears: 'ioYears', expenseRatio: 'opexRatio', vacancyRate: 'vacancy',
  annualTaxes: 'taxes', annualInsurance: 'insurance', annualMaintenance: 'maintenance', annualUtilities: 'utilities',
};

/** The wizard field each input is typed into, so a figure the owner supplies for something the documents lacked lands in the form. */
export const FORM_FIELD_FOR_KEY: Record<string, string> = {
  ...DIRECT,
  rentGrowth: 'rentGrowth', expenseGrowth: 'expenseGrowth', targetCapRate: 'exitCap', appreciationRate: 'apprec', sellingCostPercent: 'sellingCost',
  exitYear: 'exitYear', discountRate: 'discountRate', capexReserveAnnual: 'capexValue', loanMaturityYears: 'maturity',
  armInitialYears: 'armInitial', armAdjustmentRate: 'armRate', armRateCap: 'armCap', payrollMarketingPercent: 'payroll', managementFeePercent: 'managementFee',
};

/** Rent figures the form derives from its own rent fields: nothing to set separately. */
const DERIVED = new Set(['monthlyRent', 'grossRentAnnual', 'assetClass']);

/** The wizard keeps the monthly rent of the whole property in a field per asset class. */
function setGrossRent(form: Form, asset: WizardAsset, monthly: number): void {
  form.grossRent = numText(monthly);
  if (asset === 'commercial') { form.commGrossRent = numText(monthly); form.commAnnualRent = numText(Math.round(monthly * 12)); }
  else if (asset === 'multi-unit') form.multiGrossRent = numText(monthly);
  else if (asset === 'storage') form.storageGrossRent = numText(monthly);
  else form.sfrGrossRent = numText(monthly);
}

const has = (w: Form, k: string): boolean => (w[k] ?? '').trim() !== '';
const numText = (n: unknown): string => String(n);

/** What the form holds now, shaped like deal inputs, so the review can show what each document figure would replace. */
export function formAsInputs(w: Form, asset: WizardAsset): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const n = (k: string) => (has(w, k) && Number.isFinite(parseFloat(w[k])) ? parseFloat(w[k]) : undefined);
  const put = (key: string, v: unknown) => { if (v !== undefined && v !== '') out[key] = v; };
  for (const [key, field] of Object.entries(FORM_FIELD_FOR_KEY)) {
    if (key === 'capexReserveAnnual') continue; // below: dollars or a percent of income, by the form's own setting
    put(key, key === 'closingDate' ? (has(w, field) ? w[field] : undefined) : n(field));
  }
  put('address', has(w, 'location') ? w.location : undefined);
  put('squareFeet', n(SQFT_FIELD[asset]));
  const units = UNIT_FIELD[asset];
  if (units) put('unitCount', n(units));
  put('leaseType', has(w, 'leaseType') ? w.leaseType : undefined);
  if (w.manageProperty !== undefined && w.manageProperty !== '') out.manageProperty = w.manageProperty === 'true';
  put('grossRentPerMonth', n('grossRent'));
  put('monthlyRent', n('grossRent'));
  put('grossRentAnnual', n('grossRent') === undefined ? undefined : (n('grossRent') as number) * 12);
  put('monthlyRentPerUnit', asset === 'storage' ? n('storageRentPerUnit') : asset === 'multi-unit' ? n('multiRentPerUnit') : undefined);
  // The reserve is one field in the form; which input it is depends on whether it is dollars or a percent of income
  if (has(w, 'capexValue')) put(w.capexKind === 'percent' ? 'capexReservePercent' : 'capexReserveAnnual', n('capexValue'));
  return out;
}

export interface WizardFill {
  form: Form;
  /** Carried to creation: figures with no field in the wizard. */
  extra: Record<string, unknown>;
  /** Which accepted figures came from a document, for the project's record of where numbers came from. */
  basis: Record<string, InputBasis>;
  applied: number;
}

export function applyToForm(args: { form: Form; asset: WizardAsset; proposal: Proposal; ticked: Set<string> }): WizardFill {
  const { asset, proposal, ticked } = args;
  const form: Form = { ...args.form };
  const extra: Record<string, unknown> = {};
  const basis: Record<string, InputBasis> = {};
  // A row can stand for several inputs that are one figure (rent per month, per year, per unit): all of them are applied
  const accepted = proposal.changes.filter((c) => ticked.has(c.key)).flatMap((c) => [c, ...(c.also ?? []).map((a) => ({ ...c, key: a.key, value: a.value, also: undefined }))]);
  const byKey = new Map(accepted.map((c) => [c.key, c.value]));

  for (const c of accepted) {
    const v = c.value;
    if (proposal.patch.basis[c.key]) basis[c.key] = proposal.patch.basis[c.key];
    if (DIRECT[c.key]) { form[DIRECT[c.key]] = numText(v); continue; }
    if (DERIVED.has(c.key)) continue;
    switch (c.key) {
      case 'grossRentPerMonth':
        setGrossRent(form, asset, Number(v));
        break;
      case 'monthlyRentPerUnit':
        if (asset === 'multi-unit') form.multiRentPerUnit = numText(v);
        else if (asset === 'storage') form.storageRentPerUnit = numText(v);
        break;
      case 'capexReserveAnnual':
        form.capexValue = numText(v);
        form.capexKind = 'annual';
        break;
      case 'address': {
        const street = String(v);
        const city = byKey.get('city');
        const state = byKey.get('state');
        const zip = byKey.get('zip');
        const tail = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        form.location = tail ? `${street}, ${tail}` : street;
        break;
      }
      case 'squareFeet':
        form[SQFT_FIELD[asset]] = numText(v);
        form.gla = numText(v);
        break;
      case 'unitCount':
        if (UNIT_FIELD[asset]) form[UNIT_FIELD[asset] as string] = numText(v);
        else extra.unitCount = v;
        break;
      case 'leaseType':
        if (LEASE_TYPES.has(String(v))) form.leaseType = String(v); else extra.leaseType = v;
        break;
      case 'financingType':
        if (FINANCING.has(String(v))) form.financingType = String(v); else extra.financingType = v;
        break;
      case 'loanTermYears': {
        // The wizard's maturity is only for a balloon: a term that differs from the amortization
        const amort = byKey.get('amortizationYears') ?? parseFloat(form.amort);
        if (Number(v) !== Number(amort)) form.maturity = numText(v);
        break;
      }
      case 'leases': {
        const leases = v as Array<{ monthlyRent?: number }>;
        extra.leases = leases;
        const monthly = Math.round(leases.reduce((s, l) => s + (Number(l.monthlyRent) || 0), 0) * 100) / 100;
        if (monthly > 0) setGrossRent(form, asset, monthly);
        break;
      }
      case 'city': case 'state': case 'zip':
        // Folded into the address when there is one; otherwise kept on the project as they are
        if (!byKey.has('address')) extra[c.key] = v;
        break;
      default:
        extra[c.key] = v;
    }
  }
  return { form, extra, basis, applied: accepted.length };
}

/** The wizard field each figure of the owner's profile goes into. */
export const PROFILE_FIELD: Record<string, string> = {
  vacancyRate: 'vacancy', expenseRatio: 'opexRatio', rentGrowth: 'rentGrowth', expenseGrowth: 'expenseGrowth', exitYear: 'exitYear',
  discountRate: 'discountRate', targetCapRate: 'exitCap', appreciationRate: 'apprec', sellingCostPercent: 'sellingCost',
  closingCosts: 'closing', managementFeePercent: 'managementFee', capexReserveAnnual: 'capexValue', capexReservePercent: 'capexValue',
  payrollMarketingPercent: 'payroll', annualTaxes: 'taxes', annualInsurance: 'insurance', annualMaintenance: 'maintenance', annualUtilities: 'utilities',
};

const asNumber = (v: string | undefined): number => { const n = parseFloat(v ?? ''); return Number.isNaN(n) ? 0 : n; };

/**
 * The owner's investor-profile assumptions for every field of the form that is still blank, each with the reason the owner gave. Fields that
 * already hold something (a document's figure, or the owner's own entry) are never overwritten. No management fee unless a manager is hired.
 */
export function profileFill(args: {
  assumptions: UnderwritingAssumptions | null | undefined;
  discountRate?: number | null;
  exitYear?: number | null;
  base: Form;
  asset: WizardAsset;
  /** The county's assessed value, when a parcel has been looked up. */
  assessedValue?: number | null;
  /** Today, for the closing date (tests pass a fixed day). */
  now?: Date;
}): { patch: Form; basis: Record<string, InputBasis>; closing: { date: string; weeks: number } | null } {
  const { base, asset } = args;
  const units = asset === 'storage' ? Math.round(asNumber(base.storageUnits)) : asset === 'multi-unit' ? Math.round(asNumber(base.multiUnits)) : asset === 'single-family' ? 1 : 0;
  const sqft = asNumber(asset === 'storage' ? base.storageSqft : asset === 'multi-unit' ? base.multiSqft : asset === 'commercial' ? (base.commSqft || base.gla) : base.sfrSqft);
  const seeded = seedFromAssumptions(args.assumptions, {
    assetClass: asset,
    leaseType: base.leaseType,
    purchasePrice: asNumber(base.price) || null,
    unitCount: units > 0 ? units : null,
    squareFeet: sqft > 0 ? sqft : null,
    discountRate: args.discountRate ?? null,
    exitYear: args.exitYear ?? null,
    assessedValue: args.assessedValue ?? null,
  });
  const patch: Form = {};
  const basis: Record<string, InputBasis> = {};
  // In a normal year taxes, insurance, upkeep and utilities are part of the expense ratio. The separate amounts exist only for a property with no rent
  // or where tenants pay the building's costs, so they are filled only then (the form shows them only then too).
  const needsSeparateCosts = asset === 'commercial' || base.leaseType === 'NNN' || !(asNumber(base.grossRent) > 0);
  const SEPARATE = new Set(['annualTaxes', 'annualInsurance', 'annualMaintenance', 'annualUtilities']);
  for (const [key, value] of Object.entries(seeded.inputs)) {
    if (SEPARATE.has(key) && !needsSeparateCosts) continue;
    const field = PROFILE_FIELD[key];
    if (key === 'managementFeePercent' && base.manageProperty !== 'true') continue; // no manager, no fee
    if (!field || (base[field] ?? '').trim() !== '') continue;
    patch[field] = String(value);
    if (key === 'capexReserveAnnual') patch.capexKind = 'annual';
    if (key === 'capexReservePercent') patch.capexKind = 'percent';
    if (seeded.basis[key]) basis[key] = seeded.basis[key];
  }
  // The closing date is the owner's own setting: so many weeks after the project is created. Filled in as a date, unless one is already entered.
  let closing: { date: string; weeks: number } | null = null;
  if ((base.closingDate ?? '').trim() === '') {
    const weeks = args.assumptions?.assumedClosingWeeks ?? DEFAULT_CLOSING_WEEKS;
    const date = new Date((args.now ?? new Date()).getTime() + weeks * 7 * 86400000).toISOString().slice(0, 10);
    patch.closingDate = date;
    closing = { date, weeks };
  }
  return { patch, basis, closing };
}
