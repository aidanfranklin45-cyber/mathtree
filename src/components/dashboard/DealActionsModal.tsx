import React, { useState, useEffect } from 'react';
import { DealRecord } from '../../lib/math/types';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import { Loader2 } from 'lucide-react';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  deal: DealRecord | null;
  onClose: () => void;
  onConfirmDelete: (dealId: string) => Promise<void>;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  deal,
  onClose,
  onConfirmDelete,
}) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setConfirmInput('');
  }, [isOpen, deal]);

  if (!isOpen || !deal) return null;

  const expectedName = resolveDealDisplayName(deal);
  const isMatch = confirmInput.trim().toLowerCase() === expectedName.trim().toLowerCase();

  const handleDelete = async () => {
    if (!isMatch) return;
    setIsDeleting(true);
    try {
      await onConfirmDelete(deal.id);
      onClose();
    } catch (err) {
      console.error('Failed to delete deal:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl relative">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/20 font-black">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">Delete Project</h3>
              <p className="text-xs text-rose-400 font-semibold mt-0.5">Permanent Deletion</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg">✕</button>
        </div>

        <div className="space-y-3 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
          <p className="text-xs text-slate-300 leading-relaxed">
            This action <strong className="text-rose-400 font-bold">cannot be undone</strong>. All underwriting models,
            pro-forma forecasts, and return metrics will be permanently deleted.
          </p>
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-bold text-slate-400 block">
              To confirm, type &quot;<span className="text-emerald-400 font-mono font-bold select-all">{expectedName}</span>&quot; below:
            </label>
            <input
              type="text"
              autoFocus
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={`Type "${expectedName}" to confirm`}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            />
          </div>
        </div>

        <div className="flex items-center space-x-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!isMatch || isDeleting}
            className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold text-white bg-rose-600 transition ${isMatch && !isDeleting ? 'hover:bg-rose-500' : 'opacity-40 cursor-not-allowed'}`}
          >
            {isDeleting ? (
              <span className="inline-flex items-center justify-center"><Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" />Deleting...</span>
            ) : (
              'Delete Forever'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
