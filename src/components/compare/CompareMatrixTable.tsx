import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ComparisonColumn, WinnerAnalysis } from '../../lib/compare/compareTypes';
import { formatCurrency } from '../../lib/format';
import { MetricDef, formatVariance, groupsForKeys } from '../../lib/compare/metrics';
import { Trophy, DollarSign, TrendingUp, ShieldCheck, Tag, ExternalLink, X, Star, ChevronDown, ChevronRight, ArrowUpDown, Info } from 'lucide-react';

export interface MatrixSort {
  key: string;
  dir: 'best' | 'worst';
}

interface CompareMatrixTableProps {
  columns: ComparisonColumn[];
  winners: WinnerAnalysis;
  metricKeys: string[];
  sort: MatrixSort | null;
  onSort: (key: string) => void;
  onRemoveColumn: (colId: string) => void;
  onSetBenchmark: (colId: string) => void;
  onOpenAdd: () => void;
}

interface SpotlightDef {
  id: string;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  colorTitle: string;
  colorSub: string;
  box: string;
  winnerId: string | null;
  value: (c: ComparisonColumn) => string;
}

export const CompareMatrixTable: React.FC<CompareMatrixTableProps> = ({ columns, winners, metricKeys, sort, onSort, onRemoveColumn, onSetBenchmark, onOpenAdd }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const benchmarkCol = columns.find((c) => c.isBenchmark) || columns[0];
  const groups = groupsForKeys(metricKeys);

  const spotlights: SpotlightDef[] = [
    { id: 'irr', title: 'Highest IRR', Icon: Trophy, colorTitle: 'text-brand-400', colorSub: 'text-brand-400/80', box: 'from-brand-950/40 to-slate-900/60 border-brand-800/40', winnerId: winners.maxIrrId, value: (c) => `${c.summary.irr.toFixed(1)}%` },
    { id: 'cf', title: 'Top Cash Flow', Icon: DollarSign, colorTitle: 'text-emerald-400', colorSub: 'text-emerald-400/80', box: 'from-emerald-950/40 to-slate-900/60 border-emerald-800/40', winnerId: winners.maxCashFlowId, value: (c) => `${formatCurrency(c.summary.cashFlowYear1)}/yr` },
    { id: 'mult', title: 'Top Multiple', Icon: TrendingUp, colorTitle: 'text-cyan-400', colorSub: 'text-cyan-400/80', box: 'from-cyan-950/40 to-slate-900/60 border-cyan-800/40', winnerId: winners.maxMultipleId, value: (c) => `${c.summary.equityMultiple.toFixed(2)}x` },
    { id: 'dscr', title: 'Highest DSCR', Icon: ShieldCheck, colorTitle: 'text-violet-400', colorSub: 'text-violet-400/80', box: 'from-violet-950/40 to-slate-900/60 border-violet-800/40', winnerId: winners.maxDscrId, value: (c) => (c.summary.dscr !== null ? `${c.summary.dscr.toFixed(2)}x` : 'N/A') },
    { id: 'basis', title: 'Lowest Basis', Icon: Tag, colorTitle: 'text-amber-400', colorSub: 'text-slate-400', box: 'from-slate-900 to-slate-950 border-slate-800', winnerId: winners.minPriceId, value: (c) => formatCurrency(c.summary.purchasePrice) },
  ];

  const variance = (metric: MetricDef, col: ComparisonColumn): React.ReactNode => {
    if (!benchmarkCol || col.id === benchmarkCol.id) return null;
    const val = metric.get(col.summary);
    const base = metric.get(benchmarkCol.summary);
    if (val === null || base === null || Math.abs(val - base) <= 0.001) return null;
    const diff = val - base;
    const better = metric.lowerBetter ? diff < 0 : diff > 0;
    return <span className={`text-[10px] font-bold ${better ? 'text-emerald-400' : 'text-rose-400'} block text-right font-mono`}>{formatVariance(metric, diff)}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {spotlights.map((s) => {
          const win = s.winnerId ? columns.find((c) => c.id === s.winnerId) : null;
          if (!win) return null;
          return (
            <div key={s.id} className={`bg-gradient-to-b ${s.box} border rounded-2xl p-3 shadow-lg`}>
              <div className={`flex items-center space-x-1.5 ${s.colorTitle} text-[10px] font-extrabold uppercase tracking-wider`}>
                <s.Icon className="w-3.5 h-3.5" />
                <span>{s.title}</span>
              </div>
              <div className="mt-1">
                <span className="text-lg font-black text-white block tabular-nums">{s.value(win)}</span>
                <span className="text-[11px] text-slate-300 font-semibold truncate block">{win.dealTitle}</span>
                <span className={`hidden sm:block text-[10px] ${s.colorSub} font-mono truncate`}>{win.scenarioName}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 sticky top-0 z-20">
                <th className="py-4 px-4 sm:px-6 w-64 min-w-[240px] text-slate-400 font-bold uppercase tracking-wider text-[11px] sticky left-0 bg-slate-950 z-10">
                  <span>Metric / Scenario</span>
                  <span className="block normal-case font-medium tracking-normal text-[10px] text-slate-500 mt-0.5">Tap a metric to rank the columns</span>
                </th>
                {columns.map((col) => {
                  const isBench = benchmarkCol?.id === col.id;
                  return (
                    <th key={col.id} className="py-4 px-4 min-w-[200px] align-top relative">
                      <div className="flex flex-col justify-between h-full space-y-2">
                        <div className="flex items-center justify-between gap-1">
                          <button
                            onClick={() => onSetBenchmark(col.id)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center space-x-1 transition ${isBench ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
                            title={isBench ? 'Active benchmark for variance diffs' : 'Set as baseline benchmark'}
                          >
                            <Star className={`w-3 h-3 ${isBench ? 'fill-amber-400 text-amber-400' : ''}`} />
                            <span>{isBench ? 'Benchmark' : 'Set Base'}</span>
                          </button>
                          <div className="flex items-center space-x-1">
                            <Link to={`/project?id=${col.dealId}`} className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition" title="Open in Deal Studio" aria-label={`Open ${col.dealTitle} in Deal Studio`}>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                            <button onClick={() => onRemoveColumn(col.id)} className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition" title="Remove column" aria-label={`Remove ${col.dealTitle} ${col.scenarioName}`}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div>
                          <h4 className="font-extrabold text-sm text-white line-clamp-1">{col.dealTitle}</h4>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 text-emerald-300 border border-slate-700">{col.scenarioName}</span>
                            <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">{col.assetClass}</span>
                          </div>
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60 font-sans">
              {groups.map((g) => {
                const isCollapsed = !!collapsed[g.id];
                return (
                  <React.Fragment key={g.id}>
                    <tr onClick={() => setCollapsed((prev) => ({ ...prev, [g.id]: !prev[g.id] }))} className="bg-slate-950/90 border-t border-b border-slate-800 hover:bg-slate-900 cursor-pointer select-none transition">
                      <td colSpan={columns.length + 1} className="py-2.5 px-4 sm:px-6 text-[11px] font-extrabold tracking-wider uppercase text-slate-300">
                        <div className="flex items-center space-x-2">
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                          <span className={g.accentColor}>{g.title}</span>
                          <span className="text-[10px] text-slate-500 font-mono">({g.metrics.length} metrics)</span>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed && g.metrics.map((row) => {
                      const sorted = sort?.key === row.key;
                      return (
                        <tr key={row.key} className={`hover:bg-slate-800/40 transition group ${row.highlight ? 'bg-slate-900/30' : ''}`}>
                          <td className="p-0 align-middle border-r border-slate-800/40 sticky left-0 bg-slate-900 z-10">
                            <button type="button" onClick={() => onSort(row.key)} className="w-full text-left py-2.5 px-4 sm:px-6 flex items-center justify-between gap-2 hover:bg-slate-800/40" title="Rank columns by this metric">
                              <span className="flex flex-col min-w-0">
                                <span className={`text-xs ${row.highlight ? 'font-bold text-white' : 'font-semibold text-slate-300'}`}>{row.label}</span>
                                <span className="text-[10px] text-slate-500 line-clamp-1">{row.description}</span>
                              </span>
                              <ArrowUpDown className={`w-3.5 h-3.5 shrink-0 ${sorted ? 'text-emerald-400' : 'text-slate-600 group-hover:text-slate-400'}`} />
                            </button>
                          </td>
                          {columns.map((col) => {
                            const isBench = benchmarkCol?.id === col.id;
                            return (
                              <td key={col.id} className={`py-2.5 px-4 align-middle tabular-nums ${isBench ? 'bg-slate-950/40 font-bold' : ''}`}>
                                <div className="flex items-center justify-between space-x-2">
                                  <span className={`text-xs ${row.highlight ? 'font-black text-white' : 'font-semibold text-slate-200'}`}>{row.format(row.get(col.summary))}</span>
                                  {variance(row, col)}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="py-3 px-6 bg-slate-950/80 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
          <div className="flex items-center space-x-2">
            <Info className="w-3.5 h-3.5 text-slate-400" />
            <span>Variances are calculated against the <strong>Benchmark</strong> column (marked with ★).</span>
          </div>
          <button onClick={onOpenAdd} className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition">+ Add another asset or scenario</button>
        </div>
      </div>
    </div>
  );
};
