import { describe, it, expect } from 'vitest';
import { calculateProjections } from './index';
import { buildInputs, seedForm } from '../../components/studio/modals/editInputsForm';

const base = {
  purchasePrice: 750000, downPaymentPercent: 100, monthlyRent: 3750, vacancyRate: 1,
  expenseRatio: 30, rentGrowth: 3.5, exitYear: 10, interestRate: 6.25, loanTerm: 30,
};
const valueAt = (inputs: Record<string, any>, i: number) =>
  calculateProjections('multi-unit', inputs).projections[i].propertyValue;

describe('appreciation default', () => {
  it('appreciates at the 2% default when the input is unset', () => {
    expect(valueAt(base, 9)).toBeGreaterThan(750000 * 1.02 ** 8);
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
  it('Edit Inputs saves 0% as 0 and a blank field as the 2% default', () => {
    const deal: any = { asset_class: 'multi-unit', inputs: {} };
    const form: any = seedForm(deal);
    expect(form.appreciation).toBe('2');
    expect(buildInputs({ ...form, appreciation: '0' }, deal).appreciationRate).toBe(0);
    expect(buildInputs({ ...form, appreciation: '' }, deal).appreciationRate).toBe(2);
  });
});
