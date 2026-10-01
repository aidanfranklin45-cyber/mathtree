import React from 'react';
import { ComparisonMode, CompareScope } from '../../lib/compare/compareTypes';
import { DealRecord } from '../../lib/math/types';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import { FileDown, Plus, BarChart3, Table as TableIcon, RefreshCw, Sparkles, Scale, SlidersHorizontal } from 'lucide-react';

interface CompareHeaderProps {
  mode: ComparisonMode;
  onSetMode: (m: ComparisonMode) => void;
  viewType: 'table' | 'charts';
  onSetViewType: (v: 'table' | 'charts') => void;
  columnsCount: number;
  onOpenAddModal: () => void;
  onExportCsv: () => void;
  onReset: () => void;
  deals: DealRecord[];
  selectedSingleDealId: string | null;
  onSelectSingleDeal: (dealId: string) => void;
  scope: CompareScope;
  onSetScope: (s: CompareScope) => void;
  scopeCounts: Record<CompareScope, number>;
}

const SCOPE_LABEL: Record<CompareScope, string> = { pipeline: 'Pipeline', owned: 'Owned', all: 'All' };
const SCOPE_HINT: Record<CompareScope, string> = {
  pipeline: 'Prospective deals you are underwriting.',
  owned: 'Properties you own, modeled on their underwriting inputs.',
  all: 'Pipeline and owned properties together.',
};

export const CompareHeader: React.FC<CompareHeaderProps> = ({
  mode,
  onSetMode,
  viewType,
  onSetViewType,
  columnsCount,
  onOpenAddModal,
  onExportCsv,
  onReset,
  deals,
  selectedSingleDealId,
  onSelectSingleDeal,
  scope,
  onSetScope,
  scopeCounts,
}) => {
  return (
    <div className="bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-emerald-950/20 border border-slate-900 p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-xl space-y-4 backdrop-blur-sm">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Title & Description */}
        <div className="space-y-1">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center text-slate-950 font-black shadow-md shadow-emerald-500/20">
              <Scale className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center space-x-2">
                <span>Underwriting Comparison Studio</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  On-The-Fly Math
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Underwrite prospective deals side-by-side, or compare the properties you own.
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* View toggle (Table vs Charts) */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => onSetViewType('table')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                viewType === 'table'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Matrix</span>
            </button>
            <button
              onClick={() => onSetViewType('charts')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                viewType === 'charts'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Charts</span>
            </button>
          </div>

          {/* Export CSV */}
          <button
            onClick={onExportCsv}
            disabled={columnsCount === 0}
            className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex items-center space-x-1.5 disabled:opacity-40"
            title="Download CSV spreadsheet of comparison"
          >
            <FileDown className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>

          {/* Add Column Button */}
          <button
            onClick={onOpenAddModal}
            className="px-3.5 py-1.5 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-brand-600 to-emerald-500 hover:from-brand-500 hover:to-emerald-400 shadow-md shadow-emerald-500/20 transition flex items-center space-x-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Asset</span>
          </button>

          {columnsCount > 0 && (
            <button
              onClick={onReset}
              className="p-1.5 text-slate-500 hover:text-rose-400 transition"
              title="Reset comparison columns"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Mode Switcher Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
        <div className="flex items-center space-x-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 self-start">
          <button
            onClick={() => onSetMode('properties')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              mode === 'properties'
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Compare Properties</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300 font-mono">
              Multi-Asset
            </span>
          </button>

          <button
            onClick={() => onSetMode('versions')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              mode === 'versions'
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Compare Property Versions</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-cyan-300 font-mono">
              Scenarios
            </span>
          </button>

          <button
            onClick={() => onSetMode('custom')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              mode === 'custom'
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Custom Matrix</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
        {/* Portfolio scope: which deals this studio works with */}
        <div className="flex items-center space-x-2" title={SCOPE_HINT[scope]}>
          <span className="text-xs font-bold text-slate-400 shrink-0">Show:</span>
          <div className="flex items-center space-x-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800" role="group" aria-label="Deal scope">
            {(['pipeline', 'owned', 'all'] as CompareScope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSetScope(s)}
                aria-pressed={scope === s}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                  scope === s
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>{SCOPE_LABEL[s]}</span>
                <span className="px-1.5 rounded-full bg-slate-800 text-[10px] text-slate-300 font-mono">{scopeCounts[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* When in single property version mode: select the property */}
        {mode === 'versions' && (
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-400 shrink-0">Focus Property:</span>
            <select
              value={selectedSingleDealId || ''}
              onChange={(e) => onSelectSingleDeal(e.target.value)}
              className="bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-1.5 text-xs font-bold text-emerald-300 focus:outline-none truncate max-w-xs shadow-sm"
            >
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {resolveDealDisplayName(d)} ({d.asset_class || d.assetType || 'SFR'})
                </option>
              ))}
            </select>
          </div>
        )}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">{SCOPE_HINT[scope]}</p>
    </div>
  );
};
