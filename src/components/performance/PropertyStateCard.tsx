import React, { useMemo } from 'react';
import type { DealMetrics, DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics } from '../../lib/math/pointInTime';
import type { FigureBasis } from '../../lib/property/types';
import { formatCurrency } from '../../lib/format';
import { Building2, DollarSign, Activity, Percent, Info, ShieldAlert } from 'lucide-react';

interface Props {
  deal: DealRecord;
  metrics: DealMetrics;
  className?: string;
}

const basisStyles: Record<
  FigureBasis,
  { label: string; bg: string; text: string; border: string }
> = {
  collected: {
    label: 'Collected Actuals',
    bg: 'bg-emerald-950/60',
    text: 'text-emerald-400',
    border: 'border-emerald-800/60',
  },
  contracted: {
    label: 'Contracted Rent Roll',
    bg: 'bg-cyan-950/60',
    text: 'text-cyan-400',
    border: 'border-cyan-800/60',
  },
  blended: {
    label: 'Blended Actual + Pro-Forma',
    bg: 'bg-indigo-950/60',
    text: 'text-indigo-400',
    border: 'border-indigo-800/60',
  },
  estimated: {
    label: 'Underwriting Forecast',
    bg: 'bg-slate-900',
    text: 'text-slate-400',
    border: 'border-slate-800',
  },
};

const BasisBadge: React.FC<{ basis: FigureBasis; note?: string }> = ({ basis, note }) => {
  const s = basisStyles[basis] || basisStyles.estimated;
  return (
    <span
      className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold border ${s.bg} ${s.text} ${s.border} cursor-help`}
      title={note || `Derived from ${s.label.toLowerCase()}`}
    >
      <span>{s.label}</span>
      {note && <Info className="w-2.5 h-2.5 opacity-70" />}
    </span>
  );
};

/**
 * Renders the live property operational state computed by resolvePropertyState.
 * Clearly separates collected actuals, contracted leases, blended figures, and underwriting estimates.
 */
export const PropertyStateCard: React.FC<Props> = ({ deal, metrics, className = '' }) => {
  const pit = useMemo(() => resolvePointInTimeDealMetrics(deal, new Date()), [deal]);
  const state = pit.state;

  const isOwned = deal.status === 'owned';
  const occupancyPct = state.occupancy.value;
  const col = state.collected;

  return (
    <div className={`bg-slate-900/60 border border-slate-800 rounded-2xl shadow-xl p-5 space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-emerald-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-white flex items-center space-x-2">
              <span>Live Property Operational State</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                isOwned ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60' : 'bg-blue-950/40 text-blue-400 border-blue-800/50'
              }`}>
                {isOwned ? 'Owned Asset' : 'Pipeline'}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Contract and payment actuals resolved point-in-time against underwriting projections.
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block font-sans">
            As of
          </span>
          <span className="text-xs font-mono font-bold text-slate-300">
            {state.asOf}
          </span>
        </div>
      </div>

      {/* 4-Pillar Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Pillar 1: Contract Rent Roll */}
        <div className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center space-x-1">
              <Building2 className="w-3 h-3 text-slate-400" />
              <span>Contract Rent</span>
            </span>
            <span className="text-[10px] font-semibold text-slate-400">
              {state.rentRoll.inForceCount} {state.rentRoll.inForceCount === 1 ? 'lease' : 'leases'} in force
            </span>
          </div>

          <div>
            <span className="text-lg font-black font-mono text-white block tabular-nums">
              {state.rentRoll.monthlyRent !== null ? `${formatCurrency(state.rentRoll.monthlyRent)}/mo` : '—'}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5 font-sans">
              Source: {state.rentRoll.source === 'tables' ? 'Rent roll tables' : state.rentRoll.source === 'inputs' ? 'Deal inputs' : 'None'}
            </span>
          </div>
        </div>

        {/* Pillar 2: Physical Occupancy */}
        <div className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center space-x-1">
              <Percent className="w-3 h-3 text-slate-400" />
              <span>Occupancy</span>
            </span>
            <BasisBadge basis={state.occupancy.basis} note={state.occupancy.note} />
          </div>

          <div>
            <span className="text-lg font-black font-mono text-white block tabular-nums">
              {occupancyPct !== null ? `${occupancyPct.toFixed(1)}%` : '—'}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5 font-sans">
              {state.occupancy.occupiedUnits} of {state.occupancy.totalUnits} units occupied
            </span>
          </div>
        </div>

        {/* Pillar 3: Net Operating Income */}
        <div className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center space-x-1">
              <DollarSign className="w-3 h-3 text-slate-400" />
              <span>NOI</span>
            </span>
            <BasisBadge basis={state.noi.basis} note={state.noi.note} />
          </div>

          <div>
            <span className="text-lg font-black font-mono text-white block tabular-nums">
              {state.noi.value !== null ? `${formatCurrency(state.noi.value)}/yr` : '—'}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5 truncate font-sans" title={state.noi.note}>
              {state.noi.note || 'Resolved annual NOI'}
            </span>
          </div>
        </div>

        {/* Pillar 4: Current Cash Flow */}
        <div className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center space-x-1">
              <Activity className="w-3 h-3 text-slate-400" />
              <span>Cash Flow</span>
            </span>
            <BasisBadge basis={state.cashFlow.basis} note={state.cashFlow.note} />
          </div>

          <div>
            <span className={`text-lg font-black font-mono block tabular-nums ${
              state.cashFlow.value !== null && state.cashFlow.value < 0 ? 'text-red-400' : 'text-emerald-400'
            }`}>
              {state.cashFlow.value !== null ? `${formatCurrency(state.cashFlow.value)}/yr` : '—'}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5 truncate font-sans" title={state.cashFlow.note}>
              {state.cashFlow.note || 'Resolved net cash flow'}
            </span>
          </div>
        </div>
      </div>

      {/* Trailing 12-Month Collections Sub-Banner */}
      {col && (
        <div className="bg-slate-950/50 border border-slate-800/70 p-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="font-semibold text-slate-200">
              Trailing Collection History:
            </span>
            <span className="text-slate-400">
              {formatCurrency(col.total)} collected of {formatCurrency(col.billed)} billed across {col.months} recorded months
            </span>
          </div>

          {col.annualised !== null && (
            <div className="text-slate-300 font-mono text-right shrink-0">
              Annualized run-rate: <strong className="text-white font-black">{formatCurrency(col.annualised)}/yr</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
