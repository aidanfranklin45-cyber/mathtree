import type { DealInputs, DealRecord } from '../math/types';
import { CORE_METRIC_KEYS, METRIC_SETS, normalizeMetricKeys } from './metrics';
import { dealScope } from './compareTypes';

/**
 * A comparison board as plain settings. It names deals and scenarios and the metrics to show, and never stores computed numbers,
 * so a saved board always reflects today's model (the repo rule: the database holds facts, the math runs on the fly).
 */

/** 'live' | 'baseline' | 'bull' | 'bear' | 'whatif' | 'remodel:<planId>' | 'run:<runId>' */
export type ScenarioKey = string;

export interface BoardEntry {
  dealId: string;
  scenario: ScenarioKey;
  /** Column name for what-if scenarios (other scenarios are named from their key). */
  name?: string;
  /** Input changes for what-if scenarios. */
  overrides?: Partial<DealInputs>;
}

export type CompareView = 'matrix' | 'charts';

export interface CompareConfig {
  v: 1;
  entries: BoardEntry[];
  metrics: string[];
  view: CompareView;
  /** Index into entries of the benchmark column, if one was chosen. */
  benchmark: number | null;
}

export const MAX_BOARD_ENTRIES = 12;

export function emptyConfig(): CompareConfig {
  return { v: 1, entries: [], metrics: [...CORE_METRIC_KEYS], view: 'matrix', benchmark: null };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accepts anything (a saved row, a pasted link) and returns a safe config. Unknown shapes become an empty board. */
export function normalizeConfig(raw: unknown): CompareConfig {
  if (!isRecord(raw)) return emptyConfig();
  const entries: BoardEntry[] = [];
  if (Array.isArray(raw.entries)) {
    for (const e of raw.entries) {
      if (!isRecord(e) || typeof e.dealId !== 'string' || typeof e.scenario !== 'string') continue;
      const entry: BoardEntry = { dealId: e.dealId, scenario: e.scenario };
      if (typeof e.name === 'string') entry.name = e.name.slice(0, 80);
      if (isRecord(e.overrides)) entry.overrides = e.overrides as Partial<DealInputs>;
      entries.push(entry);
      if (entries.length >= MAX_BOARD_ENTRIES) break;
    }
  }
  const bench = typeof raw.benchmark === 'number' && raw.benchmark >= 0 && raw.benchmark < entries.length ? raw.benchmark : null;
  return {
    v: 1,
    entries,
    metrics: normalizeMetricKeys(raw.metrics),
    view: raw.view === 'charts' ? 'charts' : 'matrix',
    benchmark: bench,
  };
}

/** Stable text for "is this the same board": used to spot unsaved changes and de-duplicate recents. */
export function configSignature(c: CompareConfig): string {
  const entries = c.entries.map((e) => `${e.dealId}:${e.scenario}:${e.name ?? ''}:${e.overrides ? JSON.stringify(e.overrides) : ''}`);
  return JSON.stringify([entries, [...c.metrics].sort(), c.view, c.benchmark]);
}

export function entryKey(e: Pick<BoardEntry, 'dealId' | 'scenario'>): string {
  return `${e.dealId}|${e.scenario}`;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export function encodeConfig(c: CompareConfig): string {
  const json = JSON.stringify(c);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeConfig(text: string | null | undefined): CompareConfig | null {
  if (!text) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(decodeURIComponent(escape(atob(padded))));
    const cfg = normalizeConfig(parsed);
    return cfg.entries.length > 0 ? cfg : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

export interface ComparePreset {
  id: string;
  label: string;
  description: string;
  /** The board for this preset from the user's deals, or null when they have nothing it applies to. */
  build: (deals: DealRecord[], irrOf: (d: DealRecord) => number) => CompareConfig | null;
}

const setKeys = (id: string): string[] => METRIC_SETS.find((s) => s.id === id)?.keys ?? CORE_METRIC_KEYS;
const live = (d: DealRecord): BoardEntry => ({ dealId: d.id, scenario: 'live' });

export const BUILT_IN_PRESETS: ComparePreset[] = [
  {
    id: 'pipeline-irr',
    label: 'Pipeline ranked by IRR',
    description: 'Your prospective deals, best return first.',
    build: (deals, irrOf) => {
      const pipe = deals.filter((d) => dealScope(d) === 'pipeline').sort((a, b) => irrOf(b) - irrOf(a)).slice(0, 8);
      return pipe.length ? { ...emptyConfig(), entries: pipe.map(live), metrics: setKeys('returns'), benchmark: 0 } : null;
    },
  },
  {
    id: 'owned-vs-baseline',
    label: 'Owned: live vs. acquisition baseline',
    description: 'How each property you own is doing against what you underwrote.',
    build: (deals) => {
      const owned = deals.filter((d) => dealScope(d) === 'owned' && !d.is_demo && !d.is_shared).slice(0, 4);
      if (!owned.length) return null;
      const entries = owned.flatMap((d): BoardEntry[] => [live(d), { dealId: d.id, scenario: 'baseline' }]);
      return { ...emptyConfig(), entries, metrics: setKeys('returns'), benchmark: null };
    },
  },
  {
    id: 'best-worst',
    label: 'Best vs. worst case for one deal',
    description: 'Live, bull and bear cases for your first pipeline deal (or first deal).',
    build: (deals) => {
      const d = deals.find((x) => dealScope(x) === 'pipeline') ?? deals[0];
      if (!d) return null;
      return {
        ...emptyConfig(),
        entries: [live(d), { dealId: d.id, scenario: 'bull' }, { dealId: d.id, scenario: 'bear' }],
        metrics: CORE_METRIC_KEYS,
        benchmark: 0,
      };
    },
  },
  {
    id: 'financing',
    label: 'Financing view',
    description: 'Capital stack and loan terms for your pipeline deals.',
    build: (deals) => {
      const pipe = deals.filter((d) => dealScope(d) === 'pipeline').slice(0, 6);
      return pipe.length ? { ...emptyConfig(), entries: pipe.map(live), metrics: setKeys('financing'), benchmark: 0 } : null;
    },
  },
];
