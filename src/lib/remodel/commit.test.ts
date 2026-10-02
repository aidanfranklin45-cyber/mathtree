import { describe, it, expect } from 'vitest';
import { commitRemodelPatch, uncommitRemodelPatch, getCommittedRemodel, getRemodelPlans, evaluateRemodel, type RemodelPlan } from './index';
import { computeDealMetrics } from '../engine/compute';
import { scenarioShortLabel } from '../compare/compareTypes';

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
const withPatch = (d: any, patch: Record<string, any>) => ({ ...d, inputs: { ...d.inputs, ...patch } });

describe('committing a plan to the live deal', () => {
  it('sets the live remodel, removes the plan, and records what was committed', () => {
    const d = deal({ remodelPlans: [plan(), plan({ id: 'p2', name: 'Other' })] });
    const r = commitRemodelPatch(d, plan(), new Date('2026-03-01T00:00:00Z'));
    if (!r.ok) throw new Error(r.reason);
    expect((r.patch.remodel as any).rentUpliftMonthly).toBe(8000);
    expect((r.patch.remodelPlans as RemodelPlan[]).map((p) => p.id)).toEqual(['p2']);
    expect(getCommittedRemodel(withPatch(d, r.patch))?.plan.name).toBe('Rear expansion');
  });

  it('the live numbers then match what the evaluation promised, and the committed deal is not evaluated again', () => {
    const d = deal();
    const ev = evaluateRemodel(d, plan());
    if (!ev.ok) throw new Error(ev.reason);
    const r = commitRemodelPatch(d, plan());
    if (!r.ok) throw new Error(r.reason);
    const live = withPatch(d, r.patch);
    expect(computeDealMetrics(live).irr).toBe(ev.after.irr);
    expect(evaluateRemodel(live, plan({ id: 'p9' }))).toMatchObject({ ok: false });
  });

  it('only one remodel can be committed at a time', () => {
    const live = withPatch(deal(), (commitRemodelPatch(deal(), plan()) as any).patch);
    expect(commitRemodelPatch(live, plan({ id: 'p2' }))).toMatchObject({ ok: false });
  });

  it('refuses a plan with no cost', () => {
    expect(commitRemodelPatch(deal(), plan({ cost: 0 }))).toMatchObject({ ok: false });
  });

  it('moving it back restores the original numbers and returns the plan to the list', () => {
    const d = deal();
    const live = withPatch(d, (commitRemodelPatch(d, plan()) as any).patch);
    const back = uncommitRemodelPatch(live);
    if (!back.ok) throw new Error(back.reason);
    const restored = withPatch(live, back.patch);
    expect(computeDealMetrics(restored)).toEqual(computeDealMetrics(d));
    expect(getRemodelPlans(restored).map((p) => p.id)).toEqual(['p1']);
    expect(getCommittedRemodel(restored)).toBeNull();
    expect(uncommitRemodelPatch(d)).toMatchObject({ ok: false });
  });
});

describe('compare columns', () => {
  it('a remodel column is labelled with its plan name', () => {
    expect(scenarioShortLabel({ scenarioType: 'remodel', scenarioName: 'Rear expansion' })).toBe('Remodel: Rear expansion');
  });
});
