import { describe, it, expect } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { LOW_CONFIDENCE, proposeChanges, withChosenValue, buildApplication } from './apply';

const box = (value: unknown, confidence = 1, evidence?: string) => ({ value, confidence, ...(evidence ? { evidence } : {}) });
const line = (label: string, category: string, amount: number, confidence = 1, evidence?: string) => ({ label: box(label), category: box(category), amount: box(amount, confidence, evidence) });
const mixRow = (type: string, count: number, rent: number, rentConfidence = 1, evidence?: string) => ({ unitType: box(type), unitCount: box(count), avgSqFt: box(900), currentMonthlyRent: box(rent, rentConfidence, evidence), marketMonthlyRent: box(null) });

const memo = (over: Record<string, unknown> = {}) => coerceIntake('offering_memorandum', {
  address: box('1 Main St'), assetClass: box('multi_family'), unitCount: box(66), askingPrice: box(18_400_000),
  unitMix: [mixRow('2 bed', 30, 1800), mixRow('3 bed', 36, 2000)],
  income: [line('Rent', 'rent', 1_512_000), line('Vacancy', 'vacancy_credit_loss', -72_540)],
  expenses: [line('Taxes', 'property_tax', 115_670), line('Insurance', 'insurance', 19_962)],
  ...over,
});
const deal = { asset_class: 'multi-unit', purchase_price: null, inputs: {} };
const rent = (p: ReturnType<typeof proposeChanges>) => p.changes.find((c) => c.key === 'grossRentPerMonth')!;

describe('a figure the reader was not sure of is not applied silently', () => {
  it('is flagged, with how sure the reader was and the quote it read, when a rent in the unit mix is uncertain', () => {
    const p = proposeChanges([memo({ unitMix: [mixRow('2 bed', 30, 1800), mixRow('3 bed', 36, 2000, 0.4, 'Rents range from $1,800 to $2,200 depending on the unit')] })], deal);
    expect(rent(p)).toMatchObject({ unsure: true, confidence: 0.4, evidence: 'Rents range from $1,800 to $2,200 depending on the unit' });
  });

  it('takes the weakest of the lines a calculated figure is built from', () => {
    const p = proposeChanges([memo({ expenses: [line('Taxes', 'property_tax', 115_670, 0.95), line('Insurance', 'insurance', 19_962, 0.5, 'Insurance (est.)')] })], deal);
    const ratio = p.changes.find((c) => c.key === 'expenseRatio')!;
    expect(ratio.confidence).toBe(0.5);
    expect(ratio.unsure).toBe(true);
  });

  it('leaves a confident reading alone', () => {
    const p = proposeChanges([memo()], deal);
    expect(rent(p).unsure).toBeFalsy();
    expect(rent(p).confidence).toBe(1);
  });

  it('treats the threshold as a line: at it is fine, below it is flagged', () => {
    const agree = [line('Rent', 'rent', 1_504_800)]; // 66 units at 1,900 a month
    const at = proposeChanges([memo({ income: agree, unitMix: [mixRow('2 bed', 66, 1900, LOW_CONFIDENCE)] })], deal);
    const below = proposeChanges([memo({ income: agree, unitMix: [mixRow('2 bed', 66, 1900, LOW_CONFIDENCE - 0.01)] })], deal);
    expect(rent(at).unsure).toBeFalsy();
    expect(rent(below).unsure).toBe(true);
  });

  it('does not flag a figure the owner already typed (that is their call, asked as a replacement)', () => {
    const p = proposeChanges([memo({ income: [line('Rent', 'rent', 1_504_800)], unitMix: [mixRow('2 bed', 66, 1900, 0.3)] })], { asset_class: 'multi-unit', purchase_price: null, inputs: { grossRentPerMonth: 100_000 } });
    expect(rent(p).replaces).toBe(true);
    expect(rent(p).unsure).toBeFalsy();
  });
});

describe('several figures for one thing are a question for the owner', () => {
  // the unit mix gives 126,000 a month; an income table that gives 120,900 a month (1,450,800 a year) is a different number for the same rent
  const conflicting = () => proposeChanges([memo({ income: [line('Rent', 'rent', 1_450_800), line('Vacancy', 'vacancy_credit_loss', -72_540)] })], deal);

  it('flags the rent when the unit mix and the income table disagree, and keeps both figures with where each came from', () => {
    const r = rent(conflicting());
    expect(r.unsure).toBe(true);
    expect(r.value).toBe(126_000);
    expect(r.alternatives).toHaveLength(1);
    expect(r.alternatives![0]).toMatchObject({ value: 120_900 });
    expect(r.alternatives![0].how).toContain('income table');
  });

  it('is not a question when the figures agree to within rounding', () => {
    const p = proposeChanges([memo({ income: [line('Rent', 'rent', 1_512_100)] })], deal); // 126,008 a month against 126,000
    expect(rent(p).alternatives).toBeUndefined();
  });

  it('applies the figure the owner chooses, in every form the rent is stored in', () => {
    const chosen = withChosenValue(conflicting(), 'grossRentPerMonth', 120_900);
    const saved = buildApplication({ inputs: {} }, chosen, new Set(['grossRentPerMonth'])).inputsPatch;
    expect(saved).toMatchObject({ grossRentPerMonth: 120_900, monthlyRent: 120_900, grossRentAnnual: 1_450_800 });
    expect(saved.monthlyRentPerUnit).toBeCloseTo(1_831.82, 2);
    expect(rent(chosen).unsure).toBe(false);
  });

  it('flags two statements of the same standing that give different expense ratios', () => {
    const t12 = (tax: number) => coerceIntake('operating_statement', {
      periodStart: box('2025-01-01'), periodEnd: box('2025-12-31'),
      income: [line('Rent', 'rent', 1_000_000)], expenses: [line('Taxes', 'property_tax', tax)],
    });
    const p = proposeChanges([t12(100_000), t12(150_000)], deal);
    expect(p.changes.find((c) => c.key === 'expenseRatio')!.alternatives).toHaveLength(1);
  });

  it('lets a more reliable document settle it without a question (a signed contract over a listing price)', () => {
    const agreement = coerceIntake('purchase_agreement', { purchasePrice: box(17_900_000), address: box('1 Main St') });
    const p = proposeChanges([memo(), agreement], deal);
    const price = p.changes.find((c) => c.key === 'purchasePrice')!;
    expect(price.value).toBe(17_900_000);
    expect(price.alternatives).toBeUndefined();
  });
});
