-- DRAFT 13 (NOT APPLIED): dated public market facts, filled by a scheduled server-side fetch (never the browser).
-- Shown beside a property's own numbers with source and date; never used as defaults. Read-only for signed-in users.
-- Mirrors BenchmarkFact in src/lib/benchmarks/types.ts. Free sources only (e.g. Census HVS via FRED, Census ACS, HUD FMR).

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric text NOT NULL CHECK (metric IN ('rental_vacancy_pct', 'commercial_vacancy_pct', 'cap_rate_pct', 'rent_delinquency_pct')),
  geo_state text NOT NULL,
  geo_county text NOT NULL DEFAULT '',
  period text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL DEFAULT 'percent',
  source_name text NOT NULL,
  source_url text NOT NULL,
  note text,
  retrieved_at date NOT NULL,
  UNIQUE (metric, geo_state, geo_county, period, source_name)
);

ALTER TABLE public.market_benchmarks ENABLE ROW LEVEL SECURITY;

-- Public facts: any signed-in user may read. Writes only by the service role (the scheduled function); no write policy.
CREATE POLICY market_benchmarks_read ON public.market_benchmarks FOR SELECT TO authenticated USING (true);

COMMIT;
