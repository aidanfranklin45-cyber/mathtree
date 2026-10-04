import { describe, it, expect } from 'vitest';
import { blankPlan, missingForPlan, nextMonth, numToText, parseNumInput, plansAfterDelete, plansAfterSave } from './form';
import { evaluateRemodel, commitRemodelPatch } from './index';
import { withLegacyDefaults } from '../engine/testInputs';

const good = () => ({ ...blankPlan('a'), name: 'Bar', cost: 100000, rentAfter: { mode: 'monthly' as const, value: 30000 } });

describe('number boxes', () => {
  it('can type decimals and a leading zero without the box eating them', () => {
    // every keystroke of "0.5", "6.", "6.25" must be representable and parse sensibly
    for (const [typed, n] of [['0', 0], ['0.', 0], ['0.5', 0.5], ['6.', 6], ['6.25', 6.25], ['-', 0], ['.', 0], ['', 0], ['  12 ', 12], ['abc', 0]] as const) {
      expect(parseNumInput(typed)).toBe(n);
    }
  });
  it('zero shows as an empty box so it can be retyped', () => {
    expect(numToText(0)).toBe('');
    expect(numToText(undefined)).toBe('');
    expect(numToText(12.5)).toBe('12.5');
  });
});

describe('new plans', () => {
  it('start next month, including across a year end', () => {
    expect(nextMonth(new Date(2026, 9, 2))).toBe('2026-11');
    expect(nextMonth(new Date(2026, 11, 31))).toBe('2027-01');
    expect(blankPlan('x', new Date(2026, 9, 2)).startDate).toBe('2026-11');
  });
  it('a blank plan says what is missing, and a filled one says nothing', () => {
    expect(missingForPlan(blankPlan('x'))).toEqual(['the cost', 'the new rent']);
    expect(missingForPlan(good())).toEqual([]);
  });
});

describe('what is missing, by rent mode', () => {
  it('names the right field', () => {
    const p = good();
    expect(missingForPlan({ ...p, rentAfter: { mode: 'pct_increase', value: 0 } })).toEqual(['the % increase']);
    expect(missingForPlan({ ...p, rentAfter: { mode: 'per_sf', value: 24 } })).toEqual(['the added sq ft']);
    expect(missingForPlan({ ...p, rentAfter: { mode: 'per_sf', value: 0, addedSf: 100 } })).toEqual(['the $ per sf']);
    expect(missingForPlan({ ...p, name: ' ', startDate: '' })).toEqual(['a name', 'a start month']);
  });
  it('a manual value needs no rent, but does need the value', () => {
    const p = { ...good(), valueMode: 'manual' as const, rentAfter: { mode: 'monthly' as const, value: 0 } };
    expect(missingForPlan(p)).toEqual(['the value after']);
    expect(missingForPlan({ ...p, manualValue: 3000000 })).toEqual([]);
  });
  it('rejects an impossible borrowed share', () => {
    expect(missingForPlan({ ...good(), financing: 'new_loan', ltcPct: 150 })).toEqual(['a borrowed share between 0 and 100']);
  });
});

describe('saving and deleting', () => {
  const a = { ...good(), id: 'a' };
  const b = { ...good(), id: 'b', name: 'B' };
  it('save adds a new plan and replaces an existing one in place', () => {
    expect(plansAfterSave([a], b).map((p) => p.id)).toEqual(['a', 'b']);
    expect(plansAfterSave([a, b], { ...a, name: 'Renamed' }).map((p) => p.name)).toEqual(['Renamed', 'B']);
  });
  it('delete removes it and picks the next plan to show, or none', () => {
    expect(plansAfterDelete([a, b], 'a')).toMatchObject({ next: { id: 'b' } });
    expect(plansAfterDelete([a], 'a')).toEqual({ plans: [], next: null });
    expect(plansAfterDelete([a], 'zzz').plans).toHaveLength(1);
  });
});

describe('the form agrees with the evaluator and committer', () => {
  const owned: any = {
    id: 'd', status: 'owned', asset_class: 'commercial', purchase_price: 2400000,
    inputs: withLegacyDefaults('commercial', { purchasePrice: 2400000, downPaymentPercent: 30, interestRate: 6, loanTerm: 25, exitYear: 10, holdingPeriod: 10, closingDate: '2022-01-01',
      vacancyRate: 5, expenseRatio: 30, expenseGrowth: 0, targetCapRate: 7, discountRate: 8, rentGrowth: 0, grossRentAnnual: 240000 }),
  };
  it('a plan with nothing missing can be evaluated and committed (the buttons would be live)', () => {
    const p = good();
    expect(missingForPlan(p)).toEqual([]);
    expect(evaluateRemodel(owned, p).ok).toBe(true);
    expect(commitRemodelPatch(owned, p).ok).toBe(true);
  });
  it('a plan with something missing is also refused by the evaluator (so the hint is never wrong)', () => {
    for (const p of [blankPlan('x'), { ...good(), cost: 0 }, { ...good(), rentAfter: { mode: 'monthly' as const, value: 0 } }]) {
      expect(missingForPlan(p).length).toBeGreaterThan(0);
      expect(evaluateRemodel(owned, p).ok).toBe(false);
    }
  });
});
