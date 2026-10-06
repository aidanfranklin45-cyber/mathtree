import { describe, it, expect } from 'vitest';
import { calculateProjections, checkEngineInputs, IncompleteInputsError } from './index';
import { buildInputs, seedForm } from '../../components/studio/modals/editInputsForm';

// Every input the engine needs is stated, so the only thing under test is appreciation
const base = {
  purchasePrice: 750000, downPaymentPercent: 100, monthlyRent: 3750, vacancyRate: 1, expenseRatio: 30, rentGrowth: 3.5,
  holdingPeriod: 10, exitYear: 10, interestRate: 6.25, amortizationYears: 30, loanMaturityYears: 30, closingDate: '2026-01-01',
  capexReserveAnnual: 0, sellingCostPercent: 0, closingCosts: 0, discountRate: 8,
};
const valueAt = (inputs: Record<string, any>, i: number) =>
  calculateProjections('single-family', inputs).projections[i].propertyValue;

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
  it('Edit Inputs saves 0% as 0 and leaves a blank field blank (no default)', () => {
    const deal: any = { asset_class: 'single-family', inputs: {} };
    const form: any = seedForm(deal);
    expect(form.appreciation).toBe('');
    expect(buildInputs({ ...form, appreciation: '0' }, deal).appreciationRate).toBe(0);
    expect(buildInputs({ ...form, appreciation: '' }, deal).appreciationRate).toBeUndefined();
  });

  it('saving an empty form gives a deal the engine says is incomplete, not one with numbers made up for it', () => {
    const deal: any = { asset_class: 'commercial', inputs: {} };
    const built = buildInputs(seedForm(deal), deal);
    const missing = checkEngineInputs('commercial', built).map((m) => m.key);
    // The things only the owner can know are asked for
    expect(missing).toEqual(expect.arrayContaining(['purchasePrice', 'closingDate', 'downPaymentPercent', 'vacancyRate', 'expenseRatio']));
    // and a complete, saved deal round-trips unchanged
    const complete = { ...base, appreciationRate: 3 };
    const again = buildInputs(seedForm({ asset_class: 'single-family', inputs: complete } as any), { asset_class: 'single-family', inputs: complete } as any);
    expect(again.vacancyRate).toBe(complete.vacancyRate);
    expect(again.sellingCostPercent).toBe(complete.sellingCostPercent);
  });

  it('reserves are saved under one key, as dollars or as a share of income', () => {
    const deal: any = { asset_class: 'single-family', inputs: { capexReserve: 900 } };
    const form: any = seedForm(deal);
    expect(form.capexValue).toBe('900');
    const dollars = buildInputs({ ...form, capexKind: 'annual' }, deal);
    expect(dollars.capexReserveAnnual).toBe(900);
    expect(dollars.capexReservePercent).toBeUndefined();
    expect(dollars.capexReserve).toBeUndefined();
    const share = buildInputs({ ...form, capexKind: 'percent', capexValue: '3' }, deal);
    expect(share.capexReservePercent).toBe(3);
    expect(share.capexReserveAnnual).toBeUndefined();
  });
  it('residential saves appreciation only; commercial saves exit cap only', () => {
    const res: any = { asset_class: 'single-family', inputs: { targetCapRate: 6.5 } };
    const r = buildInputs({ ...seedForm(res), appreciation: '2.5' } as any, res);
    expect(r.appreciationRate).toBe(2.5);
    expect(r.targetCapRate).toBeUndefined();
    const com: any = { asset_class: 'commercial', inputs: { targetCapRate: 6.5 } };
    const c = buildInputs({ ...seedForm(com), appreciation: '7' } as any, com);
    expect(c.targetCapRate).toBe(7);
    expect(c.appreciationRate).toBeUndefined();
  });
});

describe('an apartment building is valued on its income at the exit cap rate, not by appreciation', () => {
  const apt = (inputs: Record<string, any>, i = 9) => calculateProjections('multi-unit', inputs).projections[i];
  it('asks for an exit cap rate, and not for appreciation', () => {
    try { apt(base); throw new Error('should have refused'); } catch (e: any) {
      expect(e).toBeInstanceOf(IncompleteInputsError);
      const keys = e.missing.map((m: any) => m.key);
      expect(keys).toContain('targetCapRate');
      expect(keys).not.toContain('appreciationRate');
    }
  });
  it('sells at net operating income over the exit cap rate, whatever appreciation is stated', () => {
    const a = apt({ ...base, targetCapRate: 6, exitCapTiming: 'day1' });
    const b = apt({ ...base, targetCapRate: 6, exitCapTiming: 'day1', appreciationRate: 9 });
    expect(a.propertyValue).toBeCloseTo(a.netOperatingIncome / 0.06, -1);
    expect(b.propertyValue).toBe(a.propertyValue);
  });
});

describe('other income besides rent', () => {
  const y1 = (inputs: Record<string, any>, i = 1) => calculateProjections('multi-unit', { ...base, targetCapRate: 6, ...inputs }).projections[i];
  it('is none unless the owner states it', () => {
    expect(y1({}).otherIncome).toBe(0);
  });
  it('adds to income, takes vacancy, grows with rent growth, and carries no expense ratio', () => {
    const without = y1({});
    const withOther = y1({ otherIncomeAnnual: 10_000 });
    const kept = 10_000 * 1.035 * (1 - 0.01);
    expect(withOther.effectiveGrossIncome - without.effectiveGrossIncome).toBeCloseTo(kept, 0);
    expect(withOther.operatingExpenses).toBeCloseTo(without.operatingExpenses, 2);
    expect(withOther.netOperatingIncome - without.netOperatingIncome).toBeCloseTo(kept, 0);
  });
});
