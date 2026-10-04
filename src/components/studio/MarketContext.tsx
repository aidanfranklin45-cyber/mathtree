import React from 'react';
import { DealRecord } from '../../lib/math/types';
import { assetGroupOf, geographyOf, lookupBenchmark, metricsFor } from '../../lib/benchmarks';

const LABELS: Record<string, string> = {
  rental_vacancy_pct: 'Rental vacancy',
  rent_delinquency_pct: 'Rent delinquency',
  commercial_vacancy_pct: 'Commercial vacancy',
  cap_rate_pct: 'Commercial cap rate',
};

/** Read-only, dated public facts with their source. Never feeds the model or fills an input. */
export const MarketContext: React.FC<{ deal: DealRecord }> = ({ deal }) => {
  const geo = geographyOf(deal as any);
  if (!geo) return null;
  const group = assetGroupOf(String(deal.asset_class ?? (deal as any).asset_type));
  const where = geo.county ? `${geo.county} County, ${geo.state}` : geo.state;

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-slate-400 bg-slate-900/40 border border-slate-900 rounded-xl px-3.5 py-2">
      <span className="font-bold uppercase tracking-wider text-slate-500">Market context</span>
      {metricsFor(group).map((metric) => {
        const r = lookupBenchmark(metric, { state: geo.state });
        if (r.kind === 'fact') {
          const f = r.fact;
          return (
            <span key={metric}>
              {LABELS[metric]} <strong className="text-slate-200 font-mono">{f.value.toFixed(1)}%</strong>{' '}
              <a href={f.source.url} target="_blank" rel="noreferrer" className="text-slate-500 underline decoration-dotted" title={`${f.source.name}. ${f.note ?? ''} Retrieved ${f.retrievedAt}.`}>
                {geo.state}, {f.period}, Census/FRED
              </a>
            </span>
          );
        }
        return (
          <span key={metric}>
            {LABELS[metric]} <span className="text-slate-500">{r.kind === 'gap' ? `no free source` : `not loaded for ${where}`}</span>
          </span>
        );
      })}
    </div>
  );
};
