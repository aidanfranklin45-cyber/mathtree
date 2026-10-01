import React from 'react';
import type { OperationsResult } from '../../lib/operations/rentRoll';

export type RollFilter = 'all' | 'attention' | 'unpaid' | 'overdue' | 'vacant' | 'escalation';

interface Props {
  kpis: OperationsResult['kpis'];
  active: RollFilter;
  onFilter: (f: RollFilter) => void;
}

const chip = (on: boolean) =>
  `px-2.5 py-1 rounded-lg text-xs transition ${on ? 'bg-slate-800 ring-1 ring-slate-600' : 'hover:bg-slate-800/70'}`;

/** One quiet line of portfolio numbers; the figures that point at rows double as table filters. */
export const OpsSummaryStrip: React.FC<Props> = ({ kpis, active, onFilter }) => {
  const toggle = (f: RollFilter) => onFilter(active === f ? 'all' : f);
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl px-3 py-2.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-slate-300">
      <span className="px-2.5 py-1 text-xs">
        <strong className="text-white font-mono text-sm">${Math.round(kpis.monthlyRent).toLocaleString()}</strong>
        <span className="text-slate-500"> /mo</span>
        <span className="text-slate-600 font-mono"> · ${Math.round(kpis.annualRent).toLocaleString()}/yr</span>
      </span>
      <span className="text-slate-700">|</span>
      <button type="button" onClick={() => toggle('vacant')} className={chip(active === 'vacant')} title="Show vacant units">
        <strong className="text-white font-mono text-sm">{kpis.occupancyPct}%</strong>{' '}
        <span className="text-slate-400">occupied ({kpis.occupiedUnits}/{kpis.totalUnits})</span>
      </button>
      <span className="text-slate-700">|</span>
      {kpis.overdueCount > 0 && (
        <button type="button" onClick={() => toggle('overdue')} className={chip(active === 'overdue')}>
          <strong className="text-rose-400 font-mono text-sm">{kpis.overdueCount}</strong> <span className="text-rose-300/80">overdue</span>
        </button>
      )}
      <button type="button" onClick={() => toggle('unpaid')} className={chip(active === 'unpaid')}>
        <strong className="text-white font-mono text-sm">{kpis.pendingCount}</strong> <span className="text-slate-400">pending</span>
        <span className="text-slate-600"> · {kpis.collectedPct}% collected</span>
      </button>
      <span className="text-slate-700">|</span>
      <button type="button" onClick={() => toggle('escalation')} className={chip(active === 'escalation')}>
        {kpis.escalationsDueCount > 0 ? (
          <>
            <strong className="text-amber-300 font-mono text-sm">{kpis.escalationsDueCount}</strong>{' '}
            <span className="text-amber-300/80">escalation{kpis.escalationsDueCount === 1 ? '' : 's'} due</span>
          </>
        ) : (
          <>
            <strong className="text-white font-mono text-sm">{kpis.scheduledCount}</strong>{' '}
            <span className="text-slate-400">escalation{kpis.scheduledCount === 1 ? '' : 's'} scheduled</span>
          </>
        )}
      </button>
    </div>
  );
};
