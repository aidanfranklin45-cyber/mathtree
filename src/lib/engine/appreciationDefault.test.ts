import { describe, it, expect } from 'vitest';
import { calculateProjections } from './index';

const base = {
  purchasePrice: 750000, downPaymentPercent: 100, monthlyRent: 3750, vacancyRate: 1,
  expenseRatio: 30, rentGrowth: 3.5, exitYear: 10, interestRate: 6.25, loanTerm: 30,
};
const valueAt = (inputs: Record<string, any>, i: number) =>
  calculateProjections('multi-unit', inputs).projections[i].propertyValue;

describe('appreciation default', () => {
  it('appreciates at the 3.5% default when the input is unset', () => {
    expect(valueAt(base, 9)).toBeGreaterThan(750000 * 1.035 ** 8);
  });
  it('treats a blank input as unset', () => {
    expect(valueAt({ ...base, appreciationRate: '' }, 9)).toBeGreaterThan(750000);
  });
  it('respects an explicit 0% appreciation', () => {
    expect(valueAt({ ...base, appreciationRate: 0 }, 9)).toBe(750000);
  });
  it('uses the stated rate', () => {
    expect(valueAt({ ...base, appreciationRate: 4 }, 9)).toBeCloseTo(750000 * 1.04 ** 9, 0);
  });
});
