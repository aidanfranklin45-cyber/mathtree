import React from 'react';
import { InboxList, MutedSection } from '../operations/AttentionInbox';
import { useInboxMutes } from '../../lib/operations/inboxMutes';
import type { InboxItem } from '../../lib/operations/attention';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: InboxItem[];
  loading: boolean;
  onRefresh: () => void;
}

/** The bell: a slide-over view of the one portfolio inbox (the same list the Operations page shows). */
export const InboxPanel: React.FC<Props> = ({ isOpen, onClose, items, loading, onRefresh }) => {
  const { mute } = useInboxMutes();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex justify-end">
      <div onClick={onClose} className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity" />
      <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col h-full z-10">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 sticky top-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center font-bold text-sm">🔔</div>
            <div>
              <h3 className="text-sm font-extrabold text-white flex items-center space-x-2">
                <span>Needs attention</span>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono">{items.length}</span>
              </h3>
              <p className="text-[11px] text-slate-400">Everything across your owned properties</p>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <button onClick={onRefresh} disabled={loading} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50" title="Refresh">
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-sm font-bold" aria-label="Close">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="m-5 p-8 text-center bg-slate-950/40 rounded-2xl border border-slate-800/80">
              <h4 className="text-sm font-bold text-white mb-1">{loading ? 'Checking…' : 'All caught up'}</h4>
              {!loading && <p className="text-xs text-slate-400 leading-relaxed">Nothing needs your attention across your owned properties.</p>}
            </div>
          ) : (
            <InboxList items={items} portfolio onNavigate={onClose} onMute={mute} />
          )}
          <MutedSection />
        </div>
      </div>
    </div>
  );
};
