import { describe, it, expect } from 'vitest';
import { calculateProjections, IncompleteInputsError } from './index';
import { buildInputs, seedForm } from '../../components/studio/modals/editInputsForm';

// Every input the engine needs is stated, so the only thing under test is appreciation
const base = {
  purchasePrice: 750000, downPaymentPercent: 100, monthlyRent: 3750, vacancyRate: 1, expenseRatio: 30, rentGrowth: 3.5,
  holdingPeriod: 10, exitYear: 10, interestRate: 6.25, amortizationYears: 30, loanMaturityYears: 30, closingDate: '2026-01-01',
  capexReserveAnnual: 0, sellingCostPercent: 0, discountRate: 8,
};
const valueAt = (inputs: Record<string, any>, i: number) =>
  calculateProjections('multi-unit', inputs).projections[i].propertyValue;

describe('appreciation is stated, never defaulted', () => {
  it('refuses a residential deal that does not state appreciation', () => {
    expect(() => valueAt(base, 9)).toThrow(IncompleteInputsError);
    try { valueAt(base, 9); } catch (e: any) { expect(e.missing.map((m: any) => m.key)).toContain('appreciationRate'); }
  });
  it('treats a blank input as not stated', () => {
    expect(() => valueAt({ ...base, appreciationRate: '' }, 9)).toThrow(IncompleteInputsError);
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
  it('residential saves appreciation only; commercial saves exit cap only', () => {
    const res: any = { asset_class: 'multi-unit', inputs: { targetCapRate: 6.5 } };
    const r = buildInputs({ ...seedForm(res), appreciation: '2.5' } as any, res);
    expect(r.appreciationRate).toBe(2.5);
    expect(r.targetCapRate).toBeUndefined();
    const com: any = { asset_class: 'commercial', inputs: { targetCapRate: 6.5 } };
    const c = buildInputs({ ...seedForm(com), appreciation: '7' } as any, com);
    expect(c.targetCapRate).toBe(7);
    expect(c.appreciationRate).toBeUndefined();
  });
});
