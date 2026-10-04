import { describe, it, expect } from 'vitest';
import { NO_FILTERS, activeFilterCount, dealPassesFilters, filterChips, thresholdPasses } from './filters';
import type { ComparisonSummary } from './compareTypes';
import type { DealRecord } from '../math/types';

const deal = (over: Record<string, unknown>) => ({ id: 'd', status: 'prospect', title: 'Maple Court', asset_class: 'multi-unit', purchase_price: 1_200_000, location: 'Yakima, WA', ...over }) as unknown as DealRecord;
const sum = { irr: 14, dscr: 1.3 } as unknown as ComparisonSummary;

describe('compare filters', () => {
  it('passes everything with no filters', () => {
    expect(dealPassesFilters(deal({}), NO_FILTERS, null)).toBe(true);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it('filters by status using the same owned / pipeline / archived rule as the rest of Compare', () => {
    expect(dealPassesFilters(deal({ status: 'owned' }), { ...NO_FILTERS, status: 'pipeline' }, null)).toBe(false);
    expect(dealPassesFilters(deal({ status: 'owned' }), { ...NO_FILTERS, status: 'owned' }, null)).toBe(true);
    expect(dealPassesFilters(deal({ status: 'archived' }), { ...NO_FILTERS, status: 'pipeline' }, null)).toBe(false);
    expect(dealPassesFilters(deal({ status: 'archived' }), { ...NO_FILTERS, status: 'archived' }, null)).toBe(true);
  });

  it('filters by asset class, price range and search text', () => {
    expect(dealPassesFilters(deal({}), { ...NO_FILTERS, assetClasses: ['commercial'] }, null)).toBe(false);
    expect(dealPassesFilters(deal({}), { ...NO_FILTERS, assetClasses: ['multi-unit', 'commercial'] }, null)).toBe(true);
    expect(dealPassesFilters(deal({}), { ...NO_FILTERS, minPrice: 1_500_000 }, null)).toBe(false);
    expect(dealPassesFilters(deal({}), { ...NO_FILTERS, minPrice: 1_000_000, maxPrice: 1_300_000 }, null)).toBe(true);
    expect(dealPassesFilters(deal({}), { ...NO_FILTERS, text: 'yakima' }, null)).toBe(true);
    expect(dealPassesFilters(deal({}), { ...NO_FILTERS, text: 'spokane' }, null)).toBe(false);
  });

  it('applies metric thresholds only when the live summary is known', () => {
    const f = { ...NO_FILTERS, thresholds: [{ metric: 'irr', op: '>=' as const, value: 12 }] };
    expect(dealPassesFilters(deal({}), f, sum)).toBe(true);
    expect(dealPassesFilters(deal({}), { ...f, thresholds: [{ metric: 'irr', op: '>=' as const, value: 20 }] }, sum)).toBe(false);
    expect(dealPassesFilters(deal({}), f, null)).toBe(true);
    expect(thresholdPasses({ metric: 'dscr', op: '<=', value: 1.25 }, sum)).toBe(false);
    expect(thresholdPasses({ metric: 'nope', op: '>=', value: 1 }, sum)).toBe(true);
  });

  it('describes each applied filter as a chip that clears just itself', () => {
    const f = { ...NO_FILTERS, status: 'owned' as const, assetClasses: ['commercial'], minPrice: 500_000, maxPrice: 2_000_000, thresholds: [{ metric: 'irr', op: '>=' as const, value: 12 }] };
    const chips = filterChips(f);
    expect(chips.map((c) => c.label)).toEqual(['Owned', 'commercial', '$500k to $2M', 'IRR above 12%']);
    expect(activeFilterCount(f)).toBe(4);
    expect(chips[0].clear(f).status).toBe('all');
    expect(chips[2].clear(f)).toMatchObject({ minPrice: null, maxPrice: null });
    expect(chips[3].clear(f).thresholds).toEqual([]);
  });
});
