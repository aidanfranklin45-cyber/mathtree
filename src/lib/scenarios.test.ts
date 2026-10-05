import { describe, it, expect } from 'vitest';
import { diffInputs, nameRun, withComputedDiffs, type ScenarioRun } from './scenarios';
import { withLegacyDefaults } from './engine/testInputs';

const base = {
  purchasePrice: 300000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30,
  monthlyRent: 2600, vacancyRate: 5, expenseRatio: 35, rentGrowth: 3, appreciationRate: 3,
  closingCosts: 6000, exitYear: 10,
};
const deal: any = { asset_class: 'residential', purchase_price: 300000, inputs: withLegacyDefaults('residential', base) };

const run = (id: string, created: string, inputs: Record<string, any>): ScenarioRun =>
  ({ id, deal_id: 'd', name: id, inputs: withLegacyDefaults('residential', inputs) as any, created_at: created });

describe('scenario diffs are computed, not stored', () => {
  it('finds which parameters moved (and reads either input alias)', () => {
    const d = diffInputs(base, { ...base, interestRate: 7, purchasePrice: 290000 });
    expect(d.map((x) => x.key).sort()).toEqual(['interestRate', 'purchasePrice']);
    expect(d.find((x) => x.key === 'interestRate')!.delta).toBeCloseTo(0.5);
    expect(diffInputs({ ...base, loanTermYears: 30, loanTerm: undefined }, base)).toEqual([]);
  });

  it('a first run has no diff; ignores untracked fields', () => {
    expect(diffInputs(null, base)).toEqual([]);
    expect(diffInputs(base, { ...base, notes: 'x', tenantName: 'y' })).toEqual([]);
  });

  it('names runs from what changed', () => {
    expect(nameRun(diffInputs(base, { ...base, interestRate: 7 }))).toBe('Run: Interest Rate (+0.50%)');
    expect(nameRun(diffInputs(base, { ...base, purchasePrice: 290000 }))).toBe('Run: Purchase Basis (-$10,000)');
    expect(nameRun(diffInputs(base, { ...base, interestRate: 7, vacancyRate: 8, exitYear: 7 }))).toMatch(/^Run: Multi-Param/);
  });

  it('recomputes metric impacts with the engine: a higher rate lowers IRR and cash flow', () => {
    const runs = [
      run('r2', '2026-09-29T12:00:00Z', { ...base, interestRate: 8 }),
      run('r1', '2026-09-29T11:00:00Z', base),
    ];
    const [latest, first] = withComputedDiffs(deal, runs);
    expect(first.runNumber).toBe(1);
    expect(first.inputDiff).toEqual([]);
    expect(latest.runNumber).toBe(2);
    expect(latest.inputDiff.map((d) => d.key)).toEqual(['interestRate']);
    const irr = latest.metricDiff.find((d) => d.key === 'irr')!;
    const cf = latest.metricDiff.find((d) => d.key === 'year1CashFlow')!;
    expect(irr.delta!).toBeLessThan(0);
    expect(cf.delta!).toBeLessThan(0);
    expect(latest.metrics!.irr).toBeCloseTo(irr.newValue!, 5);
  });

  it('a purchase-price scenario changes returns without touching the stored deal', () => {
    const cheaper = withComputedDiffs(deal, [
      run('b', '2026-09-29T12:00:00Z', { ...base, purchasePrice: 270000 }),
      run('a', '2026-09-29T11:00:00Z', base),
    ])[0];
    expect(cheaper.metricDiff.find((d) => d.key === 'irr')!.delta!).toBeGreaterThan(0);
    expect(deal.inputs.purchasePrice).toBe(300000);
  });
});
