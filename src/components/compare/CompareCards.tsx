import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, ExternalLink, Star, X } from 'lucide-react';
import { ComparisonColumn } from '../../lib/compare/compareTypes';
import { bestColumnId, getMetric, rankColumns } from '../../lib/compare/metrics';

interface CompareCardsProps {
  columns: ComparisonColumn[];
  metricKeys: string[];
  onRemoveColumn: (id: string) => void;
  onSetBenchmark: (id: string) => void;
}

/** The phone view: one card per column, ranked by a metric you choose, instead of a wide table. */
export const CompareCards: React.FC<CompareCardsProps> = ({ columns, metricKeys, onRemoveColumn, onSetBenchmark }) => {
  const metrics = useMemo(() => metricKeys.map(getMetric).filter((m): m is NonNullable<typeof m> => !!m), [metricKeys]);
  const [rankKey, setRankKey] = useState<string>(metricKeys.includes('irr') ? 'irr' : metricKeys[0]);
  const [open, setOpen] = useState<string | null>(null);

  const rankMetric = metrics.find((m) => m.key === rankKey) ?? metrics[0];
  const ranked = useMemo(() => (rankMetric ? rankColumns(columns, rankMetric) : columns), [columns, rankMetric]);
  const bestIds = useMemo(() => new Map(metrics.map((m) => [m.key, bestColumnId(m, columns)])), [metrics, columns]);
  if (!rankMetric) return null;
  const others = metrics.filter((m) => m.key !== rankMetric.key);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1" role="group" aria-label="Rank by">
        <span className="text-[11px] font-bold text-slate-400 shrink-0">Rank by</span>
        {metrics.map((m) => (
          <button key={m.key} type="button" onClick={() => setRankKey(m.key)} aria-pressed={m.key === rankMetric.key} className={`px-3 py-2 rounded-xl text-xs font-bold border whitespace-nowrap min-h-[40px] transition ${m.key === rankMetric.key ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' : 'bg-slate-900 text-slate-300 border-slate-800'}`}>{m.short}</button>
        ))}
      </div>

      {ranked.map((c, i) => {
        const wins = metrics.filter((m) => bestIds.get(m.key) === c.id && columns.length > 1);
        const expanded = open === c.id;
        return (
          <article key={c.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <button type="button" onClick={() => setOpen(expanded ? null : c.id)} className="w-full text-left p-4 flex items-start gap-3" aria-expanded={expanded}>
              <span className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 text-xs font-black flex items-center justify-center shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-extrabold text-white truncate">{c.dealTitle}</span>
                <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 text-emerald-300 border border-slate-700">{c.scenarioName}</span>
                {wins.length > 0 && (
                  <span className="flex flex-wrap gap-1 mt-2">
                    {wins.slice(0, 4).map((m) => <span key={m.key} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Best {m.short}</span>)}
                  </span>
                )}
              </span>
              <span className="text-right shrink-0">
                <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold">{rankMetric.short}</span>
                <span className="block text-lg font-black text-white tabular-nums">{rankMetric.format(rankMetric.get(c.summary))}</span>
                {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 ml-auto" /> : <ChevronDown className="w-4 h-4 text-slate-500 ml-auto" />}
              </span>
            </button>
            <div className="px-4 pb-3 grid grid-cols-3 gap-2">
              {others.slice(0, 3).map((m) => (
                <div key={m.key} className="rounded-xl bg-slate-950/60 border border-slate-900 px-2.5 py-2">
                  <span className="block text-[10px] text-slate-500 font-bold truncate">{m.short}</span>
                  <span className="block text-xs font-bold text-slate-100 tabular-nums truncate">{m.format(m.get(c.summary))}</span>
                </div>
              ))}
            </div>
            {expanded && (
              <div className="border-t border-slate-800">
                <dl className="divide-y divide-slate-800/60">
                  {metrics.map((m) => (
                    <div key={m.key} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <dt className="text-xs text-slate-400">{m.label}</dt>
                      <dd className="text-xs font-bold text-slate-100 tabular-nums text-right">{m.format(m.get(c.summary))}</dd>
                    </div>
                  ))}
                </dl>
                <div className="px-4 py-3 flex items-center justify-between border-t border-slate-800 bg-slate-950/50">
                  <button type="button" onClick={() => onSetBenchmark(c.id)} className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 min-h-[40px] ${c.isBenchmark ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-300 bg-slate-900 border border-slate-800'}`}>
                    <Star className={`w-3.5 h-3.5 ${c.isBenchmark ? 'fill-amber-400 text-amber-400' : ''}`} /> {c.isBenchmark ? 'Benchmark' : 'Set as benchmark'}
                  </button>
                  <div className="flex items-center gap-1">
                    <Link to={`/project?id=${c.dealId}`} className="p-2.5 text-slate-300 hover:text-emerald-400" aria-label={`Open ${c.dealTitle}`}><ExternalLink className="w-4 h-4" /></Link>
                    <button type="button" onClick={() => onRemoveColumn(c.id)} className="p-2.5 text-slate-400 hover:text-rose-400" aria-label={`Remove ${c.dealTitle} ${c.scenarioName}`}><X className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};
