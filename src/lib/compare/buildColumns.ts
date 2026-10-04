import type { DealInputs, DealRecord } from '../math/types';
import { resolveDealDisplayName } from '../math/pointInTime';
import {
  ComparisonColumn,
  MergedColumnNote,
  ScenarioPresetType,
  columnFingerprint,
  extractComparisonSummary,
  getPresetOverrides,
  mergeIdenticalColumns,
} from './compareTypes';
import { BoardEntry, CompareConfig, MAX_BOARD_ENTRIES, ScenarioKey } from './config';
import { applyRemodel, getRemodelPlans } from '../remodel';
import { listScenarioRuns } from '../scenarios';
import { getInitialBaseline } from '../baselines/db';
import { baselineEngineDriftNote, baselineHeading, dealFromBaseline } from './baselineColumn';

const DEFAULT_NAMES: Record<ScenarioPresetType, string> = {
  live: 'Live Model',
  baseline: 'Acquisition Baseline',
  bull: 'Bull Case (+8% Rent)',
  bear: 'Bear Case (-8% Rent, +3% Vac)',
  history: 'Saved Run',
  remodel: 'Remodel',
  custom: 'Custom',
};

/** Which preset type a scenario key belongs to (what the engine and the column badges understand). */
export function presetTypeOf(key: ScenarioKey): ScenarioPresetType {
  if (key === 'live' || key === 'baseline' || key === 'bull' || key === 'bear') return key;
  if (key.startsWith('remodel:')) return 'remodel';
  if (key.startsWith('run:')) return 'history';
  return 'custom';
}

let columnSeq = 0;

/** One computed column for a deal under one scenario. The math is the shared engine; nothing is stored. */
export function buildColumn(
  deal: DealRecord,
  scenarioType: ScenarioPresetType,
  scenarioName?: string,
  customOverrides?: Partial<DealInputs>,
  isBenchmark = false,
  scenarioKey?: string,
): ComparisonColumn {
  const overrides = customOverrides ?? getPresetOverrides(scenarioType, deal.inputs || {});
  const { metrics, summary } = extractComparisonSummary(deal, overrides);
  return {
    id: `${deal.id}-${scenarioType}-${++columnSeq}-${Math.random().toString(36).slice(2, 6)}`,
    dealId: deal.id,
    dealTitle: resolveDealDisplayName(deal),
    assetClass: String(deal.asset_class || deal.assetType || 'single-family'),
    status: deal.status === 'owned' ? 'owned' : 'prospect',
    location: deal.location || deal.address || 'Yakima, WA',
    scenarioName: scenarioName || DEFAULT_NAMES[scenarioType],
    scenarioType,
    scenarioKey: scenarioKey ?? scenarioType,
    overrides,
    deal,
    metrics,
    summary,
    isBenchmark,
  };
}

// ---------------------------------------------------------------------------
// What can be added for a deal
// ---------------------------------------------------------------------------

export interface ScenarioOption {
  key: ScenarioKey;
  label: string;
  hint?: string;
}

/** Choices that need no lookup: always available for any deal. */
export function baseScenarioOptions(deal: DealRecord): ScenarioOption[] {
  const opts: ScenarioOption[] = [
    { key: 'live', label: 'Live model', hint: 'Today\'s underwriting' },
    { key: 'bull', label: 'Bull case', hint: '+8% rent, lower vacancy' },
    { key: 'bear', label: 'Bear case', hint: '-8% rent, +3% vacancy, higher rate' },
  ];
  if (deal.status === 'owned' && !deal.inputs?.remodel) {
    for (const plan of getRemodelPlans(deal)) opts.push({ key: `remodel:${plan.id}`, label: plan.name || 'Remodel', hint: 'Remodel plan' });
  }
  return opts;
}

/** Choices that need the database: the recorded acquisition baseline (owned deals) and saved runs. */
export async function loadExtraScenarioOptions(deal: DealRecord): Promise<ScenarioOption[]> {
  const owned = deal.status === 'owned';
  const [runs, baseline] = await Promise.all([
    listScenarioRuns(deal.id, 3).catch(() => []),
    owned ? getInitialBaseline(deal.id).catch(() => null) : Promise.resolve(null),
  ]);
  const out: ScenarioOption[] = [];
  if (baseline) out.push({ key: 'baseline', label: 'Acquisition baseline', hint: baselineHeading(baseline) });
  for (const run of runs ?? []) out.push({ key: `run:${run.id}`, label: run.name || 'Saved run', hint: 'Saved run' });
  return out;
}

// ---------------------------------------------------------------------------
// Entries to columns
// ---------------------------------------------------------------------------

/** Build the column an entry stands for, or null (with a reason) when it no longer exists. */
export async function columnForEntry(deal: DealRecord, entry: BoardEntry): Promise<{ column: ComparisonColumn | null; missing?: string }> {
  const title = resolveDealDisplayName(deal);
  const key = entry.scenario;
  if (key === 'live' || key === 'bull' || key === 'bear') return { column: buildColumn(deal, key, undefined, undefined, false, key) };
  if (key === 'baseline') {
    const row = await getInitialBaseline(deal.id).catch(() => null);
    if (!row) return { column: null, missing: `${title} has no recorded acquisition baseline.` };
    return { column: buildColumn(dealFromBaseline(deal, row), 'baseline', baselineHeading(row), undefined, false, key) };
  }
  if (key === 'whatif') {
    return { column: buildColumn(deal, 'custom', entry.name || 'What-If', entry.overrides ?? {}, false, key) };
  }
  if (key.startsWith('remodel:')) {
    const plan = getRemodelPlans(deal).find((p) => p.id === key.slice(8));
    if (!plan) return { column: null, missing: `${title}: that remodel plan no longer exists.` };
    try {
      return { column: buildColumn(deal, 'remodel', plan.name || 'Remodel', applyRemodel(deal, plan), false, key) };
    } catch {
      return { column: null, missing: `${title}: the remodel plan could not be modeled.` };
    }
  }
  if (key.startsWith('run:')) {
    const runs = await listScenarioRuns(deal.id, 25).catch(() => []);
    const run = runs.find((r) => r.id === key.slice(4));
    if (!run) return { column: null, missing: `${title}: that saved run is no longer available.` };
    return { column: buildColumn(deal, 'history', run.name || 'Saved Run', run.inputs, false, key) };
  }
  return { column: null, missing: `${title}: unknown scenario.` };
}

/**
 * Rebuild a saved or shared board against the deals the viewer can see. Entries whose deal or scenario is gone are skipped and
 * reported, so a board never silently shows less than it says.
 */
export async function columnsForConfig(
  config: CompareConfig,
  deals: DealRecord[],
): Promise<{ columns: ComparisonColumn[]; missing: string[] }> {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const missing: string[] = [];
  const results = await Promise.all(
    config.entries.slice(0, MAX_BOARD_ENTRIES).map(async (entry) => {
      const deal = byId.get(entry.dealId);
      if (!deal) {
        missing.push('A property in this comparison is not available to you.');
        return null;
      }
      const r = await columnForEntry(deal, entry);
      if (!r.column && r.missing) missing.push(r.missing);
      return r.column;
    }),
  );
  const columns = results.filter((c): c is ComparisonColumn => !!c);
  if (columns.length > 0) {
    const benchIdx = config.benchmark !== null ? results.findIndex((_, i) => i === config.benchmark) : -1;
    const bench = benchIdx >= 0 && results[benchIdx] ? results[benchIdx]! : columns[0];
    columns.forEach((c) => { c.isBenchmark = c === bench; });
  }
  return { columns, missing: Array.from(new Set(missing)) };
}

/** The board as plain settings, ready to save or put in a link. */
export function configFromColumns(columns: ComparisonColumn[], metrics: string[], view: CompareConfig['view']): CompareConfig {
  const entries: BoardEntry[] = columns.map((c) => {
    const key = c.scenarioKey ?? c.scenarioType;
    const e: BoardEntry = { dealId: c.dealId, scenario: key };
    if (key === 'whatif') {
      e.name = c.scenarioName;
      e.overrides = c.overrides;
    }
    return e;
  });
  const bench = columns.findIndex((c) => c.isBenchmark);
  return { v: 1, entries, metrics, view, benchmark: bench >= 0 ? bench : null };
}

/**
 * Every standard version of one deal on one board: live, recorded baseline (owned), remodel plans, bull, bear and saved runs,
 * with identical results folded into one column. Used by "One deal, different scenarios" and by old ?dealId= links.
 */
export async function buildScenarioSet(
  deal: DealRecord,
): Promise<{ columns: ComparisonColumn[]; notes: MergedColumnNote[]; infos: string[] }> {
  const owned = deal.status === 'owned';
  const [runs, baselineRow] = await Promise.all([
    listScenarioRuns(deal.id, 3).catch(() => []),
    owned ? getInitialBaseline(deal.id).catch(() => null) : Promise.resolve(null),
  ]);

  const infos: string[] = [];
  const cols: ComparisonColumn[] = [buildColumn(deal, 'live', 'Live Model', undefined, true, 'live')];

  if (owned) {
    if (baselineRow) {
      const baseCol = buildColumn(dealFromBaseline(deal, baselineRow), 'baseline', baselineHeading(baselineRow), undefined, false, 'baseline');
      cols.push(baseCol);
      const drift = baselineEngineDriftNote(baselineRow, baseCol.summary.irr);
      if (drift) infos.push(drift);
    } else if (deal.is_demo || deal.is_shared) {
      infos.push('Acquisition baselines are only recorded for deals you own (not sample or shared deals), so there is no baseline column here.');
    } else {
      infos.push('No acquisition baseline has been recorded for this property yet, so there is no baseline column. Open it in the Deal Studio to record one.');
    }
    if (!deal.inputs?.remodel) {
      for (const plan of getRemodelPlans(deal)) {
        try {
          cols.push(buildColumn(deal, 'remodel', plan.name || 'Remodel', applyRemodel(deal, plan), false, `remodel:${plan.id}`));
        } catch (err) {
          console.warn('[compare] could not model remodel plan', plan.id, err);
        }
      }
    }
  }

  cols.push(buildColumn(deal, 'bull', undefined, undefined, false, 'bull'), buildColumn(deal, 'bear', undefined, undefined, false, 'bear'));
  for (const run of runs ?? []) cols.push(buildColumn(deal, 'history', run.name || 'Historical Run', run.inputs, false, `run:${run.id}`));

  const merged = mergeIdenticalColumns(cols);
  return { columns: merged.columns, notes: merged.notes, infos };
}

/** An existing column with the same results as this one (same deal), if any: adding it would only repeat a column. */
export function findTwin(columns: ComparisonColumn[], candidate: ComparisonColumn): ComparisonColumn | undefined {
  const print = columnFingerprint(candidate);
  return columns.find((c) => columnFingerprint(c) === print);
}
