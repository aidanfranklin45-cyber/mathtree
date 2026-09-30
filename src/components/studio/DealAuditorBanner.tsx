import React, { useMemo } from 'react';
import type { DealMetrics, DealRecord } from '../../lib/math/types';
import { auditDealRisks } from '../../lib/engine';
import { prepareEngineInputs } from '../../lib/engine/compute';

interface Warning { level: 'danger' | 'warning' | 'success' | 'info' | string; title: string; description: string }

const STYLE: Record<string, { cls: string; icon: string }> = {
  danger: { cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300', icon: '🚨' },
  warning: { cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300', icon: '⚠️' },
  success: { cls: 'border-brand-500/40 bg-brand-500/10 text-brand-300', icon: '✅' },
  info: { cls: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300', icon: 'ℹ️' },
};

/** Risk warnings computed from the same engine results the tabs show (DSCR, negative cash flow, break-even ...). */
export const DealAuditorBanner: React.FC<{ deal: DealRecord; metrics: DealMetrics }> = ({ deal, metrics }) => {
  const warnings = useMemo<Warning[]>(() => {
    try {
      return auditDealRisks(String(deal.asset_class), prepareEngineInputs(deal), metrics) as Warning[];
    } catch {
      return [];
    }
  }, [deal, metrics]);

  if (warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w, i) => {
        const s = STYLE[w.level] || STYLE.warning;
        return (
          <div key={i} className={`p-3 rounded-xl border ${s.cls} flex items-start space-x-2 text-xs`}>
            <span className="text-base">{s.icon}</span>
            <div>
              <p className="font-bold">{w.title}</p>
              <p className="opacity-90 mt-0.5">{w.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
