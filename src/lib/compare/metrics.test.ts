import { describe, it, expect } from 'vitest';
import { ALL_METRICS, CORE_METRIC_KEYS, METRIC_SETS, bestColumnId, formatVariance, getMetric, groupsForKeys, matchingMetricSet, normalizeMetricKeys, rankColumns } from './metrics';
import type { ComparisonSummary } from './compareTypes';

const summary = (over: Partial<ComparisonSummary>): ComparisonSummary => ({
  purchasePrice: 1_000_000, initialCash: 250_000, loanAmount: 750_000, interestRate: 6.5, loanTerm: 30, monthlyDebt: 4000, annualDebt: 48_000,
  grossRentAnnual: 120_000, grossRentMonthly: 10_000, vacancyRate: 5, operatingExpenses: 40_000, expenseRatio: 33, noi: 74_000, dscr: 1.5,
  cashFlowYear1: 26_000, capRateYear1: 7.4, exitCapRate: 6, cashOnCashYear1: 10.4, blendedCoC: 11, irr: 12, equityMultiple: 2, npv: 50_000,
  tenYearCashFlow: 300_000, tenYearTerminalValue: 1_400_000, totalWealthCreated: 600_000, ...over,
});
const col = (id: string, over: Partial<ComparisonSummary>) => ({ id, summary: summary(over) });

describe('compare metrics', () => {
  it('has unique keys and every set only names known metrics', () => {
    const keys = ALL_METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of METRIC_SETS) for (const k of s.keys) expect(getMetric(k)).toBeDefined();
  });

  it('drops unknown keys and falls back to Core when nothing valid is left', () => {
    expect(normalizeMetricKeys(['irr', 'nope', 'irr', 'dscr'])).toEqual(['irr', 'dscr']);
    expect(normalizeMetricKeys(['nope'])).toEqual(CORE_METRIC_KEYS);
    expect(normalizeMetricKeys('irr')).toEqual(CORE_METRIC_KEYS);
  });

  it('recognises a ready-made set regardless of order, and a custom pick as none', () => {
    expect(matchingMetricSet([...CORE_METRIC_KEYS].reverse())?.id).toBe('core');
    expect(matchingMetricSet(['irr'])).toBeNull();
  });

  it('narrows groups to the selected metrics and drops empty groups', () => {
    const groups = groupsForKeys(['irr', 'dscr']);
    expect(groups.map((g) => g.id)).toEqual(['returns', 'operations']);
    expect(groups.flatMap((g) => g.metrics.map((m) => m.key))).toEqual(['irr', 'dscr']);
  });

  it('writes variances the way the metric is read', () => {
    expect(formatVariance(getMetric('irr')!, 1.5)).toBe('+1.50%');
    expect(formatVariance(getMetric('npv')!, -2500.4)).toBe('-$2,500');
    expect(formatVariance(getMetric('equityMultiple')!, 0.25)).toBe('+0.25');
  });

  it('picks the best column, treating lower as better for cost metrics and ignoring missing values', () => {
    const cols = [col('a', { irr: 10, purchasePrice: 900_000, dscr: null }), col('b', { irr: 14, purchasePrice: 1_100_000, dscr: 1.3 })];
    expect(bestColumnId(getMetric('irr')!, cols)).toBe('b');
    expect(bestColumnId(getMetric('purchasePrice')!, cols)).toBe('a');
    expect(bestColumnId(getMetric('dscr')!, cols)).toBe('b');
  });

  it('ranks best first, worst first on request, with missing values last and ties kept in order', () => {
    const cols = [col('a', { irr: 10 }), col('b', { irr: 14 }), col('c', { irr: 10 }), col('d', { irr: 12 })];
    expect(rankColumns(cols, getMetric('irr')!).map((c) => c.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(rankColumns(cols, getMetric('irr')!, 'worst').map((c) => c.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(rankColumns([col('x', { dscr: null }), col('y', { dscr: 1.2 })], getMetric('dscr')!).map((c) => c.id)).toEqual(['y', 'x']);
    expect(rankColumns([col('x', { loanTerm: 30 }), col('y', { loanTerm: 15 })], getMetric('purchasePrice')!).map((c) => c.id)).toEqual(['x', 'y']);
  });
});
