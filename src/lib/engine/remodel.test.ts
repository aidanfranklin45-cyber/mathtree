import { describe, it, expect } from 'vitest';
import { calculateProjections } from './testEngine';

/** Pure fixtures. A building owned since 2022 with flat $20k/month rent (no leases: annual path). */
const owned = (over: Record<string, any> = {}): any => ({
  purchasePrice: 2400000, downPaymentPercent: 30, interestRate: 6, loanTerm: 25, exitYear: 10, holdingPeriod: 10, closingDate: '2022-01-01',
  closingCosts: 0, vacancyRate: 5, expenseRatio: 30, expenseGrowth: 0, targetCapRate: 7, discountRate: 8, rentGrowth: 0,
  grossRentAnnual: 240000, ...over,
});
const remodel = (over: Record<string, any> = {}) => ({
  startDate: '2026-01', durationMonths: 12, cost: 600000, financing: 'cash', rentDuringWorksPct: 0, rentUpliftMonthly: 8000, ...over,
});
const run = (inputs: any, asset = 'commercial') => calculateProjections(asset, inputs);
const yr = (m: any, calYear: number) => m.projections.find((p: any) => p.calendarYear === calYear);

describe('no remodel, no change', () => {
  it('missing, unusable or empty remodel blocks leave every number identical', () => {
    const base = run(owned());
    for (const bad of [undefined, null, {}, { startDate: 'soon', cost: 5 }, { startDate: '2026-01', cost: 0, rentUpliftMonthly: 0 }]) {
      expect(run(owned({ remodel: bad }))).toEqual(base);
    }
  });

  it('adds no remodel fields when there is no remodel', () => {
    const m = run(owned());
    expect(m.remodel).toBeUndefined();
    expect(m.projections[0].remodelCost).toBeUndefined();
  });
});

describe('cash-funded remodel', () => {
  const base = run(owned());
  const m = run(owned({ remodel: remodel() }));

  it('years before the work are untouched', () => {
    for (const y of [2022, 2023, 2024, 2025]) expect(yr(m, y).netOperatingIncome).toBe(yr(base, y).netOperatingIncome);
  });

  it('the work year loses the rent and pays the cost, the next year collects the uplift', () => {
    const work = yr(m, 2026);
    expect(work.remodelRentLost).toBe(240000);
    expect(work.remodelCost).toBe(600000);
    expect(work.grossPotentialIncome).toBe(0);
    expect(work.cashFlow).toBeLessThan(yr(base, 2026).cashFlow - 600000);
    expect(yr(m, 2027).grossPotentialIncome).toBe(240000 + 8000 * 12);
    expect(yr(m, 2027).remodelCost).toBe(0);
  });

  it('keeps carrying expenses while rent is down', () => {
    expect(yr(m, 2026).operatingExpenses).toBeGreaterThan(0);
    expect(yr(m, 2026).netOperatingIncome).toBeLessThan(0);
  });

  it('value follows the higher income once complete (7% cap) but not before', () => {
    expect(yr(m, 2026).propertyValue).toBeCloseTo(yr(base, 2026).propertyValue, 0);
    expect(yr(m, 2027).propertyValue).toBeGreaterThan(yr(base, 2027).propertyValue);
  });

  it('exposes what was done', () => {
    expect(m.remodel).toMatchObject({ cost: 600000, loanAmount: 0, cashPortion: 600000 });
  });
});

describe('timing', () => {
  it('a 6-month job starting in July splits the year', () => {
    const m = run(owned({ remodel: remodel({ startDate: '2026-07', durationMonths: 6, rentDuringWorksPct: 50 }) }));
    const y = yr(m, 2026);
    expect(y.remodelRentLost).toBe(60000); // 6 months x $20k x 50%
    expect(y.remodelRentGained).toBe(0);
    expect(yr(m, 2027).remodelRentGained).toBe(96000);
  });

  it('completion mid-year collects the uplift only for the finished months', () => {
    const m = run(owned({ remodel: remodel({ startDate: '2026-01', durationMonths: 6 }) }));
    expect(yr(m, 2026).remodelRentGained).toBe(8000 * 6);
  });

  it('a start before the closing month is moved to closing; a start past the horizon does nothing', () => {
    const early = run(owned({ remodel: remodel({ startDate: '2010-01', durationMonths: 3 }) }));
    expect(yr(early, 2022).remodelRentLost).toBe(60000);
    const base = run(owned());
    const late = run(owned({ remodel: remodel({ startDate: '2060-01' }) }));
    expect(late.projections.map((p: any) => p.netOperatingIncome)).toEqual(base.projections.map((p: any) => p.netOperatingIncome));
    expect(late.irr).toBe(base.irr);
  });
});

describe('financed remodel', () => {
  const m = run(owned({ remodel: remodel({ financing: 'new_loan', ltcPct: 75, loanRatePct: 7, loanTermYears: 20 }) }));

  it('borrows the share, spends only the rest in cash', () => {
    expect(m.remodel).toMatchObject({ loanAmount: 450000, cashPortion: 150000 });
    expect(yr(m, 2026).remodelCost).toBe(150000);
  });

  it('adds debt service and a balance that amortizes', () => {
    expect(yr(m, 2026).remodelDebtService).toBeGreaterThan(0);
    const b26 = yr(m, 2026).remodelLoanBalance;
    expect(b26).toBeLessThan(450000);
    expect(yr(m, 2027).remodelLoanBalance).toBeLessThan(b26);
    expect(yr(m, 2027).debtService).toBeGreaterThan(yr(run(owned()), 2027).debtService);
  });

  it('the new balance is netted out of equity', () => {
    const cash = run(owned({ remodel: remodel() }));
    expect(yr(cash, 2027).equity - yr(m, 2027).equity).toBeCloseTo(yr(m, 2027).remodelLoanBalance, 0);
  });
});

describe('value modes and other asset classes', () => {
  it('manual value applies from completion and then appreciates', () => {
    const m = run(owned({ appreciationRate: 2, remodel: remodel({ valueMode: 'manual', manualValue: 4000000 }) }));
    expect(yr(m, 2027).propertyValue).toBe(4000000); // completes January 2027
    expect(yr(m, 2028).propertyValue).toBe(4000000 * 1.02);
    expect(yr(m, 2026).propertyValue).not.toBe(4000000);
  });

  it('an appreciation-valued house gains the capitalised uplift once, at completion', () => {
    const house = (r?: any) => run({ purchasePrice: 400000, downPaymentPercent: 20, interestRate: 6, loanTerm: 30, exitYear: 10, closingDate: '2022-01-01', vacancyRate: 5, expenseRatio: 30, expenseGrowth: 0, appreciationRate: 3, targetCapRate: 6, discountRate: 8, rentGrowth: 0, grossRentAnnual: 30000, remodel: r }, 'single-family');
    const base = house();
    const m = house(remodel({ startDate: '2026-01', durationMonths: 6, cost: 80000, rentUpliftMonthly: 600 }));
    const lift = 600 * 12 * 0.95 / 0.06; // expenses are fixed to year-1 rent here, so the uplift only pays vacancy
    expect(yr(m, 2026).propertyValue - yr(base, 2026).propertyValue).toBeCloseTo(lift, -1);
    expect(yr(m, 2027).propertyValue - yr(base, 2027).propertyValue).toBeCloseTo(lift * 1.03, -1);
  });

  it('a profitable remodel beats doing nothing; an overpriced one does not', () => {
    const base = run(owned());
    expect(run(owned({ remodel: remodel({ cost: 300000 }) })).irr).toBeGreaterThan(base.irr);
    expect(run(owned({ remodel: remodel({ cost: 3000000 }) })).irr).toBeLessThan(base.irr);
  });
});

describe('extra operating cost', () => {
  it('starts once complete', () => {
    const a = run(owned({ remodel: remodel() }));
    const b = run(owned({ remodel: remodel({ extraOpexAnnual: 12000 }) }));
    expect(yr(b, 2026).operatingExpenses).toBe(yr(a, 2026).operatingExpenses);
    expect(yr(b, 2027).operatingExpenses - yr(a, 2027).operatingExpenses).toBeCloseTo(12000, 0);
  });
});

describe('tenant-by-tenant (lease) deals', () => {
  const leased = (r?: any) => run({
    purchasePrice: 1600000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30, exitYear: 10, closingDate: '2026-01-01', closingCosts: 0,
    vacancyRate: 5, expenseRatio: 35, targetCapRate: 6.5, discountRate: 8, unitCount: 4, remodel: r,
    leases: Array.from({ length: 4 }, (_, i) => ({ tenantName: `T${i}`, monthlyRent: 2000, annualRent: 0, leaseStartDate: '2025-01-01', termType: 'month_to_month', leaseEndDate: '', escalationRate: 0 })),
  }, 'multi-unit');

  it('rent is lost during the work and stepped up after, on top of the lease rent', () => {
    const base = leased();
    const m = leased({ startDate: '2027-01', durationMonths: 6, cost: 200000, rentUpliftMonthly: 1500 });
    expect(yr(base, 2027).grossPotentialIncome).toBe(96000);
    expect(yr(m, 2027).remodelRentLost).toBe(48000);
    expect(yr(m, 2027).remodelRentGained).toBe(9000);
    expect(yr(m, 2028).grossPotentialIncome).toBe(96000 + 18000);
    expect(yr(m, 2026).netOperatingIncome).toBe(yr(base, 2026).netOperatingIncome);
  });
});
