import { describe, it, expect } from 'vitest';
import { calculateProjections, runMonteCarlo } from './index';

/** Pure fixtures, no database. A 12-unit apartment building, tenant by tenant. */
const tenants = (n: number, over: (i: number) => Record<string, any> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({
    tenantName: `T${i + 1}`, unit: String(i + 1), monthlyRent: 1300 + (i % 4) * 100, annualRent: 0, leaseStartDate: '2024-03-01',
    termType: 'month_to_month', leaseEndDate: '', escalationRate: 0, ...over(i),
  }));
const building = (over: Record<string, any> = {}): any => ({
  purchasePrice: 1600000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30, exitYear: 10, closingDate: '2026-01-01', closingCosts: 30000,
  vacancyRate: 5, expenseRatio: 35, targetCapRate: 6.5, discountRate: 8, unitCount: 12, leases: tenants(12), ...over,
});
const run = (inputs: any, opts: Record<string, any> = {}, asset = 'multi-unit') => runMonteCarlo(asset, inputs, { runs: 400, seed: 21, ...opts });

describe('who the turnover model applies to', () => {
  it('apartments and houses with tenant leases', () => {
    expect(run(building()).turnover).toMatchObject({ applies: true, annualPct: 45, makeReadyCost: 1500 });
    const house = run({ purchasePrice: 400000, downPaymentPercent: 20, interestRate: 6.5, loanTerm: 30, exitYear: 10, closingDate: '2026-01-01', vacancyRate: 5, expenseRatio: 30, discountRate: 8, leases: tenants(1) }, {}, 'single-family');
    expect(house.turnover).toMatchObject({ applies: true, annualPct: 30, makeReadyCost: 2000 });
  });

  it('not for commercial (that is tenant default), nor for a property with no tenant leases', () => {
    expect(run(building({ purchasePrice: 900000 }), {}, 'commercial').turnover.applies).toBe(false);
    expect(run(building({ leases: [], grossRentAnnual: 200000, monthlyRent: 16666 })).turnover.applies).toBe(false);
  });

  it('can be turned off, which restores the plain vacancy-rate behaviour', () => {
    const off = run(building(), { turnoverPct: 0 });
    expect(off.turnover.applies).toBe(false);
    expect(off.turnover.avgMoveOutsPerRun).toBe(0);
  });
});

describe('the vacant stretch is anchored to the deal\'s own vacancy setting', () => {
  it('45% a year with a 5% vacancy setting gives about 41 vacant days, and 5% implied vacancy', () => {
    const t = run(building()).turnover;
    expect(t.calibratedToVacancy).toBe(true);
    expect(t.downtimeDays).toBeGreaterThan(36);
    expect(t.downtimeDays).toBeLessThan(46);
    expect(Math.abs(t.impliedVacancyPct - 5)).toBeLessThan(0.4);
  });

  it('a higher vacancy setting stretches the vacant days so the average still matches it', () => {
    const t = run(building({ vacancyRate: 8 })).turnover;
    expect(t.downtimeDays).toBeGreaterThan(55);
    expect(Math.abs(t.impliedVacancyPct - 8)).toBeLessThan(0.5);
  });

  it('days the owner chooses are used as given (no calibration)', () => {
    const t = run(building(), { turnoverDowntimeDays: 90 }).turnover;
    expect(t.calibratedToVacancy).toBe(false);
    expect(t.downtimeDays).toBe(90);
    expect(t.impliedVacancyPct).toBeGreaterThan(10);
  });

  it('a zero vacancy setting means no vacant stretch (the owner\'s assumption wins)', () => {
    expect(run(building({ vacancyRate: 0 })).turnover.downtimeDays).toBe(0);
  });

  it('on average it lands close to the plain vacancy-rate result (the move-outs are the vacancy, not extra)', () => {
    const withTurnover = run(building(), {}).profit.mean;
    const plain = run(building(), { turnoverPct: 0 }).profit.mean;
    expect(Math.abs(withTurnover - plain) / plain).toBeLessThan(0.07);
    expect(withTurnover).toBeLessThan(plain * 1.02); // make-ready cost keeps it from being higher
  });
});

describe('who can leave, and when', () => {
  it('month-to-month tenants can leave any year: about 45% x 12 tenants x 10 years', () => {
    const r = run(building());
    expect(r.turnover.avgMoveOutsPerRun).toBeGreaterThan(45);
    expect(r.turnover.avgMoveOutsPerRun).toBeLessThan(63);
  });

  it('fixed-term tenants cannot leave while their lease runs', () => {
    const fixedLong = building({ exitYear: 3, leases: tenants(12, () => ({ termType: 'fixed', leaseEndDate: '2040-12-31' })) });
    expect(run(fixedLong).turnover.avgMoveOutsPerRun).toBe(0);
  });

  it('...but can once it ends: only the years after the lease end count', () => {
    const endsIn2028 = building({ exitYear: 10, leases: tenants(12, () => ({ termType: 'fixed', leaseEndDate: '2028-12-31' })) });
    const r = run(endsIn2028);
    // eligible 2029 to 2035 (about 7 of the 10 years) for 12 tenants at 45%
    expect(r.turnover.avgMoveOutsPerRun).toBeGreaterThan(28);
    expect(r.turnover.avgMoveOutsPerRun).toBeLessThan(47);
  });
});

describe('the cost of turnover', () => {
  it('more vacant days lower profit', () => {
    expect(run(building(), { turnoverDowntimeDays: 90 }).profit.mean).toBeLessThan(run(building(), { turnoverDowntimeDays: 30 }).profit.mean);
  });

  it('a higher make-ready cost lowers profit', () => {
    const cheap = run(building(), { turnoverMakeReadyCost: 0 }).profit.mean;
    const dear = run(building(), { turnoverMakeReadyCost: 6000 }).profit.mean;
    expect(dear).toBeLessThan(cheap - 150000); // about 49 move-outs x $6,000, after vacancy and rounding
  });

  it('more turnover with the same vacant days lowers profit', () => {
    expect(run(building(), { turnoverPct: 80, turnoverDowntimeDays: 41 }).profit.mean).toBeLessThan(run(building(), { turnoverPct: 20, turnoverDowntimeDays: 41 }).profit.mean);
  });

  it('is repeatable with a seed', () => {
    expect(run(building(), { seed: 'x' })).toEqual(run(building(), { seed: 'x' }));
  });
});

describe('the engine: several tenants leaving in one scenario', () => {
  const inputs: any = building({ vacancyRate: 0, leases: tenants(3, (i) => ({ monthlyRent: 1000 * (i + 1) })) });
  const income = (extra: Record<string, any>) => {
    const r: any = calculateProjections('multi-unit', { ...inputs, ...extra });
    return { y1: r.projections[0].effectiveGrossIncome, opex: r.projections[0].operatingExpenses };
  };

  it('each move-out removes that tenant\'s rent for its months, and they add up', () => {
    const base = income({});
    const one = income({ tenantInterruptions: [{ leaseIndex: 0, startOffset: 0, months: 2 }] });
    const two = income({ tenantInterruptions: [{ leaseIndex: 0, startOffset: 0, months: 2 }, { leaseIndex: 2, startOffset: 4, months: 3 }] });
    expect(base.y1 - one.y1).toBeCloseTo(2 * 1000, 0);
    expect(base.y1 - two.y1).toBeCloseTo(2 * 1000 + 3 * 3000, 0);
  });

  it('the make-ready cost is charged once, in the year the tenant leaves', () => {
    const noCost = income({ tenantInterruptions: [{ leaseIndex: 1, startOffset: 3, months: 1 }] });
    const withCost = income({ tenantInterruptions: [{ leaseIndex: 1, startOffset: 3, months: 1, makeReadyCost: 1800 }] });
    expect(withCost.opex - noCost.opex).toBeCloseTo(1800, 1);
    const r2: any = calculateProjections('multi-unit', { ...inputs, tenantInterruptions: [{ leaseIndex: 1, startOffset: 3, months: 1, makeReadyCost: 1800 }] });
    const r0: any = calculateProjections('multi-unit', inputs);
    expect(r2.projections[1].operatingExpenses).toBeCloseTo(r0.projections[1].operatingExpenses, 2);
  });

  it('a move-out with no vacant time still costs the make-ready charge', () => {
    const base = income({});
    expect(income({ tenantInterruptions: [{ leaseIndex: 0, startOffset: 5, months: 0, makeReadyCost: 900 }] }).opex - base.opex).toBeCloseTo(900, 0);
  });

  it('the single-interruption form still works and equals a list of one', () => {
    const single = income({ tenantInterruption: { leaseIndex: 1, startOffset: 2, months: 4 } });
    const list = income({ tenantInterruptions: [{ leaseIndex: 1, startOffset: 2, months: 4 }] });
    expect(single).toEqual(list);
  });
});
