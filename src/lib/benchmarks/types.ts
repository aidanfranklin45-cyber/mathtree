// Market benchmarks are dated, sourced facts shown NEXT TO a property's own numbers.
// They are never used as defaults or silent fill-ins; nothing here feeds the math engine.

export type BenchmarkMetric =
  | 'rental_vacancy_pct'
  | 'commercial_vacancy_pct'
  | 'cap_rate_pct'
  | 'rent_delinquency_pct';

export type AssetGroup = 'residential' | 'commercial';

export interface Geography {
  state: string; // 'WA'
  county?: string; // 'Spokane' (no "County" suffix)
}

export interface BenchmarkFact {
  metric: BenchmarkMetric;
  geography: Geography;
  period: string; // as published, e.g. '2025' or '2025-Q3'
  value: number;
  unit: 'percent';
  source: { name: string; url: string };
  retrievedAt: string; // YYYY-MM-DD
  note?: string;
}

/** A metric with no free public source. Shown as a blank with the reason, never invented. */
export interface BenchmarkGap {
  metric: BenchmarkMetric;
  appliesTo: AssetGroup;
  label: string;
  reason: string;
}

export type BenchmarkLookup =
  | { kind: 'fact'; fact: BenchmarkFact }
  | { kind: 'gap'; gap: BenchmarkGap }
  | { kind: 'not_loaded' }; // a source exists but no value has been fetched for this geography
