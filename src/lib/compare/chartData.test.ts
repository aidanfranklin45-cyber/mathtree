import { describe, it, expect } from 'vitest';
import { cashFlowSeries, metricValues, paybackYear, riskReturnPoints, seriesColor, wealthSeries, yearLabels } from './chartData';
import { getMetric } from './metrics';
import type { ComparisonColumn } from './compareTypes';

const col = (id: string, over: { irr?: number; price?: number; loan?: number; cash?: number; bench?: boolean; proj?: any[] }): ComparisonColumn =>
  ({
    id, dealId: id, dealTitle: id, scenarioName: 'Live', isBenchmark: over.bench,
    summary: { irr: over.irr ?? 10, purchasePrice: over.price ?? 1_000_000, loanAmount: over.loan ?? 750_000, initialCash: over.cash ?? 250_000 },
    metrics: { projections: over.proj ?? [] },
  }) as unknown as ComparisonColumn;

const proj = (n: number, cf: number, value: number, loan: number) => Array.from({ length: n }, (_, i) => ({ year: i + 1, cashFlow: cf, propertyValue: value + i * 20_000, endingLoanBalance: loan - i * 10_000 }));

describe('compare chart data', () => {
  it('labels years up to 10, with a Start label when asked', () => {
    const c = col('a', { proj: proj(12, 1, 1, 1) });
    expect(yearLabels([c])).toHaveLength(10);
    expect(yearLabels([col('b', { proj: proj(5, 1, 1, 1) })], true)).toEqual(['Start', 'Yr 1', 'Yr 2', 'Yr 3', 'Yr 4', 'Yr 5']);
  });

  it('gives cash flow each year or as a running total, with gaps for missing years', () => {
    const c = col('a', { proj: [{ cashFlow: 100 }, { cashFlow: -20 }, { cashFlow: 50 }] });
    expect(cashFlowSeries(c, 4, 'annual')).toEqual([100, -20, 50, null]);
    expect(cashFlowSeries(c, 4, 'cumulative')).toEqual([100, 80, 130, null]);
  });

  it('builds net wealth from minus the cash invested, and finds the payback year', () => {
    // Year 1: equity (1,000,000 - 750,000) + cash 10,000 - 250,000 = 10,000
    const c = col('a', { proj: proj(3, 10_000, 1_000_000, 750_000) });
    const w = wealthSeries(c, 3);
    expect(w[0]).toBe(-250_000);
    expect(w[1]).toBe(10_000);
    expect(w[2]).toBe(10_000 + 20_000 + 10_000 + 10_000);
    expect(paybackYear(w)).toBe(1);
    expect(paybackYear([-100, -50, null, -10])).toBeNull();
    expect(paybackYear([-100, -50, 5])).toBe(2);
  });

  it('reads a metric absolutely or against the benchmark column', () => {
    const cols = [col('a', { irr: 10 }), col('b', { irr: 14, bench: true }), col('c', { irr: 9 })];
    const irr = getMetric('irr')!;
    expect(metricValues(cols, irr, 'absolute')).toEqual([10, 14, 9]);
    expect(metricValues(cols, irr, 'vs-benchmark')).toEqual([-4, 0, -5]);
  });

  it('places columns by leverage and return with bigger bubbles for bigger prices', () => {
    const pts = riskReturnPoints([col('a', { irr: 12, price: 1_000_000, loan: 700_000 }), col('b', { irr: 8, price: 500_000, loan: 0 })]);
    expect(pts[0]).toMatchObject({ x: 70, y: 12, r: 22 });
    expect(pts[1]).toMatchObject({ x: 0, y: 8, r: 14 });
  });

  it('keeps a column its color by position and wraps around', () => {
    expect(seriesColor(0)).toBe(seriesColor(12));
    expect(seriesColor(0)).not.toBe(seriesColor(1));
  });
});
