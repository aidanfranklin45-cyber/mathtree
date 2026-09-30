import React from 'react';
import type { ScenarioRunView } from '../../lib/scenarios';
import type { DealInputs } from '../../lib/math/types';

interface Props {
  /** Newest first, with diffs computed on demand from each run's inputs. */
  runs: ScenarioRunView[];
  isOwned: boolean;
  onOpenHistory: () => void;
  onRestore: (inputs: DealInputs) => void;
}

interface DiffItem {
  key: string;
  label: string;
  newValue?: any;
  delta?: number | null;
  isCurrency?: boolean;
  isPct?: boolean;
  suffix?: string;
}

/** The edge function returns either an array of items or an { key: { old, new, diff } } map. */
function normalize(diff: unknown): DiffItem[] {
  if (!diff) return [];
  if (Array.isArray(diff)) return diff as DiffItem[];
  return Object.entries(diff as Record<string, any>).map(([key, item]) => ({
    key, label: key, newValue: item?.new, delta: item?.diff,
  }));
}

const chip = 'inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700/80 text-[11px] font-mono';

const InputChips: React.FC<{ diff: unknown }> = ({ diff }) => (
  <>
    {normalize(diff).map((item, i) => {
      let label = item.label || item.key;
      let value = String(item.newValue ?? '');
      let deltaStr = '';
      const d = item.delta;
      const hasDelta = d != null && !isNaN(Number(d));
      if (item.isCurrency || ['purchasePrice', 'rehabBudget', 'grossRentAnnual'].includes(item.key)) {
        label = item.label || 'Basis';
        if (hasDelta) deltaStr = `${Number(d) > 0 ? '+$' : '-$'}${Math.abs(Math.round(Number(d))).toLocaleString()}`;
        value = `$${Number(item.newValue || 0).toLocaleString()}`;
      } else if (item.isPct || ['interestRate', 'downPaymentPercent', 'vacancyRate', 'exitCapRate'].includes(item.key)) {
        if (hasDelta) deltaStr = `${Number(d) > 0 ? '+' : ''}${Number(d).toFixed(2)}%`;
        value = `${Number(item.newValue || 0).toFixed(2)}%`;
      } else {
        if (hasDelta) deltaStr = `${Number(d) > 0 ? '+' : ''}${d}${item.suffix || ''}`;
        value = `${value}${item.suffix || ''}`;
      }
      return (
        <span key={i} className={`${chip} text-slate-200`}>
          <span className="text-slate-400">{label}:</span>
          <span className="font-bold text-white">{value}</span>
          {deltaStr && <span className="text-cyan-400 font-semibold text-[10px]">({deltaStr})</span>}
        </span>
      );
    })}
  </>
);

const MetricChips: React.FC<{ diff: unknown }> = ({ diff }) => (
  <>
    {normalize(diff).map((item, i) => {
      const label = item.label || item.key.toUpperCase();
      const delta = Number(item.delta ?? (item as any).diff) || 0;
      const color = delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-300';
      let text = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
      if (item.isPct || ['irr', 'cashOnCash', 'capRate'].includes(item.key)) text += '% pts';
      else if (item.isCurrency || item.key === 'year1CashFlow') text = `${delta > 0 ? '+$' : '-$'}${Math.abs(Math.round(delta)).toLocaleString()}/yr`;
      else if (item.suffix || ['equityMultiple', 'dscr'].includes(item.key)) text += item.suffix || 'x';
      return (
        <span key={i} className={chip}>
          <span className="text-slate-400">Δ {label}:</span>
          <span className={`font-bold ${color}`}>{text}</span>
        </span>
      );
    })}
  </>
);

export const ScenarioSummaryCard: React.FC<Props> = ({ runs, isOwned, onOpenHistory, onRestore }) => {
  const count = runs.length;
  const latest = runs[0];
  const hasInputDiff = !!latest && latest.inputDiff.length > 0;
  const hasMetricDiff = !!latest && latest.metricDiff.length > 0;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 sm:p-4 shadow-lg backdrop-blur-sm transition">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800/80">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-extrabold uppercase tracking-wider text-white">Underwriting Sensitivity &amp; Parameter Variance</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${isOwned ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'}`}>
            {isOwned ? 'Baseline Locked (Owned Asset)' : 'Auto-Tracking Active'}
          </span>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-[11px] text-slate-400 font-mono">{count} run{count === 1 ? '' : 's'} logged</span>
          <button type="button" onClick={onOpenHistory}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition flex items-center space-x-1">
            <span>Compare Matrix</span><span>➔</span>
          </button>
        </div>
      </div>

      <div className="pt-3">
        {count === 0 ? (
          <div className="flex items-center justify-between text-xs text-slate-500 py-1 font-mono">
            <span>No parameter variations recorded yet. Edits made during pipeline underwriting automatically log sensitivity runs here.</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center space-x-2">
                <span className="text-white font-bold">{latest.name || 'Latest Run'}</span>
                <span className="text-[10px] text-slate-500 font-mono">{new Date(latest.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {count > 1 && (
                <div className="flex items-center space-x-1.5 overflow-x-auto">
                  <span className="text-[10px] text-slate-500 uppercase font-mono mr-1">Restore:</span>
                  {runs.slice(0, 5).map((r, i) => (
                    <button key={r.id} type="button" onClick={() => onRestore(r.inputs as DealInputs)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${i === 0 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}>
                      Run #{r.runNumber}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 space-y-1.5">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">Parameter Input Changes</span>
                <div className="flex flex-wrap gap-1.5">
                  {hasInputDiff ? <InputChips diff={latest.inputDiff} /> : <span className="text-[11px] text-slate-500 font-mono italic">Initial baseline run established</span>}
                </div>
              </div>
              <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 space-y-1.5">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 block">Return Metric Impacts</span>
                <div className="flex flex-wrap gap-1.5">
                  {hasMetricDiff ? <MetricChips diff={latest.metricDiff} /> : <span className="text-[11px] text-slate-500 font-mono italic">Baseline returns locked</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
