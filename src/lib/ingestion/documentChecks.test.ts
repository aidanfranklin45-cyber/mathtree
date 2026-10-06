import { describe, it, expect } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { documentChecks } from './validate';

const box = (value: unknown) => ({ value, confidence: 1 });
const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });

// Income: rent 1,450,800 + recoveries 103,932 + other 54,268 - vacancy 72,540 = 1,536,460. Operating costs 442,715 (reserves are not operating).
const memo = (claimedNoi: number, cap: number, price = 18_400_000) => coerceIntake('offering_memorandum', {
  address: box('1 Main St'), assetClass: box('multi_family'), askingPrice: box(price), claimedNoi: box(claimedNoi), claimedCapRatePercent: box(cap),
  income: [line('Rent', 'rent', 1_450_800), line('RUBS', 'recoveries', 103_932), line('Pet', 'other_income', 54_268), line('Vacancy', 'vacancy_credit_loss', -72_540)],
  expenses: [line('Taxes', 'property_tax', 115_670), line('Utilities', 'utilities', 73_382), line('Payroll', 'payroll', 57_000), line('Other', 'other', 143_141), line('Management', 'management', 53_522), line('Repairs', 'repairs_maintenance', 0.01), line('Reserves', 'reserves_capex', 16_500)],
});

describe('the document is held to its own arithmetic', () => {
  it('ties when the income and costs we read give the NOI it prints, and the NOI over the price gives its cap rate', () => {
    const noi = 1_536_460 - (115_670 + 73_382 + 57_000 + 143_141 + 53_522 + 0.01);
    const checks = documentChecks(memo(Math.round(noi), +(noi / 18_400_000 * 100).toFixed(2)));
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks[0].detail).toContain('They tie.');
  });

  it('flags a table that does not add up to the NOI it prints (a line missed or misread)', () => {
    const checks = documentChecks(memo(1_300_000, 7.07));
    const noiCheck = checks.find((c) => c.label.startsWith('Income less costs'))!;
    expect(noiCheck.ok).toBe(false);
    expect(noiCheck.detail).toContain('do not tie');
  });

  it('flags an NOI and price that do not give the printed cap rate', () => {
    const noi = Math.round(1_536_460 - (115_670 + 73_382 + 57_000 + 143_141 + 53_522 + 0.01));
    const cap = documentChecks(memo(noi, 8.5)).find((c) => c.label.startsWith('NOI over the price'))!;
    expect(cap.ok).toBe(false);
  });

  it('says nothing when the document does not print an NOI to check', () => {
    expect(documentChecks(memo(0, 0)).filter((c) => c.label.startsWith('Income less costs'))).toHaveLength(0);
  });
});
