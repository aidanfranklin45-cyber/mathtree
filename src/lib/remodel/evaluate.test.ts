import { describe, it, expect } from 'vitest';
import { applyRemodel, evaluateRemodel, getRemodelPlans, type RemodelPlan } from './index';

const deal = (inputs: Record<string, any> = {}): any => ({
  id: 'd1', status: 'owned', asset_class: 'commercial', purchase_price: 2400000,
  inputs: {
    purchasePrice: 2400000, downPaymentPercent: 30, interestRate: 6, loanTerm: 25, exitYear: 10, holdingPeriod: 10, closingDate: '2022-01-01',
    closingCosts: 0, vacancyRate: 5, expenseRatio: 30, expenseGrowth: 0, targetCapRate: 7, discountRate: 8, rentGrowth: 0, grossRentAnnual: 240000, ...inputs,
  },
});
const plan = (over: Partial<RemodelPlan> = {}): RemodelPlan => ({
  id: 'p1', name: 'Rear expansion', startDate: '2026-01', durationMonths: 12, cost: 400000, financing: 'cash', rentDuringWorksPct: 0,
  rentAfter: { mode: 'monthly', value: 28000 }, valueMode: 'cap_rate', ...over,
});

describe('turning a plan into engine overrides', () => {
  it('monthly: the uplift is the new total minus today\'s rent', () => {
    expect((applyRemodel(deal(), plan()).remodel as any).rentUpliftMonthly).toBe(8000);
  });
  it('pct_increase and per_sf', () => {
    expect((applyRemodel(deal(), plan({ rentAfter: { mode: 'pct_increase', value: 25 } })).remodel as any).rentUpliftMonthly).toBe(5000);
    expect((applyRemodel(deal(), plan({ rentAfter: { mode: 'per_sf', value: 24, addedSf: 4000 } })).remodel as any).rentUpliftMonthly).toBe(8000);
  });
  it('added upkeep defaults to the deal\'s expense ratio when expenses are fixed, otherwise none', () => {
    expect((applyRemodel(deal(), plan()).remodel as any).extraOpexAnnual).toBe(28800); // 96,000 x 30%
    const scaling = deal({ expenseGrowth: undefined });
    expect((applyRemodel(scaling, plan()).remodel as any).extraOpexAnnual).toBe(0);
    expect((applyRemodel(deal(), plan({ extraOpexAnnual: 5000 })).remodel as any).extraOpexAnnual).toBe(5000);
  });
  it('never mutates the deal', () => {
    const d = deal();
    const copy = JSON.stringify(d);
    applyRemodel(d, plan());
    evaluateRemodel(d, plan());
    expect(JSON.stringify(d)).toBe(copy);
  });
  it('reads saved plans, tolerating junk', () => {
    expect(getRemodelPlans(deal())).toEqual([]);
    expect(getRemodelPlans(deal({ remodelPlans: [plan(), null, 4] }))).toHaveLength(1);
  });
});

describe('evaluating a plan', () => {
  it('a good remodel has a yield on cost above the cap rate, value created, and an incremental IRR', () => {
    const r = evaluateRemodel(deal(), plan());
    if (!r.ok) throw new Error(r.reason);
    // added NOI = 96,000 x 95% - 28,800 = 62,400 on 400,000
    expect(r.yieldOnCost).toBeCloseTo(15.6, 1);
    expect(r.valueCreated).toBeGreaterThan(0);
    expect(r.incrementalIrr).toBeGreaterThan(8);
    expect(r.irrChange).toBeGreaterThan(0);
    expect(r.paybackYears).toBeNull(); // $62k a year does not repay $640k of cost and lost rent within the hold, before exit
    expect(r.peakCashNeeded).toBeGreaterThanOrEqual(400000);
  });

  it('a strong uplift pays the money back inside the hold', () => {
    const r = evaluateRemodel(deal(), plan({ rentAfter: { mode: 'monthly', value: 40000 } }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.paybackYears).toBeGreaterThan(0);
    expect(r.paybackYears).toBeLessThan(6);
  });

  it('an overpriced remodel destroys value and says so with numbers', () => {
    const r = evaluateRemodel(deal(), plan({ cost: 2500000 }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.valueCreated).toBeLessThan(0);
    expect(r.irrChange).toBeLessThan(0);
  });

  it('financing the work lowers the cash needed', () => {
    const cash = evaluateRemodel(deal(), plan());
    const loan = evaluateRemodel(deal(), plan({ financing: 'new_loan', ltcPct: 80, loanRatePct: 7, loanTermYears: 20 }));
    if (!cash.ok || !loan.ok) throw new Error('not ok');
    expect(loan.peakCashNeeded).toBeLessThan(cash.peakCashNeeded);
    expect(loan.minDscrDuringWorks!).toBeLessThan(1);
  });

  it('warns when work eats the coverage', () => {
    const r = evaluateRemodel(deal(), plan({ financing: 'new_loan', ltcPct: 100, loanRatePct: 8 }));
    if (!r.ok) throw new Error('not ok');
    expect(r.warnings.join(' ')).toMatch(/does not cover/);
  });

  it('refuses plans it cannot judge', () => {
    expect(evaluateRemodel(deal(), plan({ cost: 0 }))).toMatchObject({ ok: false });
    expect(evaluateRemodel(deal(), plan({ startDate: '' }))).toMatchObject({ ok: false });
    expect(evaluateRemodel(deal(), plan({ rentAfter: { mode: 'monthly', value: 20000 } }))).toMatchObject({ ok: false });
    expect(evaluateRemodel(deal(), plan({ startDate: '2060-01' }))).toMatchObject({ ok: false });
  });
});
