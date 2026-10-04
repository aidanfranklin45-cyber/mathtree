import type { AssetGroup, BenchmarkFact, BenchmarkGap, BenchmarkLookup, BenchmarkMetric, Geography } from './types';
import { BENCHMARK_FACTS, BENCHMARK_GAPS } from './data';

/** Residential asset classes get residential metrics; everything else is commercial. */
export function assetGroupOf(assetClass: string | null | undefined): AssetGroup {
  const s = String(assetClass ?? '').toLowerCase();
  return s.includes('multi') || s.includes('single') || s.includes('resid') ? 'residential' : 'commercial';
}

/** Reads state and county off a deal's inputs/location. Returns null when state is unknown. */
export function geographyOf(deal: { location?: string | null; inputs?: Record<string, any> | null }): Geography | null {
  const inputs = deal.inputs ?? {};
  const parcel = Array.isArray(inputs.parcels) ? inputs.parcels[0] : undefined;
  const state = String(parcel?.state || inputs.state || '').trim().toUpperCase()
    || (/,\s*([A-Z]{2})(?:\s+\d{5})?\s*$/.exec(String(deal.location ?? ''))?.[1] ?? '');
  if (!state) return null;
  const county = String(inputs.county || parcel?.county || '').replace(/\s*County.*$/i, '').trim();
  return county ? { state, county } : { state };
}

const sameGeo = (a: Geography, b: Geography) =>
  a.state === b.state && (a.county ?? '').toLowerCase() === (b.county ?? '').toLowerCase();

/** Latest fact for the metric at exactly this geography; never substitutes a wider area. */
export function latestFact(metric: BenchmarkMetric, geo: Geography, facts: BenchmarkFact[] = BENCHMARK_FACTS): BenchmarkFact | null {
  const hits = facts.filter((f) => f.metric === metric && sameGeo(f.geography, geo));
  return hits.length ? hits.reduce((a, b) => (b.period > a.period ? b : a)) : null;
}

export function lookupBenchmark(metric: BenchmarkMetric, geo: Geography, facts: BenchmarkFact[] = BENCHMARK_FACTS): BenchmarkLookup {
  const fact = latestFact(metric, geo, facts);
  if (fact) return { kind: 'fact', fact };
  const gap = BENCHMARK_GAPS.find((g) => g.metric === metric);
  return gap ? { kind: 'gap', gap } : { kind: 'not_loaded' };
}

/** Metrics worth showing for an asset group, in display order. */
export function metricsFor(group: AssetGroup): BenchmarkMetric[] {
  return group === 'residential'
    ? ['rental_vacancy_pct', 'rent_delinquency_pct']
    : ['commercial_vacancy_pct', 'cap_rate_pct'];
}

export function gapsFor(group: AssetGroup): BenchmarkGap[] {
  return BENCHMARK_GAPS.filter((g) => g.appliesTo === group);
}

export type BenchmarkComparison =
  | { status: 'no_benchmark'; lookup: BenchmarkLookup }
  | { status: 'compared'; fact: BenchmarkFact; value: number; diffPoints: number };

/** Plain difference in percentage points. No verdict: the caller decides what to say. */
export function compareToBenchmark(metric: BenchmarkMetric, value: number, geo: Geography, facts?: BenchmarkFact[]): BenchmarkComparison {
  const lookup = lookupBenchmark(metric, geo, facts);
  if (lookup.kind !== 'fact' || !Number.isFinite(value)) return { status: 'no_benchmark', lookup };
  return { status: 'compared', fact: lookup.fact, value, diffPoints: Math.round((value - lookup.fact.value) * 100) / 100 };
}
