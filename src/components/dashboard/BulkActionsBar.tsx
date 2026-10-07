import React from 'react';
import { CheckSquare, X, Download, ArrowRightLeft } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  totalFilteredCount: number;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onBulkMarkOwned: () => void;
  onBulkMovePipeline: () => void;
  onBulkExportCsv: () => void;
  canMarkOwned?: boolean;
  canMovePipeline?: boolean;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  totalFilteredCount,
  onSelectAllFiltered,
  onClearSelection,
  onBulkMarkOwned,
  onBulkMovePipeline,
  onBulkExportCsv,
  canMarkOwned = true,
  canMovePipeline = true,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-2xl w-[90%] sm:w-auto bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl px-4 py-2.5 flex items-center justify-between gap-4 text-xs font-sans text-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center space-x-2 shrink-0">
        <CheckSquare className="w-4 h-4 text-emerald-400" />
        <span className="font-extrabold text-white whitespace-nowrap">
          {selectedCount} <span className="text-slate-400 font-normal">of {totalFilteredCount} selected</span>
        </span>
        {selectedCount < totalFilteredCount && (
          <button
            type="button"
            onClick={onSelectAllFiltered}
            className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold underline underline-offset-2 ml-1"
          >
            Select all {totalFilteredCount}
          </button>
        )}
      </div>

      <div className="h-4 w-px bg-slate-800 hidden sm:block shrink-0" />

      <div className="flex items-center space-x-2 overflow-x-auto">
        {canMarkOwned && (
          <button
            type="button"
            onClick={onBulkMarkOwned}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition whitespace-nowrap flex items-center space-x-1 border border-slate-700"
            title="Mark selected deals as Owned"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Mark Owned</span>
          </button>
        )}

        {canMovePipeline && (
          <button
            type="button"
            onClick={onBulkMovePipeline}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition whitespace-nowrap flex items-center space-x-1 border border-slate-700"
            title="Move selected deals to Pipeline"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span>Move Pipeline</span>
          </button>
        )}

        <button
          type="button"
          onClick={onBulkExportCsv}
          className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black transition whitespace-nowrap flex items-center space-x-1 shadow-sm"
          title="Export CSV summary of selected deals"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>

        <button
          type="button"
          onClick={onClearSelection}
          className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
