import { describe, it, expect } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { applyChoices, assumptionText, attachVariances, buildApplication, formatValue, proposeChanges } from './apply';
import { validateIntake } from './validate';
import { applyToForm, assetFromDocs, deduceAsset, FORM_FIELD_FOR_KEY, formAsInputs } from './wizardMap';
import { missingInputsFor } from '../engine/compute';
import { openQuestions } from './openQuestions';
import { managerChoice, sanitizeAssumptions } from '@engine/underwritingAssumptions';

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
    // taxes, insurance, utilities and upkeep live inside the one expense ratio: they are not copied into separate fields
    for (const f of ['taxes', 'insurance', 'utilities', 'maintenance']) expect(fill.form[f]).toBeUndefined();
    for (const k of ['annualTaxes', 'annualInsurance', 'annualUtilities', 'annualMaintenance']) expect(fill.extra[k]).toBeUndefined();
    expect(fill.form.capexValue).toBe('16500');
    expect(fill.form.vacancy).toBe('5');
    expect(Number(fill.form.opexRatio)).toBeCloseTo(11.72, 2); // (274,014 of costs less 103,932 reimbursed) / 1,450,800 of rent; management and reserves left out
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

describe('a memorandum whose unit mix is only a chart (no printed table)', () => {
  const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
  const om = coerceIntake('offering_memorandum', {
    address: box('5101 W Powerhouse Rd'), assetClass: box('multi_family'), askingPrice: box(18400000), squareFeet: box(83628), yearBuilt: box(2023), unitCount: box(66),
    unitMix: [],
    income: [line('Gross Potential Rent', 'rent', 1450800), line('Vacancy', 'vacancy_credit_loss', -72540), line('RUBS', 'recoveries', 103932)],
    expenses: [line('RE Taxes', 'property_tax', 115670), line('Reserves', 'reserves_capex', 16500), line('Management', 'management', 53522)],
  });

  it('takes the in-place rent from the gross potential rent in the income table', () => {
    const p = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    expect(p.patch.patch.grossRentPerMonth).toBe(120900); // 1,450,800 / 12
    expect(p.patch.patch.monthlyRentPerUnit).toBe(1831.82); // about $1,832 a unit, as the memorandum says
    expect(p.patch.provenance.grossRentPerMonth.how).toContain('gross potential rent');
  });

  it('on a second read of the same document, says what is already filled instead of silently showing less', () => {
    const first = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    const fill = applyToForm({ form: { financingType: 'fixed', capexKind: 'annual' }, asset: 'multi-unit', proposal: first, ticked: new Set(first.changes.map((c) => c.key)) });
    const again = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: Number(fill.form.price), inputs: formAsInputs(fill.form, 'multi-unit') });
    const keys = again.changes.map((c) => c.key);
    for (const k of ['purchasePrice', 'unitCount', 'grossRentPerMonth', 'annualTaxes', 'capexReserveAnnual']) expect(keys).not.toContain(k);
    const said = again.unchanged.map((u) => u.label).join(' | ');
    expect(said).toContain('Purchase price');
    expect(said).toContain('Unit count');
    expect(again.unchanged.map((u) => u.key)).not.toContain('monthlyRent'); // derived from the rent: not repeated
  });

  it('shows a year as a year', () => {
    expect(formatValue('yearBuilt', 2023)).toBe('2023');
    expect(formatValue('purchasePrice', 18400000)).toBe('18,400,000');
  });
});

describe('a unit mix pieced together from text, then checked by code', () => {
  const base = { address: box('5101 W Powerhouse Rd'), assetClass: box('multi_family'), unitCount: box(66), averageCurrentRent: box(1832), averageMarketRent: box(1905) };
  const mix = (a: number, b: number) => [
    { unitType: box('2 Bd TH'), unitCount: box(a), avgSqFt: box(1266), marketMonthlyRent: box(1850) },
    { unitType: box('3 Bd TH'), unitCount: box(b), avgSqFt: box(1268), marketMonthlyRent: box(1950) },
  ];

  it('accepts a mix that adds up and averages to what the memorandum states', () => {
    const om: any = coerceIntake('offering_memorandum', { ...base, unitMix: mix(30, 36) });
    expect(validateIntake(om)).toEqual([]);
  });

  it('flags a mix whose counts do not add up, or whose rents do not average to the stated market rent', () => {
    const wrongCount: any = coerceIntake('offering_memorandum', { ...base, unitMix: mix(30, 30) });
    expect(validateIntake(wrongCount).map((i) => i.message).join(' ')).toContain('adds up to 60 units');
    const wrongRent: any = coerceIntake('offering_memorandum', { ...base, averageMarketRent: box(2400), unitMix: mix(30, 36) });
    expect(validateIntake(wrongRent).map((i) => i.message).join(' ')).toContain('market rents in the unit mix average');
  });

  it('with no per-type current rent, uses the stated average current rent times the units', () => {
    const om: any = coerceIntake('offering_memorandum', { ...base, unitMix: mix(30, 36) });
    const p = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    expect(p.patch.patch.grossRentPerMonth).toBe(120912); // 1,832 x 66
    expect(p.patch.patch.monthlyRentPerUnit).toBe(1832);
  });
});

describe('the review shows each figure once, in plain words', () => {
  const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
  const om = coerceIntake('offering_memorandum', {
    address: box('1 Main St'), assetClass: box('multi_family'), unitCount: box(66),
    income: [line('Gross Potential Rent', 'rent', 1450800), line('Vacancy', 'vacancy_credit_loss', -72540)],
    expenses: [line('RE Taxes', 'property_tax', 115670), line('Reserves', 'reserves_capex', 16500), line('Debt service', 'debt_service', 900000)],
  });

  it('lists the rent as one row, and applies every form of it', () => {
    const p = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    const keys = p.changes.map((c) => c.key);
    expect(keys.filter((k) => ['grossRentPerMonth', 'monthlyRent', 'grossRentAnnual', 'monthlyRentPerUnit'].includes(k))).toEqual(['grossRentPerMonth']);
    const rent = p.changes.find((c) => c.key === 'grossRentPerMonth')!;
    expect(rent.label).toBe('Rent');
    expect(rent.proposed).toContain('120,900 a month');
    expect(rent.proposed).toContain('1,450,800 a year');
    expect(rent.how).toContain('income table');
    const saved = buildApplication({ inputs: {} }, p, new Set(['grossRentPerMonth'])).inputsPatch;
    expect(saved).toMatchObject({ grossRentPerMonth: 120900, monthlyRent: 120900, grossRentAnnual: 1450800 });
  });

  it('says the reserve is applied on its own, and that debt service is not applied', () => {
    const notes = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: {} }).patch.notes.join(' | ');
    expect(notes).toContain('replacement reserve (16,500 a year) is applied on its own');
    expect(notes).toContain('Not applied: 900,000 of debt service or depreciation');
    expect(notes).not.toContain('Left out of the expense ratio');
  });
});

describe('the expense ratio means what the engine expects, and large gaps from your own assumption are flagged', () => {
  const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
  const memo = (assetClass: string, expenses: ReturnType<typeof line>[]) => coerceIntake('offering_memorandum', {
    address: box('1 Main St'), assetClass: box(assetClass), unitCount: box(66),
    income: [line('Gross Potential Rent', 'rent', 1450800), line('Vacancy', 'vacancy_credit_loss', -72540), line('RUBS', 'recoveries', 103932), line('Pet', 'other_income', 34686)],
    expenses,
  });
  const costs = [
    line('Maint/Repair', 'repairs_maintenance', 33000), line('Payroll', 'payroll', 32000), line('Marketing', 'marketing', 7720), line('RE Taxes', 'property_tax', 115670),
    line('Insurance', 'insurance', 19962), line('Utilities', 'utilities', 73382), line('Management', 'management', 53522), line('Reserves', 'reserves_capex', 16500),
  ];

  it('leaves management out (that is your decision), takes reserves on their own, and nets what tenants reimburse', () => {
    const p = proposeChanges([memo('multi_family', costs)], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    // 33,000 + 32,000 + 7,720 + 115,670 + 19,962 + 73,382 = 281,734; less 103,932 reimbursed = 177,802; over rent 1,450,800
    expect(p.patch.patch.expenseRatio).toBe(12.26);
    const how = p.patch.provenance.expenseRatio.how;
    expect(how).toContain('without management');
    expect(how).toContain('utilities 73,382'); // the ratio says what is inside it
    expect(how).toContain('repairs and maintenance 33,000');
    expect(how).toContain('less tenant reimbursements 103,932');
    expect(how).toContain('divided by rent 1,450,800');
    const notes = p.patch.notes.join(' | ');
    expect(notes).toContain('management cost (53,522 a year');
    expect(notes).toContain('34,686 a year of other income'); // pet fees: not a reimbursement of a cost, so not counted
    expect(notes).toContain('Whether you hire a manager is your decision');
    // the reimbursement is stated as an assumption, with the ratio it would be without it: (281,734 / 1,450,800)
    expect(notes).toContain('Tenant utility reimbursements (such as RUBS) of 103,932 a year are taken off the costs');
    expect(notes).toContain('without them the expense ratio would be 19.42%');
    expect(p.patch.patch.capexReserveAnnual).toBe(16500);
  });

  it('for storage, also leaves payroll and marketing out, since the engine charges them separately', () => {
    const p = proposeChanges([memo('storage', costs)], { asset_class: 'storage', purchase_price: null, inputs: {} });
    // without payroll 32,000 and marketing 7,720: 33,000 + 115,670 + 19,962 + 73,382 = 242,014; less 103,932 = 138,082 over rent 1,450,800
    expect(p.patch.patch.expenseRatio).toBe(9.52);
    expect(p.patch.notes.join(' ')).toContain('On-site payroll and marketing (39,720 a year)');
  });

  it('flags a figure far from your own assumption, with both numbers, and carries out the choice', () => {
    const p = proposeChanges([memo('multi_family', costs)], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    const expected = { filled: { vacancyRate: 8, expenseRatio: 12.5, annualInsurance: 19000 }, basis: { vacancyRate: { source: 'profile' as const, label: 'Vacancy', value: 8, rationale: 'Yakima apartments run about 8%' } } };
    attachVariances(p, expected);
    const vacancy = p.changes.find((c) => c.key === 'vacancyRate')!;
    expect(vacancy.variance).toMatchObject({ expected: 8, percent: 38, higher: false, why: 'Yakima apartments run about 8%' }); // document 5, yours 8
    expect(p.changes.find((c) => c.key === 'expenseRatio')!.variance).toBeUndefined(); // 12.26 vs 12.5: close enough, no question
    expect(p.changes.some((c) => c.key === 'annualInsurance')).toBe(false); // folded into the expense ratio, not a field of its own
    const chosen = applyChoices(p, { vacancyRate: { use: 'mine' } }, expected);
    expect(chosen.changes.find((c) => c.key === 'vacancyRate')).toMatchObject({ value: 8, how: 'Your own assumption: Yakima apartments run about 8%' });
    expect(chosen.patch.basis.vacancyRate.source).toBe('profile');
    expect(buildApplication({ inputs: {} }, chosen, new Set(['vacancyRate'])).inputsPatch.vacancyRate).toBe(8);
    expect(buildApplication({ inputs: {} }, p, new Set(['vacancyRate'])).inputsPatch.vacancyRate).toBe(5); // no choice made: the document's
    // or a number typed for this property, recorded as the owner's own
    const typed = applyChoices(p, { vacancyRate: { use: 'custom', value: 7 } }, expected);
    expect(buildApplication({ inputs: {} }, typed, new Set(['vacancyRate'])).inputsPatch.vacancyRate).toBe(7);
    expect(typed.patch.basis.vacancyRate).toMatchObject({ source: 'owner', value: 7, rationale: 'Entered by you for this property' });
    expect(applyChoices(p, { vacancyRate: { use: 'custom', value: NaN } }, expected).changes.find((c) => c.key === 'vacancyRate')!.value).toBe(5); // unreadable number: the document's stands
  });
});

describe('what is still needed after the documents are applied', () => {
  const asked = (form: Record<string, string>) => missingInputsFor({ asset_class: 'multi-unit', purchase_price: Number(form.price) || undefined, inputs: formAsInputs(form, 'multi-unit') } as any);
  const filled = { price: '18400000', multiUnits: '66', multiSqft: '83628', grossRent: '120900', multiGrossRent: '120900', vacancy: '5', opexRatio: '18.03', closingDate: '2026-12-01' };

  it('asks only for the facts the documents lacked, and each answer can be typed into the form', () => {
    const first = asked(filled).filter((m) => m.kind === 'fact').map((m) => m.key);
    expect(first).toContain('downPaymentPercent'); // the memorandum does not say how it will be financed
    expect(first).not.toContain('purchasePrice'); // already filled from the list price
    // the owner answers right there: the loan then needs its own rate and amortization
    const afterDown = asked({ ...filled, down: '25' }).filter((m) => m.kind === 'fact').map((m) => m.key);
    expect(afterDown).toEqual(expect.arrayContaining(['interestRate', 'amortizationYears']));
    expect(afterDown).not.toContain('downPaymentPercent');
    expect(asked({ ...filled, down: '25', rate: '6.5', amort: '30' }).filter((m) => m.kind === 'fact')).toEqual([]);
    // every one of those answers has a form field to land in
    for (const k of ['downPaymentPercent', 'interestRate', 'amortizationYears', 'purchasePrice', 'closingDate']) expect(FORM_FIELD_FOR_KEY[k]).toBeTruthy();
  });
});

describe('the investor profile decides whether a property manager is hired, and the review honors it', () => {
  const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
  const om = coerceIntake('offering_memorandum', {
    address: box('1 Main St'), assetClass: box('multi_family'), unitCount: box(66),
    income: [line('GPR', 'rent', 1450800)], expenses: [line('Taxes', 'property_tax', 115670), line('Management', 'management', 53522)],
  });
  const notesFor = (manager?: { uses: boolean | null; fee?: number }) => proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: {} }, { manager }).patch.notes.join(' | ');

  it('keeps the yes-or-no per asset class and reads it back', () => {
    const saved = sanitizeAssumptions({ assets: { 'multi-unit': { usesPropertyManager: true, managementFeePercent: 6 }, commercial: { usesPropertyManager: false }, storage: { usesPropertyManager: 'yes' } } });
    expect(managerChoice(saved, 'multi-unit')).toEqual({ uses: true, fee: 6 });
    expect(managerChoice(saved, 'commercial').uses).toBe(false);
    expect(managerChoice(saved, 'storage').uses).toBeNull(); // not a yes or no: not decided
    expect(managerChoice(null, 'multi-unit').uses).toBeNull();
  });

  it('says what the owner decided about management, not a generic line', () => {
    expect(notesFor({ uses: true, fee: 6 })).toContain('You hire a manager, so your own management fee (6% of income) is charged separately.');
    expect(notesFor({ uses: false })).toContain('You manage it yourself, so no management fee is charged (a lender will usually add one).');
    expect(notesFor()).toContain('Whether you hire a manager is your decision');
    expect(notesFor({ uses: true })).toContain('management cost (53,522 a year'); // the seller\'s own cost is never what gets applied
  });

  it('the form tells the reader about this property\'s own setting', () => {
    expect(formAsInputs({ manageProperty: 'true' }, 'multi-unit').manageProperty).toBe(true);
    expect(formAsInputs({ manageProperty: 'false' }, 'multi-unit').manageProperty).toBe(false);
  });
});

describe('one address line', () => {
  const om = coerceIntake('offering_memorandum', { address: box('5101 W Powerhouse Rd'), city: box('Yakima'), state: box('WA'), zip: box('98908'), assetClass: box('multi_family'), unitCount: box(66) });

  it('shows street, city, state and zip as one address, and fills the form with it', () => {
    const p = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    const keys = p.changes.map((c) => c.key);
    expect(keys).toContain('address');
    for (const k of ['city', 'state', 'zip']) expect(keys).not.toContain(k);
    expect(p.changes.find((c) => c.key === 'address')!.proposed).toBe('5101 W Powerhouse Rd, Yakima, WA 98908');
    const fill = applyToForm({ form: { financingType: 'fixed' }, asset: 'multi-unit', proposal: p, ticked: new Set(keys) });
    expect(fill.form.location).toBe('5101 W Powerhouse Rd, Yakima, WA 98908');
  });

  it('does not ask again when the form already holds that address', () => {
    const p = proposeChanges([om], { asset_class: 'multi-unit', purchase_price: null, inputs: formAsInputs({ location: '5101 W Powerhouse Rd, Yakima, WA 98908' }, 'multi-unit') });
    expect(p.changes.some((c) => ['address', 'city', 'state', 'zip'].includes(c.key))).toBe(false);
    expect(p.unchanged.map((u) => u.key)).toContain('address');
  });
});

describe('the loan is asked about all at once', () => {
  const filled = { price: '18400000', multiUnits: '66', multiSqft: '83628', grossRent: '120900', multiGrossRent: '120900', vacancy: '5', opexRatio: '18.03', closingDate: '2026-12-01' };
  const ask = (form: Record<string, string>) => openQuestions({ asset_class: 'multi-unit', purchase_price: Number(form.price) || undefined, inputs: formAsInputs(form, 'multi-unit') }).filter((m) => m.kind === 'fact').map((m) => m.key);

  it('lists the down payment, the rate and the amortization together when none is known', () => {
    const keys = ask(filled);
    expect(keys).toEqual(expect.arrayContaining(['downPaymentPercent', 'interestRate', 'amortizationYears']));
    expect(keys.indexOf('interestRate')).toBe(keys.indexOf('downPaymentPercent') + 1); // together, in loan order
  });

  it('does not repeat a loan figure the owner has already given, and stops asking once all is answered', () => {
    expect(ask({ ...filled, rate: '6.5' })).not.toContain('interestRate');
    expect(ask({ ...filled, rate: '6.5' })).toEqual(expect.arrayContaining(['downPaymentPercent', 'amortizationYears']));
    expect(ask({ ...filled, down: '25', rate: '6.5', amort: '30' })).toEqual([]);
  });

  it('an all-cash purchase (100% down) needs no rate or amortization', () => {
    const keys = ask({ ...filled, down: '100' });
    expect(keys).not.toContain('interestRate');
    expect(keys).not.toContain('amortizationYears');
  });
});

describe('how a profile figure is written next to its reason', () => {
  it('gives each its unit', () => {
    expect(assumptionText('vacancyRate', 5)).toBe('5%');
    expect(assumptionText('exitYear', 10)).toBe('10 years');
    expect(assumptionText('capexReserveAnnual', 16500)).toBe('$16,500 a year');
    expect(assumptionText('closingCosts', 552000)).toBe('$552,000');
  });
});
