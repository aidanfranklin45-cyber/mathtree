/**
 * Documents into the new-project wizard. What the owner accepts from a read document is written into the wizard's own form fields (so
 * they see it in the steps they are about to go through and can change any of it); what the form has no field for (the tenant list,
 * parcel number, loan amount) is carried to creation and saved with the project. Nothing is invented: a figure the documents do not give
 * leaves its field as it was.
 */

import type { IntakeDocument } from './intake';
import { val } from './intake';
import type { Proposal } from './apply';
import type { InputBasis } from '@engine/underwritingAssumptions';

export type WizardAsset = 'single-family' | 'multi-unit' | 'commercial' | 'storage';
type Form = Record<string, string>;

const OM_ASSET: Record<string, WizardAsset> = { commercial: 'commercial', multi_family: 'multi-unit', residential: 'single-family', storage: 'storage' };

/** The asset class an offering memorandum states, when one was read. */
export function assetFromDocs(docs: IntakeDocument[]): WizardAsset | null {
  for (const d of docs) if (d.documentType === 'offering_memorandum') {
    const c = val(d.assetClass);
    if (c && OM_ASSET[c]) return OM_ASSET[c];
  }
  return null;
}

const SQFT_FIELD: Record<WizardAsset, string> = { 'single-family': 'sfrSqft', 'multi-unit': 'multiSqft', commercial: 'commSqft', storage: 'storageSqft' };
const UNIT_FIELD: Partial<Record<WizardAsset, string>> = { 'multi-unit': 'multiUnits', storage: 'storageUnits' };
const LEASE_TYPES = new Set(['NNN', 'Gross', 'Modified Gross', 'Absolute Net']);
const FINANCING = new Set(['fixed', 'arm', 'interest_only']);

const DIRECT: Record<string, string> = {
  purchasePrice: 'price', closingDate: 'closingDate', closingCosts: 'closing', downPaymentPercent: 'down', interestRate: 'rate',
  amortizationYears: 'amort', interestOnlyYears: 'ioYears', expenseRatio: 'opexRatio', vacancyRate: 'vacancy',
};

const has = (w: Form, k: string): boolean => (w[k] ?? '').trim() !== '';
const numText = (n: unknown): string => String(n);

/** What the form holds now, shaped like deal inputs, so the review can show what each document figure would replace. */
export function formAsInputs(w: Form, asset: WizardAsset): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const n = (k: string) => (has(w, k) && Number.isFinite(parseFloat(w[k])) ? parseFloat(w[k]) : undefined);
  const put = (key: string, v: unknown) => { if (v !== undefined && v !== '') out[key] = v; };
  for (const [key, field] of Object.entries(DIRECT)) put(key, key === 'closingDate' ? (has(w, field) ? w[field] : undefined) : n(field));
  put('address', has(w, 'location') ? w.location : undefined);
  put('squareFeet', n(SQFT_FIELD[asset]));
  const units = UNIT_FIELD[asset];
  if (units) put('unitCount', n(units));
  put('leaseType', has(w, 'leaseType') ? w.leaseType : undefined);
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
  const accepted = proposal.changes.filter((c) => ticked.has(c.key));
  const byKey = new Map(accepted.map((c) => [c.key, c.value]));

  for (const c of accepted) {
    const v = c.value;
    if (proposal.patch.basis[c.key]) basis[c.key] = proposal.patch.basis[c.key];
    if (DIRECT[c.key]) { form[DIRECT[c.key]] = numText(v); continue; }
    switch (c.key) {
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
        if (monthly > 0) {
          form.grossRent = numText(monthly);
          if (asset === 'commercial') { form.commGrossRent = numText(monthly); form.commAnnualRent = numText(Math.round(monthly * 12)); }
          else if (asset === 'multi-unit') form.multiGrossRent = numText(monthly);
          else if (asset === 'storage') form.storageGrossRent = numText(monthly);
          else form.sfrGrossRent = numText(monthly);
        }
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
