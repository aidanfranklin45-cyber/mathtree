import { describe, it, expect } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { proposeChanges } from './apply';
import { applyToForm, assetFromDocs, formAsInputs } from './wizardMap';

const box = (value: unknown) => ({ value, confidence: 1 });
const rentRoll = coerceIntake('rent_roll', {
  rentPeriod: box('monthly'),
  rows: [
    { unit: box('A'), tenantName: box('Acme Dental'), monthlyRent: box(2400), status: box('occupied'), leaseEndDate: box('2028-01-31') },
    { unit: box('B'), tenantName: box('Cafe Uno'), monthlyRent: box(1600), status: box('occupied') },
  ],
});
const om = coerceIntake('offering_memorandum', {
  address: box('128 N 2nd St'), city: box('Yakima'), state: box('WA'), zip: box('98901'), apn: box('18132412345'),
  assetClass: box('commercial'), squareFeet: box(8200), askingPrice: box(1250000), claimedNoi: box(99000),
});
const loan = coerceIntake('loan_terms', { loanAmount: box(900000), interestRatePercent: box(6.75), termYears: box(10), amortizationYears: box(25), rateType: box('fixed') });

describe('documents into the wizard form', () => {
  it('fills the form fields, folds the address, carries the tenant list, and never applies the broker claim', () => {
    const docs = [rentRoll, om, loan];
    expect(assetFromDocs(docs)).toBe('commercial');
    const form = { location: '', price: '1100000', commSqft: '', gla: '', rate: '', amort: '', maturity: '', financingType: 'fixed', leaseType: '' };
    const proposal = proposeChanges(docs, { asset_class: 'commercial', purchase_price: 1100000, inputs: formAsInputs(form, 'commercial') });
    const price = proposal.changes.find((c) => c.key === 'purchasePrice');
    expect(price).toBeUndefined(); // the broker's asking price is a claim, not an input
    const all = new Set(proposal.changes.map((c) => c.key));
    const fill = applyToForm({ form, asset: 'commercial', proposal, ticked: all });

    expect(fill.form.location).toBe('128 N 2nd St, Yakima, WA 98901');
    expect(fill.form.commSqft).toBe('8200');
    expect(fill.form.rate).toBe('6.75');
    expect(fill.form.amort).toBe('25');
    expect(fill.form.maturity).toBe('10'); // a 10-year term on a 25-year amortization is a balloon
    expect(fill.form.price).toBe('1100000'); // untouched
    expect(fill.form.commGrossRent).toBe('4000');
    expect((fill.extra.leases as any[]).map((l) => l.tenantName)).toEqual(['Acme Dental', 'Cafe Uno']);
    expect(fill.extra.primaryApn).toBe('18132412345');
    expect(fill.extra.loanAmount).toBe(900000);
  });

  it('applies only what is ticked', () => {
    const proposal = proposeChanges([loan], { asset_class: 'commercial', purchase_price: null, inputs: {} });
    const fill = applyToForm({ form: { rate: '', amort: '' }, asset: 'commercial', proposal, ticked: new Set(['interestRate']) });
    expect(fill.form.rate).toBe('6.75');
    expect(fill.form.amort).toBe('');
    expect(fill.applied).toBe(1);
  });
});
