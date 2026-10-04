import type { BenchmarkFact, BenchmarkGap } from './types';

// Snapshot of values retrieved from public sources. A scheduled server-side fetch
// (see supabase/migrations_draft/13_market_benchmarks.sql) will replace this later;
// the browser never calls these sources.

const WA_VACANCY_SOURCE = {
  name: 'U.S. Census Bureau Housing Vacancy Survey via FRED (WARVAC)',
  url: 'https://fred.stlouisfed.org/series/WARVAC',
};

const waVacancy = (period: string, value: number): BenchmarkFact => ({
  metric: 'rental_vacancy_pct',
  geography: { state: 'WA' },
  period,
  value,
  unit: 'percent',
  source: WA_VACANCY_SOURCE,
  retrievedAt: '2026-10-04',
  note: 'Statewide, annual, residential rentals only; noisy year to year.',
});

export const BENCHMARK_FACTS: BenchmarkFact[] = [
  waVacancy('2020', 3.8),
  waVacancy('2021', 4.5),
  waVacancy('2022', 4.7),
  waVacancy('2023', 4.2),
  waVacancy('2024', 6.0),
  waVacancy('2025', 6.6),
];

export const BENCHMARK_GAPS: BenchmarkGap[] = [
  { metric: 'commercial_vacancy_pct', appliesTo: 'commercial', label: 'Commercial vacancy', reason: 'No free public source' },
  { metric: 'cap_rate_pct', appliesTo: 'commercial', label: 'Commercial cap rate', reason: 'No free public source; use your own comps' },
  { metric: 'rent_delinquency_pct', appliesTo: 'residential', label: 'Rent delinquency', reason: 'No free public source (Census stopped state data after Oct 2024)' },
];
