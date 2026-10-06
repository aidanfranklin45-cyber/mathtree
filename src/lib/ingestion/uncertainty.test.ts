import { describe, it, expect } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { LOW_CONFIDENCE, proposeChanges } from './apply';

const box = (value: unknown, confidence = 1, evidence?: string) => ({ value, confidence, ...(evidence ? { evidence } : {}) });
const line = (label: string, category: string, amount: number, confidence = 1, evidence?: string) => ({ label: box(label), category: box(category), amount: box(amount, confidence, evidence) });
const mixRow = (type: string, count: number, rent: number, rentConfidence = 1, evidence?: string) => ({ unitType: box(type), unitCount: box(count), avgSqFt: box(900), currentMonthlyRent: box(rent, rentConfidence, evidence), marketMonthlyRent: box(null) });

const memo = (over: Record<string, unknown> = {}) => coerceIntake('offering_memorandum', {
  address: box('1 Main St'), assetClass: box('multi_family'), unitCount: box(66), askingPrice: box(18_400_000),
  unitMix: [mixRow('2 bed', 30, 1800), mixRow('3 bed', 36, 2000)],
  income: [line('Rent', 'rent', 1_450_800), line('Vacancy', 'vacancy_credit_loss', -72_540)],
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
    const at = proposeChanges([memo({ unitMix: [mixRow('2 bed', 66, 1900, LOW_CONFIDENCE)] })], deal);
    const below = proposeChanges([memo({ unitMix: [mixRow('2 bed', 66, 1900, LOW_CONFIDENCE - 0.01)] })], deal);
    expect(rent(at).unsure).toBeFalsy();
    expect(rent(below).unsure).toBe(true);
  });

  it('does not flag a figure the owner already typed (that is their call, asked as a replacement)', () => {
    const p = proposeChanges([memo({ unitMix: [mixRow('2 bed', 66, 1900, 0.3)] })], { asset_class: 'multi-unit', purchase_price: null, inputs: { grossRentPerMonth: 100_000 } });
    expect(rent(p).replaces).toBe(true);
    expect(rent(p).unsure).toBeFalsy();
  });
});
