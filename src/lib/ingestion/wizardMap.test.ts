import { describe, it, expect } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { proposeChanges } from './apply';
import { applyToForm, assetFromDocs, deduceAsset, formAsInputs } from './wizardMap';

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

describe('an offering memorandum with a unit mix and an income table', () => {
  // The figures are those of a real 66-unit townhome memorandum
  const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
  const om = coerceIntake('offering_memorandum', {
    address: box('5101 W Powerhouse Rd'), city: box('Yakima'), state: box('WA'), zip: box('98908'), apn: box('181309-41011'),
    assetClass: box('multi_family'), askingPrice: box(18400000), squareFeet: box(83628), lotSqFt: box(386377), yearBuilt: box(2023), unitCount: box(66),
    claimedNoi: box(1093745), claimedCapRatePercent: box(5.94),
    unitMix: [
      { unitType: box('2 Bd / 2.5 Bth TH'), unitCount: box(30), avgSqFt: box(1266), currentMonthlyRent: box(1850), marketMonthlyRent: box(1900) },
      { unitType: box('3 Bd / 2.5 Bth TH'), unitCount: box(36), avgSqFt: box(1268), currentMonthlyRent: box(1950), marketMonthlyRent: box(1925) },
    ],
    income: [line('Gross Potential Rent', 'rent', 1450800), line('Vacancy', 'vacancy_credit_loss', -72540), line('RUBS', 'recoveries', 103932), line('Pet', 'other_income', 34686)],
    expenses: [
      line('Maint/Repair', 'repairs_maintenance', 33000), line('Payroll', 'payroll', 32000), line('Reserves', 'reserves_capex', 16500),
      line('RE Taxes', 'property_tax', 115670), line('Insurance', 'insurance', 19962), line('Utilities W/S/G/E', 'utilities', 73382), line('Management', 'management', 53522),
    ],
  });

  it('turns what the memorandum states into a filled form: price, units, rents, taxes, insurance, utilities, reserves, vacancy', () => {
    const form = { location: '', price: '', commSqft: '', gla: '', multiSqft: '', multiUnits: '', capexKind: 'annual', financingType: 'fixed' };
    const proposal = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: formAsInputs(form, 'multi-unit') });
    expect(assetFromDocs([om])).toBe('multi-unit');
    const fill = applyToForm({ form, asset: 'multi-unit', proposal, ticked: new Set(proposal.changes.map((c) => c.key)) });

    expect(fill.form.location).toBe('5101 W Powerhouse Rd, Yakima, WA 98908');
    expect(fill.form.price).toBe('18400000');
    expect(fill.form.multiUnits).toBe('66');
    expect(fill.form.multiSqft).toBe('83628');
    expect(fill.form.multiGrossRent).toBe('125700'); // 30 x 1,850 + 36 x 1,950
    expect(fill.form.multiRentPerUnit).toBe('1904.55');
    expect(fill.form.taxes).toBe('115670');
    expect(fill.form.insurance).toBe('19962');
    expect(fill.form.utilities).toBe('73382');
    expect(fill.form.maintenance).toBe('33000');
    expect(fill.form.capexValue).toBe('16500');
    expect(fill.form.vacancy).toBe('5');
    expect(Number(fill.form.opexRatio)).toBeGreaterThan(20);
    expect(fill.extra.yearBuilt).toBe(2023);
    expect(fill.extra.acres).toBe(8.87);
    expect(fill.extra.primaryApn).toBe('181309-41011');
    // the seller's NOI and cap rate are shown, never applied
    expect(Object.keys({ ...fill.form, ...fill.extra })).not.toContain('claimedNoi');
    expect(proposal.patch.claims.claimedNoi.value).toBe(1093745);
  });

  it('never replaces a price the owner already typed unless they tick it', () => {
    const proposal = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: 17000000, inputs: formAsInputs({ price: '17000000' }, 'multi-unit') });
    expect(proposal.changes.find((c) => c.key === 'purchasePrice')).toBeUndefined();
  });
});

describe('deducing the asset class', () => {
  const emptyOm = (extra: Record<string, unknown>) => coerceIntake('offering_memorandum', extra);

  it('uses what the memorandum says, with its evidence', () => {
    const d = deduceAsset([emptyOm({ assetClass: { value: 'multi_family', confidence: 0.8, evidence: 'Property Type Townhomes' } })]);
    expect(d?.asset).toBe('multi-unit');
    expect(d?.why).toContain('Townhomes');
  });

  it('decides from plain facts when the memorandum does not say', () => {
    expect(deduceAsset([emptyOm({ unitMix: [{ unitType: box('2 Bd'), unitCount: box(12), currentMonthlyRent: box(1500) }] })])?.asset).toBe('multi-unit');
    expect(deduceAsset([emptyOm({ unitCount: box(1) })])?.asset).toBe('single-family');
    expect(deduceAsset([emptyOm({ unitCount: box(40) })])?.asset).toBe('multi-unit');
    expect(deduceAsset([emptyOm({ address: box('1 Main St') })])).toBeNull(); // nothing points either way: the owner picks
  });

  it('puts the asset class first in the review of a new project, and not at all on an existing deal', () => {
    const om = emptyOm({ assetClass: box('multi_family'), unitCount: box(66) });
    const first = proposeChanges([om], { asset_class: 'commercial', purchase_price: null, inputs: {} }, { assetClass: true }).changes[0];
    expect(first).toMatchObject({ key: 'assetClass', proposed: 'Multi-unit', current: 'Commercial' });
    expect(proposeChanges([om], { asset_class: 'commercial', purchase_price: null, inputs: {} }).changes.some((c) => c.key === 'assetClass')).toBe(false);
  });
});
