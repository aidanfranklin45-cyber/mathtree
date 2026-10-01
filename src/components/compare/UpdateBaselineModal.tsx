import React, { useEffect, useState } from 'react';
import { ComparisonColumn, columnFingerprint } from '../../lib/compare/compareTypes';
import { formatCurrency } from '../../lib/format';
import { X, History } from 'lucide-react';

interface UpdateBaselineModalProps {
  isOpen: boolean;
  onClose: () => void;
  dealTitle: string;
  /** Columns the owner can adopt as the new baseline (everything except the baseline itself). */
  candidates: ComparisonColumn[];
  /** Fingerprint of the current baseline; a candidate with the same results changes nothing and cannot be chosen. */
  baselineFingerprint: string | null;
  baselineCapturedAt: string | null;
  baselineIrr: number | null;
  busy: boolean;
  error: string | null;
  onConfirm: (column: ComparisonColumn) => void;
}

const dateOf = (iso: string | null): string => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

/** Lets an owner replace the acquisition baseline with new projections. The old baseline is kept in history. */
export const UpdateBaselineModal: React.FC<UpdateBaselineModalProps> = ({
  isOpen, onClose, dealTitle, candidates, baselineFingerprint, baselineCapturedAt, baselineIrr, busy, error, onConfirm,
}) => {
  const isSame = (c: ComparisonColumn): boolean => baselineFingerprint !== null && columnFingerprint(c) === baselineFingerprint;
  const firstChoice = candidates.find((c) => !isSame(c));
  const [selectedId, setSelectedId] = useState<string | null>(firstChoice?.id ?? null);
  useEffect(() => {
    if (isOpen) setSelectedId(candidates.find((c) => !isSame(c))?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;
  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  const captured = dateOf(baselineCapturedAt);
  const hasBaseline = baselineCapturedAt !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Update baseline">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-white">{hasBaseline ? 'Update acquisition baseline' : 'Record acquisition baseline'}</h3>
            <p className="text-xs text-slate-400">{dealTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-300 leading-relaxed">
            Use this when your projections change, for example after a refinance, a lease renewal or a new rent schedule.
            Pick the model that should become the baseline; later comparisons and Performance vs Pro-Forma measure against it.
          </p>
          {hasBaseline && (
            <div className="flex items-start space-x-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-300">
              <History className="w-3.5 h-3.5 mt-0.5 text-cyan-400 shrink-0" />
              <span>
                Current baseline{captured ? `, recorded ${captured}` : ''}{baselineIrr !== null ? `, ${baselineIrr.toFixed(1)}% IRR` : ''}, will be kept in history. It is replaced for comparisons, not deleted.
              </span>
            </div>
          )}

          <div className="space-y-2" role="radiogroup" aria-label="New baseline">
            {candidates.map((c) => {
              const same = isSame(c);
              const checked = c.id === selectedId;
              return (
                <label
                  key={c.id}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 transition ${
                    same ? 'border-slate-800 bg-slate-950/40 opacity-60 cursor-not-allowed' : checked ? 'border-emerald-500/60 bg-emerald-500/10 cursor-pointer' : 'border-slate-800 hover:border-slate-700 cursor-pointer'
                  }`}
                >
                  <span className="flex items-center space-x-2.5 min-w-0">
                    <input type="radio" name="new-baseline" disabled={same} checked={checked} onChange={() => setSelectedId(c.id)} className="accent-emerald-500" />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-white truncate">{c.scenarioName}</span>
                      {same && <span className="block text-[10px] text-slate-400">Same results as the current baseline</span>}
                    </span>
                  </span>
                  <span className="text-right text-[11px] font-mono text-slate-300 shrink-0">
                    <span className="block">{c.summary.irr.toFixed(1)}% IRR</span>
                    <span className="block text-slate-400">{formatCurrency(c.summary.noi)} NOI • {formatCurrency(c.summary.cashFlowYear1)} CF</span>
                  </span>
                </label>
              );
            })}
            {candidates.length === 0 && <p className="text-xs text-slate-400">There is no scenario to adopt yet.</p>}
          </div>

          {error && <p className="text-xs text-rose-400" role="alert">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold disabled:opacity-50">Cancel</button>
          <button
            type="button"
            onClick={() => selected && onConfirm(selected)}
            disabled={busy || !selected}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black disabled:opacity-50"
          >
            {busy ? 'Saving…' : hasBaseline ? 'Set as new baseline' : 'Record as baseline'}
          </button>
        </div>
      </div>
    </div>
  );
};
