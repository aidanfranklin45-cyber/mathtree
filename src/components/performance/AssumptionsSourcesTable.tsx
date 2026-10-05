import React, { useMemo } from 'react';
import type { InputBasis } from '@engine/underwritingAssumptions';
import { TRACKED_INPUTS } from '@engine/underwritingAssumptions';
import { formatCurrency } from '../../lib/format';
import { CheckCircle2, AlertTriangle, ShieldCheck, FileCheck } from 'lucide-react';

export interface AssumptionsSourcesTableProps {
  deal?: Record<string, any>;
  inputs?: Record<string, any>;
  assumptionBasis?: Record<string, InputBasis>;
  title?: string;
  className?: string;
}

const sourceBadges: Record<
  InputBasis['source'],
  { label: string; className: string }
> = {
  profile: {
    label: 'Investor Profile',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  owner: {
    label: 'Owner Stated',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  county_record: {
    label: 'County Record',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  document: {
    label: 'Verified Document',
    className: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  },
};

const formatValue = (key: string, val: unknown): string => {
  if (val === undefined || val === null || val === '') return '—';
  const num = Number(val);
  if (isNaN(num)) return String(val);

  const k = key.toLowerCase();
  if (k.includes('percent') || k.includes('rate') || k.includes('ratio') || k.includes('growth')) {
    return `${num}%`;
  }
  if (k.includes('year') || k === 'holdingperiod') {
    return `${num} yr${num === 1 ? '' : 's'}`;
  }
  if (k.includes('cost') || k.includes('tax') || k.includes('insurance') || k.includes('reserve') || k.includes('maintenance') || k.includes('price')) {
    return formatCurrency(num);
  }
  return String(num);
};

/**
 * Assumptions and Sources table for bankable underwriting.
 * Reads `deal.inputs.assumptionBasis`. For each figure, presents its value, source,
 * and owner rationale. Flags figures with no rationale as "Unsupported".
 */
export const AssumptionsSourcesTable: React.FC<AssumptionsSourcesTableProps> = ({
  deal,
  inputs: explicitInputs,
  assumptionBasis: explicitBasis,
  title = 'Underwriting Assumptions & Sources',
  className = '',
}) => {
  const activeInputs = explicitInputs || deal?.inputs || {};
  const basisMap: Record<string, InputBasis> =
    explicitBasis || activeInputs.assumptionBasis || deal?.assumptionBasis || {};

  const rows = useMemo(() => {
    const keys = Object.keys(basisMap);
    return keys.map((key) => {
      const basis = basisMap[key];
      const liveVal = activeInputs[key];
      const displayVal = basis.value !== undefined ? basis.value : liveVal;
      const hasRationale = Boolean(basis.rationale && basis.rationale.trim().length > 0);
      const label = basis.label || TRACKED_INPUTS[key] || key;

      return {
        key,
        label,
        value: displayVal,
        source: basis.source,
        rationale: basis.rationale,
        hasRationale,
      };
    });
  }, [basisMap, activeInputs]);

  const stats = useMemo(() => {
    const total = rows.length;
    const supported = rows.filter((r) => r.hasRationale).length;
    const unsupported = total - supported;
    const isBankable = total > 0 && unsupported === 0;

    return { total, supported, unsupported, isBankable };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className={`bg-slate-900/40 border border-slate-800 rounded-2xl p-5 ${className}`}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-sm font-extrabold text-white flex items-center space-x-2">
            <FileCheck className="w-4 h-4 text-slate-400" />
            <span>{title}</span>
          </h3>
        </div>
        <p className="text-xs text-slate-400 mt-4">
          No assumption basis records recorded for this deal yet. Once assumptions are established or
          seeded from the investor profile, their sources and rationale will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-slate-900/60 border border-slate-800 rounded-2xl shadow-xl overflow-hidden ${className}`}>
      {/* Header & Bankability Summary */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/40">
        <div>
          <h3 className="text-sm font-extrabold text-white flex items-center space-x-2">
            <FileCheck className="w-4 h-4 text-emerald-400" />
            <span>{title}</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Institutional verification table detailing source documents and investor justifications for all underwriting inputs.
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {stats.isBankable ? (
            <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Bankable ({stats.supported}/{stats.total} Supported)</span>
            </span>
          ) : (
            <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>{stats.unsupported} Unsupported Figure{stats.unsupported === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
      </div>

      {/* Assumptions Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 bg-slate-950/80">
              <th className="py-3 px-4">Underwriting Assumption</th>
              <th className="py-3 px-4 text-right">Value</th>
              <th className="py-3 px-4">Source Basis</th>
              <th className="py-3 px-4">Owner Justification / Rationale</th>
              <th className="py-3 px-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {rows.map((row) => {
              const badge = sourceBadges[row.source] || sourceBadges.owner;
              return (
                <tr key={row.key} className="hover:bg-slate-800/30 transition">
                  <td className="py-3 px-4 font-semibold text-slate-200">
                    {row.label}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-white tabular-nums">
                    {formatValue(row.key, row.value)}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.className}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="py-3 px-4 max-w-[320px]">
                    {row.hasRationale ? (
                      <span className="text-slate-300 text-xs block leading-relaxed">
                        {row.rationale}
                      </span>
                    ) : (
                      <span className="text-slate-500 italic text-xs">
                        No rationale provided by owner
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    {row.hasRationale ? (
                      <span className="inline-flex items-center space-x-1 text-emerald-400 text-[11px] font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Supported</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Unsupported</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
