import type { DealRecord } from '../math/types';
import { ComparisonSummary, dealScope } from './compareTypes';
import { getMetric } from './metrics';
import { resolveDealDisplayName } from '../math/pointInTime';

/** Narrows which deals the Add list offers. It never removes a column already on the board. */
export interface MetricThreshold {
  metric: string;
  op: '>=' | '<=';
  value: number;
}

export interface CompareFilters {
  status: 'all' | 'pipeline' | 'owned' | 'archived';
  /** Asset class names (lowercased). Empty = any. */
  assetClasses: string[];
  minPrice: number | null;
  maxPrice: number | null;
  text: string;
  thresholds: MetricThreshold[];
}

export const NO_FILTERS: CompareFilters = { status: 'all', assetClasses: [], minPrice: null, maxPrice: null, text: '', thresholds: [] };

export const dealAssetClass = (d: Pick<DealRecord, 'asset_class' | 'assetType'>): string => String(d.asset_class || d.assetType || 'single-family').toLowerCase();

export const dealPrice = (d: DealRecord): number => Number(d.purchase_price || d.inputs?.purchasePrice || 0);

export function activeFilterCount(f: CompareFilters): number {
  return (
    (f.status !== 'all' ? 1 : 0) +
    (f.assetClasses.length > 0 ? 1 : 0) +
    (f.minPrice !== null || f.maxPrice !== null ? 1 : 0) +
    f.thresholds.length
  );
}

export function thresholdPasses(t: MetricThreshold, summary: ComparisonSummary): boolean {
  const m = getMetric(t.metric);
  if (!m) return true;
  const v = m.get(summary);
  if (v === null || v === undefined || isNaN(v)) return false;
  return t.op === '>=' ? v >= t.value : v <= t.value;
}

/** True when the deal passes every filter. Thresholds need the deal's live-model summary (null skips them, they are slower to compute). */
export function dealPassesFilters(deal: DealRecord, f: CompareFilters, summary: ComparisonSummary | null): boolean {
  if (f.status !== 'all' && dealScope(deal) !== f.status) return false;
  if (f.assetClasses.length > 0 && !f.assetClasses.includes(dealAssetClass(deal))) return false;
  const price = dealPrice(deal);
  if (f.minPrice !== null && price < f.minPrice) return false;
  if (f.maxPrice !== null && price > f.maxPrice) return false;
  const q = f.text.trim().toLowerCase();
  if (q) {
    const hay = [resolveDealDisplayName(deal), deal.location || '', deal.address || '', dealAssetClass(deal)].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.thresholds.length > 0 && summary && !f.thresholds.every((t) => thresholdPasses(t, summary))) return false;
  return true;
}

/** Chip text for each applied filter, in the order shown. `clear` says how to remove just that one. */
export interface FilterChip {
  id: string;
  label: string;
  clear: (f: CompareFilters) => CompareFilters;
}

export function filterChips(f: CompareFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.status !== 'all') {
    chips.push({ id: 'status', label: f.status === 'pipeline' ? 'Pipeline' : f.status === 'owned' ? 'Owned' : 'Archived', clear: (x) => ({ ...x, status: 'all' }) });
  }
  for (const ac of f.assetClasses) {
    chips.push({ id: `ac:${ac}`, label: ac, clear: (x) => ({ ...x, assetClasses: x.assetClasses.filter((a) => a !== ac) }) });
  }
  if (f.minPrice !== null || f.maxPrice !== null) {
    const fmt = (n: number) => (n >= 1_000_000 ? `$${+(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}k`);
    const label = f.minPrice !== null && f.maxPrice !== null ? `${fmt(f.minPrice)} to ${fmt(f.maxPrice)}` : f.minPrice !== null ? `Over ${fmt(f.minPrice)}` : `Under ${fmt(f.maxPrice!)}`;
    chips.push({ id: 'price', label, clear: (x) => ({ ...x, minPrice: null, maxPrice: null }) });
  }
  f.thresholds.forEach((t, i) => {
    const m = getMetric(t.metric);
    chips.push({
      id: `th:${i}`,
      label: `${m?.short ?? t.metric} ${t.op === '>=' ? 'above' : 'below'} ${t.value}${m?.kind === 'pct' ? '%' : m?.kind === 'multiple' ? 'x' : ''}`,
      clear: (x) => ({ ...x, thresholds: x.thresholds.filter((_, j) => j !== i) }),
    });
  });
  return chips;
}
