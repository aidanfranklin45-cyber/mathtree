import type { ComparisonColumn } from './compareTypes';
import type { MetricDef } from './metrics';

/** Chart numbers as plain functions of the computed columns, so they can be tested without a canvas. */

type Proj = Record<string, any>;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const projections = (c: ComparisonColumn): Proj[] => ((c.metrics?.projections ?? []) as Proj[]);

export const MAX_CHART_YEARS = 10;

export function yearLabels(columns: ComparisonColumn[], withYearZero = false): string[] {
  const years = Math.min(MAX_CHART_YEARS, Math.max(1, ...columns.map((c) => projections(c).length || 0)));
  const labels = Array.from({ length: years }, (_, i) => `Yr ${i + 1}`);
  return withYearZero ? ['Start', ...labels] : labels;
}

/** Cash flow per year for one column: each year on its own, or running total. */
export function cashFlowSeries(c: ComparisonColumn, years: number, mode: 'annual' | 'cumulative'): Array<number | null> {
  const p = projections(c);
  let run = 0;
  return Array.from({ length: years }, (_, i) => {
    if (!p[i]) return null;
    const cf = num(p[i].cashFlow);
    run += cf;
    return Math.round(mode === 'annual' ? cf : run);
  });
}

/**
 * Net wealth by year: equity (value less loan) plus cash collected so far, less the cash put in. Starts at minus the cash invested,
 * so the line crosses zero in the year the deal has paid you back.
 */
export function wealthSeries(c: ComparisonColumn, years: number): Array<number | null> {
  const p = projections(c);
  const invested = num(c.summary.initialCash);
  let cum = 0;
  const out: Array<number | null> = [Math.round(-invested)];
  for (let i = 0; i < years; i++) {
    if (!p[i]) {
      out.push(null);
      continue;
    }
    cum += num(p[i].cashFlow);
    const equity = num(p[i].propertyValue) - num(p[i].endingLoanBalance ?? p[i].loanBalanceRemaining);
    out.push(Math.round(equity + cum - invested));
  }
  return out;
}

/** First year (1-based) net wealth is at or above zero, or null if it never gets there inside the horizon. */
export function paybackYear(series: Array<number | null>): number | null {
  for (let i = 1; i < series.length; i++) {
    const v = series[i];
    if (v !== null && v >= 0) return i;
  }
  return null;
}

/** A metric for every column, optionally as a change against the benchmark column. */
export function metricValues(
  columns: ComparisonColumn[],
  metric: MetricDef,
  mode: 'absolute' | 'vs-benchmark',
): Array<number | null> {
  const bench = columns.find((c) => c.isBenchmark) ?? columns[0];
  const base = bench ? metric.get(bench.summary) : null;
  return columns.map((c) => {
    const v = metric.get(c.summary);
    if (v === null || v === undefined || isNaN(v)) return null;
    if (mode === 'absolute') return v;
    return base === null || base === undefined ? null : v - base;
  });
}

export interface ScatterPoint {
  x: number;
  y: number;
  /** Bubble radius scaled between 6 and 22 by purchase price. */
  r: number;
  label: string;
}

/** Risk against return: leverage (LTV) across, IRR up, bubble size by price. Columns without an IRR are left out. */
export function riskReturnPoints(columns: ComparisonColumn[]): Array<ScatterPoint & { index: number }> {
  const prices = columns.map((c) => num(c.summary.purchasePrice));
  const max = Math.max(1, ...prices);
  const out: Array<ScatterPoint & { index: number }> = [];
  columns.forEach((c, index) => {
    const price = num(c.summary.purchasePrice);
    const ltv = price > 0 ? (num(c.summary.loanAmount) / price) * 100 : 0;
    out.push({ index, x: Math.round(ltv * 10) / 10, y: Math.round(num(c.summary.irr) * 100) / 100, r: 6 + Math.round((price / max) * 16), label: `${c.dealTitle} (${c.scenarioName})` });
  });
  return out;
}

/** The same colors every time for the same position, so a column keeps its color across charts and view changes. */
export const SERIES_COLORS = ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#f43f5e', '#3b82f6', '#84cc16', '#ec4899', '#14b8a6', '#eab308', '#a855f7', '#ef4444'];
export const seriesColor = (index: number): string => SERIES_COLORS[index % SERIES_COLORS.length];
