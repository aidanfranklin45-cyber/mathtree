import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '../../lib/useNotifications';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onRefresh: () => void;
  onDismiss: (id: string) => void;
  /** Called after a pro-forma sync so the page can reload its deals. */
  /** Opens the entity portal targeted at a property (Assign Entity LLC alerts). */
  onAssignEntity?: (dealId: string, dealTitle?: string) => void;
}

const severityBadge = (sev: string) => {
  if (sev === 'critical') return <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 border border-rose-500/40 text-rose-300">Action Required</span>;
  if (sev === 'warning') return <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 border border-amber-500/40 text-amber-300">Review &amp; Check</span>;
  return <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 border border-blue-500/40 text-blue-300">Tip / Reminder</span>;
};

export const NotificationHub: React.FC<Props> = ({ isOpen, onClose, notifications, onRefresh, onDismiss, onAssignEntity }) => {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (!isOpen) return null;

  const openLease = (n: AppNotification) => {
    onClose();
    const p = n.action_payload || {};
    const qs = new URLSearchParams({ action: 'add-lease', deal_id: String(p.deal_id || n.target_deal_id || '') });
    if (p.lease_id) qs.set('lease_id', String(p.lease_id));
    navigate(`/operations?${qs.toString()}`);
  };

    const dismissBtn = (n: AppNotification, label: string, title?: string) => (
    <button onClick={() => onDismiss(n.notification_id)} title={title}
      className="py-1.5 px-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition">{label}</button>
  );

  const actions = (n: AppNotification) => {
    switch (n.action_type) {
      case 'open_lease_modal':
        return (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => openLease(n)} className="flex-1 py-1.5 px-3 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition text-center">+ Add Tenant &amp; Lease Terms</button>
            {dismissBtn(n, 'Snooze')}
          </div>
        );
      case 'open_entity_modal':
        return onAssignEntity ? (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => { onClose(); onAssignEntity(String(n.action_payload?.deal_id || n.target_deal_id || ''), n.action_payload?.deal_title); }}
              className="flex-1 py-1.5 px-3 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 transition text-center">Assign Entity LLC</button>
            {dismissBtn(n, 'Dismiss')}
          </div>
        ) : null;
      case 'missing_terms':
        return (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => openLease(n)} className="flex-1 py-1.5 px-3 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 transition text-center">Complete Lease Terms</button>
            {dismissBtn(n, 'Dismiss')}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex justify-end">
      <div onClick={onClose} className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity" />
      <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col h-full z-10">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 sticky top-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold text-sm">🔔</div>
            <div>
              <h3 className="text-sm font-extrabold text-white flex items-center space-x-2">
                <span>Action Center</span>
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">{notifications.length}</span>
              </h3>
              <p className="text-[11px] text-slate-400">Institutional reminders &amp; pro-forma checks</p>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <button onClick={onRefresh} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition" title="Refresh checks">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-sm font-bold" aria-label="Close">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {toast && <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-300">{toast}</div>}
          {notifications.length === 0 ? (
            <div className="p-8 text-center bg-slate-950/40 rounded-2xl border border-slate-800/80 my-auto">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
              </div>
              <h4 className="text-sm font-bold text-white mb-1">All Caught Up!</h4>
              <p className="text-xs text-slate-400 leading-relaxed">All owned properties have verified tenants, complete lease terms, and aligned pro-forma models.</p>
            </div>
          ) : notifications.map((n) => (
            <div key={n.notification_id} className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/90 shadow-lg flex flex-col space-y-2 relative group hover:border-slate-700 transition">
              <div className="flex items-center justify-between gap-2">
                {severityBadge(n.severity)}
                <button onClick={() => onDismiss(n.notification_id)} className="text-slate-500 hover:text-slate-300 transition text-xs p-1" title="Dismiss notification">✕</button>
              </div>
              <h5 className="text-xs font-bold text-slate-200 leading-snug">{n.title}</h5>
              <p className="text-xs text-slate-400 leading-relaxed">{n.message}</p>
              {actions(n)}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-[11px] text-slate-400">
          <span>MathTree Autonomous Underwriting Engine</span>
          <button onClick={onClose} className="font-bold text-emerald-400 hover:text-emerald-300">Done</button>
        </div>
      </div>
    </div>
  );
};
