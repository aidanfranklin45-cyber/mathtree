import React, { useMemo, useState } from 'react';
import type { DealMetrics, DealRecord } from '../../lib/math/types';
import { auditDealRisks } from '../../lib/engine';
import { prepareEngineInputs } from '../../lib/engine/compute';

interface Warning {
  level: 'danger' | 'warning' | 'success' | 'info' | string;
  title: string;
  description: string;
}

interface GroupedWarning {
  title: string;
  level: 'danger' | 'warning' | 'info';
  descriptions: string[];
}

const LEVEL_STYLE: Record<'danger' | 'warning' | 'info', { border: string; bg: string; text: string; badge: string; icon: string }> = {
  danger: {
    border: 'border-rose-500/30',
    bg: 'bg-rose-500/10',
    text: 'text-rose-300',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    icon: '🚨',
  },
  warning: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/10',
    text: 'text-amber-300',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    icon: '⚠️',
  },
  info: {
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-300',
    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    icon: 'ℹ️',
  },
};

/**
 * Sleek, compact and collapsible risk auditor banner.
 * Consolidates warnings to prevent visual clutter and dom-overflow.
 */
export const DealAuditorBanner: React.FC<{ deal: DealRecord; metrics: DealMetrics }> = ({ deal, metrics }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const { actionable, groups, topLevel } = useMemo(() => {
    let raw: Warning[] = [];
    try {
      raw = auditDealRisks(String(deal.asset_class), prepareEngineInputs(deal), metrics) as Warning[];
    } catch {
      raw = [];
    }

    // Filter out purely informational success notes to prevent green banner clutter
    const list = raw.filter((w) => w.level !== 'success');

    // Group warnings with identical titles (e.g. multiple expiring leases)
    const map = new Map<string, GroupedWarning>();
    for (const w of list) {
      const lvl: 'danger' | 'warning' | 'info' =
        w.level === 'danger' ? 'danger' : w.level === 'warning' ? 'warning' : 'info';
      const existing = map.get(w.title);
      if (existing) {
        existing.descriptions.push(w.description);
        if (lvl === 'danger' || (lvl === 'warning' && existing.level === 'info')) {
          existing.level = lvl;
        }
      } else {
        map.set(w.title, {
          title: w.title,
          level: lvl,
          descriptions: [w.description],
        });
      }
    }

    const groups = Array.from(map.values());
    const topLevel: 'danger' | 'warning' | 'info' = groups.some((g) => g.level === 'danger')
      ? 'danger'
      : groups.some((g) => g.level === 'warning')
        ? 'warning'
        : 'info';

    return { actionable: list, groups, topLevel };
  }, [deal, metrics]);

  if (isDismissed || actionable.length === 0) return null;

  const currentStyle = LEVEL_STYLE[topLevel];
  const summaryTitles = groups
    .map((g) => (g.descriptions.length > 1 ? `${g.title} (${g.descriptions.length})` : g.title))
    .join(' • ');

  return (
    <div className={`rounded-xl border ${currentStyle.border} ${currentStyle.bg} backdrop-blur-sm transition-all text-xs`}>
      {/* Compact summary bar */}
      <div className="flex items-center justify-between px-3 py-2 gap-2">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <span className="text-sm shrink-0">{currentStyle.icon}</span>
          <span className="font-bold text-white shrink-0">
            {actionable.length} Underwriting {actionable.length === 1 ? 'Observation' : 'Observations'}:
          </span>
          <span className={`truncate text-[11px] ${currentStyle.text} opacity-90 hidden sm:inline`} title={summaryTitles}>
            {summaryTitles}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsExpanded((o) => !o)}
            className="px-2 py-0.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 text-[11px] font-semibold text-slate-200 hover:text-white transition flex items-center space-x-1"
          >
            <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
            <span className="text-[9px]">{isExpanded ? '▲' : '▼'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            aria-label="Dismiss warnings"
            title="Dismiss alerts for this session"
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition text-xs"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Expanded item details */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-800/60 space-y-2">
          {groups.map((g, idx) => {
            const itemStyle = LEVEL_STYLE[g.level];
            return (
              <div key={idx} className={`p-2.5 rounded-lg border ${itemStyle.border} ${itemStyle.bg} flex items-start space-x-2.5`}>
                <span className="text-sm shrink-0 mt-0.5">{itemStyle.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <p className="font-bold text-white">{g.title}</p>
                    {g.descriptions.length > 1 && (
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono border ${itemStyle.badge}`}>
                        {g.descriptions.length} items
                      </span>
                    )}
                  </div>
                  {g.descriptions.length === 1 ? (
                    <p className={`mt-0.5 text-[11px] leading-relaxed ${itemStyle.text} opacity-90`}>
                      {g.descriptions[0]}
                    </p>
                  ) : (
                    <ul className={`mt-1 space-y-1 text-[11px] leading-relaxed ${itemStyle.text} opacity-90 list-disc list-inside`}>
                      {g.descriptions.map((desc, dIdx) => (
                        <li key={dIdx}>{desc}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
