import { describe, it, expect } from 'vitest';
import { BUILT_IN_PRESETS, MAX_BOARD_ENTRIES, configSignature, decodeConfig, emptyConfig, encodeConfig, normalizeConfig } from './config';
import { CORE_METRIC_KEYS } from './metrics';
import type { DealRecord } from '../math/types';

const deal = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, title: id, ...extra }) as unknown as DealRecord;

describe('compare config', () => {
  it('starts as an empty board with the Core metrics', () => {
    const c = emptyConfig();
    expect(c.entries).toEqual([]);
    expect(c.metrics).toEqual(CORE_METRIC_KEYS);
  });

  it('turns any junk into a safe config', () => {
    expect(normalizeConfig(null).entries).toEqual([]);
    expect(normalizeConfig('x').entries).toEqual([]);
    const c = normalizeConfig({ entries: [{ dealId: 'a', scenario: 'live' }, { dealId: 5 }, { scenario: 'bull' }], metrics: ['bogus'], view: 'weird', benchmark: 9 });
    expect(c.entries).toEqual([{ dealId: 'a', scenario: 'live' }]);
    expect(c.metrics).toEqual(CORE_METRIC_KEYS);
    expect(c.view).toBe('matrix');
    expect(c.benchmark).toBeNull();
  });

  it('caps the board size', () => {
    const entries = Array.from({ length: MAX_BOARD_ENTRIES + 5 }, (_, i) => ({ dealId: `d${i}`, scenario: 'live' }));
    expect(normalizeConfig({ entries }).entries).toHaveLength(MAX_BOARD_ENTRIES);
  });

  it('round-trips through a link, including what-if inputs and non-ASCII names', () => {
    const c = normalizeConfig({
      entries: [{ dealId: 'a', scenario: 'live' }, { dealId: 'a', scenario: 'whatif', name: 'Café rate 7.5%', overrides: { interestRate: 7.5 } }],
      metrics: ['irr', 'dscr'], view: 'charts', benchmark: 1,
    });
    const text = encodeConfig(c);
    expect(text).not.toMatch(/[+/=]/);
    expect(decodeConfig(text)).toEqual(c);
  });

  it('rejects bad or empty links', () => {
    expect(decodeConfig(null)).toBeNull();
    expect(decodeConfig('not-a-board')).toBeNull();
    expect(decodeConfig(encodeConfig(emptyConfig()))).toBeNull();
  });

  it('gives the same signature for the same board and a different one when anything changes', () => {
    const a = normalizeConfig({ entries: [{ dealId: 'a', scenario: 'live' }], metrics: ['irr', 'dscr'] });
    const b = normalizeConfig({ entries: [{ dealId: 'a', scenario: 'live' }], metrics: ['dscr', 'irr'] });
    expect(configSignature(a)).toBe(configSignature(b));
    expect(configSignature(a)).not.toBe(configSignature({ ...a, view: 'charts' }));
    expect(configSignature(a)).not.toBe(configSignature({ ...a, entries: [{ dealId: 'a', scenario: 'bull' }] }));
  });

  describe('built-in presets', () => {
    const deals = [deal('p1', 'prospect'), deal('p2', 'prospect'), deal('o1', 'owned'), deal('x1', 'archived'), deal('demo', 'owned', { is_demo: true })];
    const irr: Record<string, number> = { p1: 8, p2: 15 };
    const byId = (id: string) => BUILT_IN_PRESETS.find((p) => p.id === id)!;

    it('ranks the pipeline by IRR and leaves out owned and archived deals', () => {
      const c = byId('pipeline-irr').build(deals, (d) => irr[d.id] ?? 0)!;
      expect(c.entries.map((e) => e.dealId)).toEqual(['p2', 'p1']);
      expect(c.benchmark).toBe(0);
    });

    it('pairs each owned deal with its baseline and skips sample deals', () => {
      const c = byId('owned-vs-baseline').build(deals, () => 0)!;
      expect(c.entries).toEqual([{ dealId: 'o1', scenario: 'live' }, { dealId: 'o1', scenario: 'baseline' }]);
    });

    it('builds live, bull and bear for one deal, and is unavailable with no deals', () => {
      expect(byId('best-worst').build(deals, () => 0)!.entries.map((e) => `${e.dealId}:${e.scenario}`)).toEqual(['p1:live', 'p1:bull', 'p1:bear']);
      for (const p of BUILT_IN_PRESETS) expect(p.build([], () => 0)).toBeNull();
    });
  });
});
