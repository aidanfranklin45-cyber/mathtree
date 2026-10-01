/**
 * Underwriting scenarios ("What if I buy at this price? What if the loan is at this rate?").
 *
 * Only the INPUTS of each run are stored (deal_parameter_history.inputs plus name/notes/baseline).
 * Everything analytical (which parameters moved, how IRR / cash flow / DSCR changed) is computed here
 * on demand by running the shared engine on each run's inputs, so history can never go stale when the
 * model improves, and no metrics or diffs are ever written to the database.
 */
import { supabase } from './supabase/client';
import { computeDealMetrics } from './engine/compute';
import type { DealInputs, DealMetrics, DealRecord } from './math/types';

export const MAX_AUTO_RUNS = 5;

export interface ScenarioRun {
  id: string;
  deal_id: string;
  user_id?: string | null;
  name: string;
  category?: string | null;
  notes?: string | null;
  inputs: DealInputs;
  is_baseline?: boolean | null;
  is_auto_run?: boolean | null;
  created_at: string;
}

export interface DiffItem {
  key: string;
  label: string;
  oldValue: number | null;
  newValue: number | null;
  delta: number | null;
  isCurrency?: boolean;
  isPct?: boolean;
  suffix?: string;
}

export interface ScenarioRunView extends ScenarioRun {
  /** Position from the oldest kept run (1 = first). */
  runNumber: number;
  /** Parameters that moved versus the previous run (empty for the first run). */
  inputDiff: DiffItem[];
  /** Return metrics that moved versus the previous run, recomputed from inputs with the current engine. */
  metricDiff: DiffItem[];
  /** Metrics for this run (computed, never stored). */
  metrics: DealMetrics | null;
}

/** Parameters worth tracking as "what changed", using the engine's own input names. */
const INPUT_KEYS: Array<Omit<DiffItem, 'oldValue' | 'newValue' | 'delta'> & { keys: string[] }> = [
  { key: 'purchasePrice', keys: ['purchasePrice'], label: 'Purchase Basis', isCurrency: true },
  { key: 'downPaymentPercent', keys: ['downPaymentPercent'], label: 'Down Payment', isPct: true },
  { key: 'interestRate', keys: ['interestRate'], label: 'Interest Rate', isPct: true },
  { key: 'loanTerm', keys: ['loanTerm', 'loanTermYears'], label: 'Loan Term', suffix: ' yrs' },
  { key: 'grossRentAnnual', keys: ['grossRentAnnual'], label: 'Gross Annual Rent', isCurrency: true },
  { key: 'monthlyRent', keys: ['monthlyRent', 'grossRentPerMonth'], label: 'Gross Monthly Rent', isCurrency: true },
  { key: 'vacancyRate', keys: ['vacancyRate'], label: 'Vacancy Rate', isPct: true },
  { key: 'expenseRatio', keys: ['expenseRatio', 'operatingExpenseRatio'], label: 'Expense Ratio', isPct: true },
  { key: 'expenseGrowth', keys: ['expenseGrowth', 'expenseInflation', 'expenseGrowthRate', 'expenseGrowthPercent'], label: 'Expense Inflation', isPct: true },
  { key: 'rehabCosts', keys: ['rehabCosts', 'rehabBudget'], label: 'Rehab / CapEx', isCurrency: true },
  { key: 'closingCosts', keys: ['closingCosts'], label: 'Closing Costs', isCurrency: true },
  { key: 'targetCapRate', keys: ['targetCapRate', 'targetExitCapRate', 'exitCapRate'], label: 'Exit Cap Rate', isPct: true },
  { key: 'appreciationRate', keys: ['appreciationRate'], label: 'Appreciation', isPct: true },
  { key: 'rentGrowth', keys: ['rentGrowth'], label: 'Rent Growth', isPct: true },
  { key: 'exitYear', keys: ['exitYear'], label: 'Hold Period', suffix: ' yrs' },
];

const METRIC_KEYS: Array<Omit<DiffItem, 'oldValue' | 'newValue' | 'delta'> & { get: (m: DealMetrics) => unknown }> = [
  { key: 'irr', label: 'Target IRR', isPct: true, get: (m) => m.irr },
  { key: 'cashOnCash', label: 'Cash-on-Cash Return', isPct: true, get: (m) => m.cashOnCash },
  { key: 'year1CashFlow', label: 'Net Cash Flow (Yr 1)', isCurrency: true, get: (m) => m.year1Cashflow },
  { key: 'capRate', label: 'Cap Rate Yield', isPct: true, get: (m) => m.capRate },
  { key: 'equityMultiple', label: 'Equity Multiple', suffix: 'x', get: (m) => m.equityMultiplier },
  { key: 'dscr', label: 'DSCR', suffix: 'x', get: (m) => (typeof m.dscr === 'number' ? m.dscr : Number(m.dscr)) },
];

const numOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const pick = (inputs: Record<string, any>, keys: string[]): number | null => {
  for (const k of keys) {
    const v = numOrNull(inputs?.[k]);
    if (v !== null) return v;
  }
  return null;
};

/** Which tracked parameters differ between two input sets. */
export function diffInputs(prev: Record<string, any> | null | undefined, next: Record<string, any>): DiffItem[] {
  if (!prev) return [];
  const out: DiffItem[] = [];
  for (const spec of INPUT_KEYS) {
    const oldValue = pick(prev, spec.keys);
    const newValue = pick(next, spec.keys);
    if (oldValue !== null && newValue !== null && Math.abs(oldValue - newValue) > 0.001) {
      out.push({ key: spec.key, label: spec.label, oldValue, newValue, delta: newValue - oldValue, isCurrency: spec.isCurrency, isPct: spec.isPct, suffix: spec.suffix });
    } else if (oldValue === null && newValue !== null) {
      out.push({ key: spec.key, label: spec.label, oldValue: null, newValue, delta: null, isCurrency: spec.isCurrency, isPct: spec.isPct, suffix: spec.suffix });
    }
  }
  return out;
}

/** How the return metrics moved between two metric sets. */
export function diffMetrics(prev: DealMetrics | null, next: DealMetrics | null): DiffItem[] {
  if (!prev || !next) return [];
  const out: DiffItem[] = [];
  for (const spec of METRIC_KEYS) {
    const oldValue = numOrNull(spec.get(prev));
    const newValue = numOrNull(spec.get(next));
    if (oldValue !== null && newValue !== null && Math.abs(oldValue - newValue) > 0.001) {
      out.push({ key: spec.key, label: spec.label, oldValue, newValue, delta: newValue - oldValue, isCurrency: spec.isCurrency, isPct: spec.isPct, suffix: spec.suffix });
    }
  }
  return out;
}

/** "Run: Interest Rate (+0.50%)" style name from what changed. */
export function nameRun(diff: DiffItem[]): string {
  const fmt = (d: DiffItem) => {
    if (d.delta === null) return 'set';
    const sign = d.delta > 0 ? '+' : '';
    if (d.isCurrency) return `${d.delta < 0 ? '-' : '+'}$${Math.abs(Math.round(d.delta)).toLocaleString()}`;
    if (d.isPct) return `${sign}${d.delta.toFixed(2)}%`;
    return `${sign}${d.delta}${d.suffix || ''}`;
  };
  if (diff.length === 0) return `Run #${Date.now().toString().slice(-4)}`;
  if (diff.length === 1) return `Run: ${diff[0].label} (${fmt(diff[0])})`;
  if (diff.length === 2) return `Run: ${diff[0].label} (${fmt(diff[0])}) & ${diff[1].label} (${fmt(diff[1])})`;
  const labels = diff.slice(0, 3).map((d) => d.label).join(', ');
  return `Run: Multi-Param (${labels}${diff.length > 3 ? ` +${diff.length - 3}` : ''})`;
}

/** Attach computed diffs and metrics to runs (newest first in, newest first out). */
export function withComputedDiffs(deal: Pick<DealRecord, 'asset_class' | 'purchase_price' | 'inputs'>, runs: ScenarioRun[]): ScenarioRunView[] {
  const safeMetrics = (inputs: DealInputs): DealMetrics | null => {
    try {
      return computeDealMetrics({ ...deal, inputs });
    } catch {
      return null;
    }
  };
  const computed = runs.map((r) => ({ run: r, metrics: safeMetrics(r.inputs) }));
  const total = runs.length;
  return computed.map(({ run, metrics }, i) => {
    const prev = computed[i + 1];
    return {
      ...run,
      runNumber: total - i,
      metrics,
      inputDiff: prev ? diffInputs(prev.run.inputs, run.inputs) : [],
      metricDiff: prev ? diffMetrics(prev.metrics, metrics) : [],
    };
  });
}

/** Newest runs first. Reads the table directly (row-level security scopes it to the owner / permitted collaborators). */
export async function listScenarioRuns(dealId: string, limit = 25): Promise<ScenarioRun[]> {
  const { data, error } = await supabase
    .from('deal_parameter_history')
    .select('id, deal_id, user_id, name, category, notes, inputs, is_baseline, is_auto_run, created_at')
    .eq('deal_id', dealId)
    .not('inputs', 'is', null)
    .neq('name', '[object Object]')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as unknown as ScenarioRun[];
}

export type RecordResult = 'recorded' | 'no_change' | 'frozen_owned' | 'error';

/**
 * Auto-record the deal's current inputs as a run when a tracked parameter actually changed.
 * Owned assets are frozen (their baseline is the acquired underwriting). Stores inputs only.
 */
export async function recordScenarioRun(
  deal: Pick<DealRecord, 'id' | 'status' | 'inputs'>,
  opts: { name?: string; notes?: string; category?: string; baseline?: boolean; force?: boolean } = {},
): Promise<RecordResult> {
  if (deal.status === 'owned' && !opts.force) return 'frozen_owned';
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return 'error';

    const last = (await listScenarioRuns(deal.id, 1))[0];
    const diff = last ? diffInputs(last.inputs, deal.inputs) : [];
    if (last && diff.length === 0 && !opts.name) return 'no_change';

    const { error } = await supabase.from('deal_parameter_history').insert({
      deal_id: deal.id,
      user_id: uid,
      name: opts.name?.trim() || (last ? nameRun(diff) : 'Baseline Underwriting'),
      category: opts.category || 'financing',
      notes: opts.notes ?? null,
      inputs: deal.inputs as any,
      is_baseline: !!opts.baseline || !last,
      is_auto_run: !opts.name,
    } as any);
    if (error) throw error;

    // Keep only the newest MAX_AUTO_RUNS automatic runs (named snapshots are never pruned)
    const { data: autos } = await supabase
      .from('deal_parameter_history')
      .select('id')
      .eq('deal_id', deal.id)
      .eq('is_auto_run', true)
      .order('created_at', { ascending: false });
    if (autos && autos.length > MAX_AUTO_RUNS) {
      await supabase.from('deal_parameter_history').delete().in('id', autos.slice(MAX_AUTO_RUNS).map((r: any) => r.id));
    }
    return 'recorded';
  } catch (err) {
    console.warn('[scenarios] could not record run:', err);
    return 'error';
  }
}

export async function deleteScenarioRun(id: string): Promise<boolean> {
  const { error } = await supabase.from('deal_parameter_history').delete().eq('id', id);
  return !error;
}
