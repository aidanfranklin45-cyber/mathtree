import React from 'react';
import { Check } from 'lucide-react';
import { METRIC_GROUPS, METRIC_SETS, matchingMetricSet } from '../../lib/compare/metrics';
import { SidePanel } from './SidePanel';

interface MetricsPanelProps {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onChange: (keys: string[]) => void;
}

export const MetricsPanel: React.FC<MetricsPanelProps> = ({ open, onClose, selected, onChange }) => {
  const sel = new Set(selected);
  const active = matchingMetricSet(selected);

  const toggle = (key: string) => {
    const next = new Set(sel);
    if (next.has(key)) {
      if (next.size === 1) return; // keep at least one row on the board
      next.delete(key);
    } else {
      next.add(key);
    }
    // Keep the canonical order so rows do not jump around as they are ticked
    onChange(METRIC_GROUPS.flatMap((g) => g.metrics.map((m) => m.key)).filter((k) => next.has(k)));
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Metrics"
      subtitle={`${selected.length} shown. Pick a set, then adjust.`}
      footer={<div className="flex justify-end"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black transition">Done</button></div>}
    >
      <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-slate-800/80 sticky top-0 bg-slate-900 z-10">
        {METRIC_SETS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.keys)}
            aria-pressed={active?.id === s.id}
            className={`px-3 py-2 rounded-xl text-xs font-bold border transition min-h-[40px] ${active?.id === s.id ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-white'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {METRIC_GROUPS.map((g) => (
        <div key={g.id} className="py-2">
          <h4 className={`px-5 pt-2 pb-1 text-[11px] font-extrabold tracking-wider ${g.accentColor}`}>{g.title}</h4>
          {g.metrics.map((m) => {
            const on = sel.has(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggle(m.key)}
                aria-pressed={on}
                className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-800/40 transition min-h-[48px]"
              >
                <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-emerald-500 border-emerald-400 text-slate-950' : 'border-slate-600 text-transparent'}`}>
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-100">{m.label}</span>
                  <span className="block text-[11px] text-slate-500 line-clamp-1">{m.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </SidePanel>
  );
};
