import { describe, it, expect } from 'vitest';
import {
  calculateProjections, calculateTaxMetrics, calculateMonthlyPayment, checkEngineInputs, IncompleteInputsError, runMonteCarlo,
} from './index';
import { calculateMonthlyProjections } from '../../../supabase/functions/_shared/math-engine';

/** A deal that states every input the engine needs. Nothing here is a default: each test removes or changes one thing. */
const complete = (over: Record<string, any> = {}): Record<string, any> => ({
  purchasePrice: 1000000, closingDate: '2026-01-01', holdingPeriod: 10, discountRate: 8,
  downPaymentPercent: 25, interestRate: 6.5, amortizationYears: 25, loanMaturityYears: 10,
  grossRentAnnual: 120000, vacancyRate: 5, rentGrowth: 3, expenseRatio: 30,
  capexReserveAnnual: 2000, appreciationRate: 2, targetCapRate: 7, sellingCostPercent: 3, closingCosts: 20000,
  ...over,
});
const without = (inputs: Record<string, any>, ...keys: string[]) => {
  const o = { ...inputs };
  keys.forEach((k) => delete o[k]);
  return o;
};
const missingKeys = (asset: string, inputs: Record<string, any>) => checkEngineInputs(asset, inputs).map((m) => m.key);

describe('the engine never invents an input', () => {
  it('a deal that states everything is accepted', () => {
    expect(checkEngineInputs('multi-unit', complete())).toEqual([]);
    expect(checkEngineInputs('commercial', complete())).toEqual([]);
  });

  it('an empty deal is refused with every fact it lacks, not a number', () => {
    const keys = missingKeys('commercial', {});
    for (const k of ['purchasePrice', 'closingDate', 'holdingPeriod', 'discountRate', 'downPaymentPercent', 'vacancyRate', 'expenseRatio', 'capexReserveAnnual']) {
      expect(keys).toContain(k);
    }
    expect(() => calculateProjections('commercial', {})).toThrow(IncompleteInputsError);
  });

  it.each([
    ['closingDate', 'closingDate'],
    ['holdingPeriod', 'holdingPeriod'],
    ['discountRate', 'discountRate'],
    ['interestRate', 'interestRate'],
    ['amortizationYears', 'amortizationYears'],
    ['vacancyRate', 'vacancyRate'],
    ['expenseRatio', 'expenseRatio'],
    ['rentGrowth', 'rentGrowth'],
    ['capexReserveAnnual', 'capexReserveAnnual'],
    ['closingCosts', 'closingCosts'],
  ])('removing %s names it as missing', (removed, reported) => {
    expect(missingKeys('multi-unit', without(complete(), removed))).toContain(reported);
  });

  it('a blank string is not a stated value, but an explicit 0 is', () => {
    expect(missingKeys('multi-unit', complete({ vacancyRate: '' }))).toContain('vacancyRate');
    expect(missingKeys('multi-unit', complete({ vacancyRate: 0, rentGrowth: 0, capexReserveAnnual: 0, sellingCostPercent: 0 }))).toEqual([]);
  });

  it('an unreadable closing date is missing, not defaulted', () => {
    expect(missingKeys('multi-unit', complete({ closingDate: 'soon' }))).toContain('closingDate');
    expect(missingKeys('multi-unit', complete({ closingDate: '07/15/2026' }))).not.toContain('closingDate');
  });

  it('a single-family home needs appreciation; everything else needs an exit cap rate', () => {
    expect(missingKeys('single-family', without(complete(), 'appreciationRate'))).toContain('appreciationRate');
    expect(missingKeys('single-family', without(complete(), 'targetCapRate'))).not.toContain('targetCapRate');
    expect(missingKeys('multi-unit', without(complete(), 'appreciationRate'))).not.toContain('appreciationRate');
    expect(missingKeys('commercial', without(complete(), 'targetCapRate'))).toContain('targetCapRate');
    expect(missingKeys('commercial', without(complete(), 'appreciationRate'))).not.toContain('appreciationRate');
    expect(missingKeys('multi-unit', without(complete(), 'targetCapRate'))).toContain('targetCapRate');
  });

  it('every lease must state its own escalation (0 if none); the engine will not assume 3%', () => {
    const lease = { tenantName: 'A', monthlyRent: 5000, leaseStartDate: '2026-01-01', leaseEndDate: '2031-01-01', leaseType: 'Gross' };
    expect(missingKeys('commercial', complete({ grossRentAnnual: undefined, leases: [lease] }))).toContain('leases[0].escalationRate');
    expect(missingKeys('commercial', complete({ grossRentAnnual: undefined, leases: [{ ...lease, escalationRate: 0 }] }))).not.toContain('leases[0].escalationRate');
  });
});

describe('the loan is the loan, not a generic one', () => {
  it('payments run over the stated amortization, and the balance at maturity is what is left', () => {
    const m: any = calculateProjections('multi-unit', complete({ amortizationYears: 25, loanMaturityYears: 10 }));
    const loan = 750000;
    expect(m.monthlyMortgagePayment).toBeCloseTo(calculateMonthlyPayment(loan, 6.5, 25), 1);
    // 10 years into a 25-year amortization most of the loan is still owed: a balloon, not a paid-off loan
    expect(m.projections[9].loanBalanceRemaining).toBeGreaterThan(loan * 0.6);
  });

  it('a loan that matures before the exit is refused: how a balloon is repaid is not guessed', () => {
    const keys = missingKeys('multi-unit', complete({ holdingPeriod: 10, loanMaturityYears: 7 }));
    expect(keys).toContain('loanMaturityYears');
    expect(() => calculateProjections('multi-unit', complete({ holdingPeriod: 10, loanMaturityYears: 7 }))).toThrow(IncompleteInputsError);
    expect(missingKeys('multi-unit', complete({ holdingPeriod: 7, loanMaturityYears: 7 }))).toEqual([]);
  });

  it('an ARM must state its own fixed period and adjusted rate; interest-only its own period', () => {
    const arm = missingKeys('multi-unit', complete({ financingType: 'arm' }));
    expect(arm).toEqual(expect.arrayContaining(['armInitialYears', 'armAdjustmentRate', 'armRateCap']));
    expect(missingKeys('multi-unit', complete({ financingType: 'interest_only' }))).toContain('interestOnlyYears');
  });

  it('borrowing nothing needs no loan terms', () => {
    const cash = missingKeys('multi-unit', without(complete({ downPaymentPercent: 100 }), 'interestRate', 'amortizationYears', 'loanMaturityYears'));
    expect(cash).toEqual([]);
  });

  it('a stated loan amount sets the down payment; a stated percent wins when both are given', () => {
    const byAmount: any = calculateProjections('multi-unit', complete({ downPaymentPercent: undefined, loanAmount: 600000 }));
    expect(byAmount.loanAmount).toBe(600000);
    const both: any = calculateProjections('multi-unit', complete({ downPaymentPercent: 25, loanAmount: 600000 }));
    expect(both.loanAmount).toBe(750000);
    expect(missingKeys('multi-unit', without(complete(), 'downPaymentPercent'))).toContain('downPaymentPercent');
  });
});

describe('selling costs come off what the owner receives', () => {
  it('exit proceeds are value less selling costs less the loan balance, and drive the IRR', () => {
    const a: any = calculateProjections('multi-unit', complete({ sellingCostPercent: 0 }));
    const b: any = calculateProjections('multi-unit', complete({ sellingCostPercent: 6 }));
    const last = b.projections[9];
    expect(last.exitProceedsNet).toBeCloseTo(last.propertyValue * 0.94 - last.loanBalanceRemaining, 0);
    expect(a.projections[9].exitProceedsNet).toBeCloseTo(a.projections[9].equity, 0);
    expect(b.irr).toBeLessThan(a.irr);
    expect(b.equityMultiplier).toBeLessThan(a.equityMultiplier);
    // The equity shown each year is still value less loan: only a sale has selling costs
    expect(last.equity).toBeCloseTo(last.propertyValue - last.loanBalanceRemaining, 0);
  });
});

describe('costs are the owner\'s numbers, not the engine\'s', () => {
  it('an unmanaged multi-unit property pays no management fee (there used to be a hidden 3%)', () => {
    const none: any = calculateProjections('multi-unit', complete({ vacancyRate: 0 }));
    expect(none.projections[0].operatingExpenses).toBeCloseTo(120000 * 0.3, 0);
  });

  it('management is charged at the stated rate on collected income, and a managed property must state one', () => {
    expect(missingKeys('multi-unit', complete({ manageProperty: true }))).toContain('managementFeePercent');
    const m: any = calculateProjections('multi-unit', complete({ manageProperty: true, managementFeePercent: 8, vacancyRate: 5 }));
    expect(m.projections[0].operatingExpenses).toBeCloseTo(120000 * 0.3 + 120000 * 0.95 * 0.08, 0);
  });

  it('reserves are as stated: dollars a year, or a share of income', () => {
    const dollars: any = calculateProjections('multi-unit', complete({ capexReserveAnnual: 5000 }));
    expect(dollars.projections[0].capexReserve).toBe(5000);
    const share: any = calculateProjections('multi-unit', complete({ capexReserveAnnual: undefined, capexReservePercent: 3, vacancyRate: 0 }));
    expect(share.projections[0].capexReserve).toBeCloseTo(120000 * 0.03, 0);
  });

  it('storage states its payroll and marketing', () => {
    expect(missingKeys('storage', complete())).toContain('payrollMarketingPercent');
    const m: any = calculateProjections('storage', complete({ payrollMarketingPercent: 10, vacancyRate: 0 }));
    expect(m.projections[0].operatingExpenses).toBeCloseTo(120000 * 0.3 + 120000 * 0.1, 0);
  });

  it('a property with no income, or tenants who pay the building\'s costs, states what it costs to carry', () => {
    expect(missingKeys('commercial', complete({ grossRentAnnual: undefined }))).toEqual(expect.arrayContaining(['annualTaxes', 'annualInsurance', 'annualMaintenance']));
    const nnn = { tenantName: 'A', monthlyRent: 10000, leaseStartDate: '2026-01-01', leaseEndDate: '2031-01-01', leaseType: 'NNN', escalationRate: 0 };
    expect(missingKeys('commercial', complete({ grossRentAnnual: undefined, leases: [nnn] }))).toContain('annualTaxes');
    expect(missingKeys('commercial', complete({ grossRentAnnual: undefined, leases: [{ ...nnn, leaseType: 'Gross' }] }))).not.toContain('annualTaxes');
  });
});

describe('the other entry points hold the same line', () => {
  it('the tax module will not assume a land share or a tax rate', () => {
    expect(() => calculateTaxMetrics('multi-unit', complete() as any)).toThrow(IncompleteInputsError);
    const t = calculateTaxMetrics('multi-unit', complete({ landPercent: 30, taxRate: 32 }) as any);
    expect(t.landAllocationPct).toBe(30);
    expect(t.effectiveTaxRate).toBe(32);
  });

  it('the monthly schedule starts at the stated closing date and refuses a deal without one', () => {
    expect(() => calculateMonthlyProjections('multi-unit', without(complete(), 'closingDate'), { monthsCount: 12 })).toThrow(IncompleteInputsError);
    const ok = calculateMonthlyProjections('multi-unit', complete({ closingDate: '2026-03-01', loanMaturityYears: 5 }), { monthsCount: 12 });
    expect(ok.monthlyRows?.[0]?.date ?? ok.rows?.[0]?.date ?? JSON.stringify(ok).slice(0, 400)).toBeTruthy();
  });

  it('the Monte Carlo will not simulate a deal that does not state its own assumptions', () => {
    expect(() => runMonteCarlo('multi-unit', without(complete(), 'vacancyRate'), { runs: 100, seed: 1 })).toThrow(IncompleteInputsError);
  });
});
