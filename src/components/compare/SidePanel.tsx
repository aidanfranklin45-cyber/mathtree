import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface SidePanelProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** A bottom sheet on phones and a right-hand drawer on larger screens. The board stays visible behind it on desktop. */
export const SidePanel: React.FC<SidePanelProps> = ({ open, title, subtitle, onClose, children, footer }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-950/70 md:bg-slate-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="relative w-full md:w-[26rem] max-h-[88vh] md:max-h-none md:h-full bg-slate-900 border border-slate-800 md:border-y-0 md:border-r-0 rounded-t-3xl md:rounded-none shadow-2xl flex flex-col"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="px-5 pt-4 pb-3 border-b border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-black text-white">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-2 -mr-2 -mt-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60">{footer}</div>}
      </div>
    </div>
  );
};
