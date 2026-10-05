import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DealRecord } from '../../lib/math/types';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import {
  Loader2,
  ArrowRightLeft,
  Edit2,
  Share2,
  UserCheck,
  FileText,
  Download,
  Trash2,
  ChevronRight,
  X,
  MapPin,
} from 'lucide-react';

export interface DealActionsModalProps {
  isOpen: boolean;
  deal: DealRecord | null;
  onClose: () => void;
  onToggleStatus: (deal: DealRecord) => void;
  onEdit: (deal: DealRecord) => void;
  onShare?: (deal: DealRecord) => void;
  onTransfer?: (deal: DealRecord) => void;
  onOpenBrief: (deal: DealRecord) => void;
  onExportCsv: (deal: DealRecord) => void;
  onDelete: (deal: DealRecord) => void;
}

export const DealActionsModal: React.FC<DealActionsModalProps> = ({
  isOpen,
  deal,
  onClose,
  onToggleStatus,
  onEdit,
  onShare,
  onTransfer,
  onOpenBrief,
  onExportCsv,
  onDelete,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !deal) return null;
  if (typeof document === 'undefined') return null;

  const isOwned = deal.status === 'owned';
  const displayName = resolveDealDisplayName(deal);
  const inputs = deal.inputs || {};
  const location = deal.location || inputs.propertyAddress || deal.address || '';
  const assetClass = String(deal.asset_class || deal.assetType || 'commercial');

  const actionItem = (
    title: string,
    description: string,
    icon: React.ReactNode,
    iconBg: string,
    onClick: () => void,
    variant: 'default' | 'danger' = 'default'
  ) => (
    <button
      type="button"
      onClick={() => {
        onClose();
        onClick();
      }}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border transition text-left group ${
        variant === 'danger'
          ? 'bg-rose-950/20 hover:bg-rose-950/40 border-rose-900/40 hover:border-rose-800'
          : 'bg-slate-950/60 hover:bg-slate-800/80 border-slate-800/80 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center space-x-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${iconBg}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div
            className={`text-xs font-bold transition truncate ${
              variant === 'danger'
                ? 'text-rose-400 group-hover:text-rose-300'
                : 'text-white group-hover:text-emerald-400'
            }`}
          >
            {title}
          </div>
          {/* One line keeps every action on screen without scrolling; the full text is on hover */}
          <div className="text-[10.5px] text-slate-400 leading-snug mt-px truncate" title={description}>
            {description}
          </div>
        </div>
      </div>
      <ChevronRight
        className={`w-4 h-4 transition shrink-0 ml-3 ${
          variant === 'danger'
            ? 'text-rose-600 group-hover:text-rose-400 group-hover:translate-x-0.5'
            : 'text-slate-600 group-hover:text-slate-300 group-hover:translate-x-0.5'
        }`}
      />
    </button>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-5 space-y-3 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-2.5 border-b border-slate-800/80">
          <div className="min-w-0 pr-4">
            <div className="flex items-center space-x-2">
              <span
                className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  isOwned
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                }`}
              >
                {isOwned ? 'Owned Asset' : 'Pipeline Deal'}
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-950 px-2 py-0.5 rounded-full border border-slate-800">
                {assetClass}
              </span>
            </div>
            <h3 className="text-base font-extrabold text-white truncate mt-1.5">
              {displayName}
            </h3>
            {location && (
              <p className="text-xs text-slate-400 truncate mt-0.5 flex items-center">
                <MapPin className="w-3 h-3 text-slate-500 shrink-0 inline mr-1" />
                <span>{location}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Actions List */}
        <div className="space-y-1.5">
          {actionItem(
            isOwned ? 'Move to Pipeline' : 'Mark as Acquired (Owned)',
            isOwned
              ? 'Transition this property back to active underwriting pipeline for scenario modeling.'
              : 'Mark as an acquired, operational property in your owned portfolio.',
            <ArrowRightLeft className="w-4 h-4 text-emerald-400" />,
            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            () => onToggleStatus(deal)
          )}

          {actionItem(
            'Edit Inputs',
            'Update purchase price, financing, unit counts, operating expenses, and rent roll.',
            <Edit2 className="w-4 h-4 text-blue-400" />,
            'bg-blue-500/10 text-blue-400 border-blue-500/20',
            () => onEdit(deal)
          )}

          {onShare && !deal.is_shared && (
            actionItem(
              'Share Deal',
              'Invite partners, lenders, or team members to view or collaborate with defined permissions.',
              <Share2 className="w-4 h-4 text-cyan-400" />,
              'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
              () => onShare(deal)
            )
          )}

          {onTransfer && !deal.is_shared && !deal.is_demo && (
            actionItem(
              'Transfer Ownership',
              'Reassign primary project ownership to an affiliated collaborator or legal entity.',
              <UserCheck className="w-4 h-4 text-amber-400" />,
              'bg-amber-500/10 text-amber-400 border-amber-500/20',
              () => onTransfer(deal)
            )
          )}

          {actionItem(
            'Print Executive Brief',
            'Open a publication-ready institutional summary formatted for high-resolution print & PDF.',
            <FileText className="w-4 h-4 text-violet-400" />,
            'bg-violet-500/10 text-violet-400 border-violet-500/20',
            () => onOpenBrief(deal)
          )}

          {actionItem(
            'Export CSV',
            'Download the complete 10-year pro-forma, cash flow schedule, and metrics spreadsheet.',
            <Download className="w-4 h-4 text-emerald-400" />,
            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            () => onExportCsv(deal)
          )}

          <div className="pt-0.5">
            {actionItem(
              'Delete Project',
              'Permanently remove this deal, history, and all financial model assumptions.',
              <Trash2 className="w-4 h-4 text-rose-400" />,
              'bg-rose-500/10 text-rose-400 border-rose-500/20',
              () => onDelete(deal),
              'danger'
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

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
  if (typeof document === 'undefined') return null;

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

  return createPortal(
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
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
    </div>,
    document.body
  );
};
