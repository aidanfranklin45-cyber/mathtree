import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { DealRecord } from '../../lib/math/types';
import { CompareFilters, MetricThreshold, NO_FILTERS, activeFilterCount, dealAssetClass } from '../../lib/compare/filters';
import { getMetric } from '../../lib/compare/metrics';
import { SidePanel } from './SidePanel';

interface FiltersPanelProps {
  open: boolean;
  onClose: () => void;
  deals: DealRecord[];
  filters: CompareFilters;
  onChange: (f: CompareFilters) => void;
  shownCount: number;
}

const inputCls = 'w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition';
const labelCls = 'block text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2';
const THRESHOLD_METRICS = ['irr', 'cashOnCash', 'equityMultiple', 'dscr', 'capRateYear1', 'cashFlowYear1', 'npv']
  .map((k) => getMetric(k))
  .filter((m): m is NonNullable<typeof m> => !!m);

const parseMoney = (s: string): number | null => {
  const n = Number(s.replace(/[$,\s]/g, ''));
  return s.trim() === '' || isNaN(n) ? null : n;
};

export const FiltersPanel: React.FC<FiltersPanelProps> = ({ open, onClose, deals, filters, onChange, shownCount }) => {
  const classes = useMemo(() => Array.from(new Set(deals.map(dealAssetClass))).sort(), [deals]);
  const [thMetric, setThMetric] = useState(THRESHOLD_METRICS[0].key);
  const [thOp, setThOp] = useState<MetricThreshold['op']>('>=');
  const [thValue, setThValue] = useState('');
  const count = activeFilterCount(filters);

  const addThreshold = () => {
    const v = Number(thValue);
    if (thValue.trim() === '' || isNaN(v)) return;
    onChange({ ...filters, thresholds: [...filters.thresholds, { metric: thMetric, op: thOp, value: v }] });
    setThValue('');
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Filters"
      subtitle="Narrow which deals the Add list offers. Deals already on the board stay."
      footer={
        <div className="flex items-center justify-between gap-3">
          <button type="button" disabled={count === 0} onClick={() => onChange({ ...NO_FILTERS, text: filters.text })} className="text-xs font-bold text-slate-400 hover:text-white disabled:opacity-40">Clear all</button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black transition">Show {shownCount} {shownCount === 1 ? 'deal' : 'deals'}</button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-6">
        <section>
          <span className={labelCls}>Status</span>
          <div className="flex flex-wrap gap-2">
            {(['all', 'pipeline', 'owned', 'archived'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...filters, status: s })}
                aria-pressed={filters.status === s}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border capitalize transition min-h-[40px] ${filters.status === s ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-white'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <section>
          <span className={labelCls}>Asset class</span>
          <div className="flex flex-wrap gap-2">
            {classes.map((c) => {
              const on = filters.assetClasses.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ ...filters, assetClasses: on ? filters.assetClasses.filter((x) => x !== c) : [...filters.assetClasses, c] })}
                  aria-pressed={on}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border capitalize transition min-h-[40px] ${on ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-white'}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <span className={labelCls}>Purchase price</span>
          <div className="grid grid-cols-2 gap-2">
            <input inputMode="numeric" className={inputCls} placeholder="Min $" value={filters.minPrice ?? ''} onChange={(e) => onChange({ ...filters, minPrice: parseMoney(e.target.value) })} />
            <input inputMode="numeric" className={inputCls} placeholder="Max $" value={filters.maxPrice ?? ''} onChange={(e) => onChange({ ...filters, maxPrice: parseMoney(e.target.value) })} />
          </div>
        </section>

        <section>
          <span className={labelCls}>Return thresholds (live model)</span>
          {filters.thresholds.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {filters.thresholds.map((t, i) => (
                <li key={i} className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-200">
                  <span>{getMetric(t.metric)?.short} {t.op === '>=' ? 'at least' : 'at most'} {t.value}</span>
                  <button type="button" onClick={() => onChange({ ...filters, thresholds: filters.thresholds.filter((_, j) => j !== i) })} aria-label="Remove threshold" className="p-1 text-slate-500 hover:text-rose-400"><X className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select className={inputCls} value={thMetric} onChange={(e) => setThMetric(e.target.value)} aria-label="Metric">
              {THRESHOLD_METRICS.map((m) => <option key={m.key} value={m.key}>{m.short}</option>)}
            </select>
            <select className={inputCls} value={thOp} onChange={(e) => setThOp(e.target.value as MetricThreshold['op'])} aria-label="Direction">
              <option value=">=">at least</option>
              <option value="<=">at most</option>
            </select>
            <input inputMode="decimal" className={inputCls} placeholder={getMetric(thMetric)?.kind === 'pct' ? 'e.g. 12 (percent)' : 'Value'} value={thValue} onChange={(e) => setThValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addThreshold(); }} />
            <button type="button" onClick={addThreshold} className="px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 flex items-center justify-center" aria-label="Add threshold"><Plus className="w-4 h-4" /></button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Percent metrics are in percent (12 means 12%).</p>
        </section>
      </div>
    </SidePanel>
  );
};

