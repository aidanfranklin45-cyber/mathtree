import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase/client';
import type { DealRecord } from '../../lib/math/types';
import { fetchOutgoingShares, invokeCollaboration, type DealShareRow } from '../../lib/collaborationEdge';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** All deals on the dashboard (owned + shared with me). */
  deals: DealRecord[];
  onChanged?: () => void;
}

const dealName = (d: DealRecord) => (d as any).name || d.title || 'Underwriting Property';

export const CollaboratorsHubModal: React.FC<Props> = ({ isOpen, onClose, deals, onChanged }) => {
  const [tab, setTab] = useState<'active' | 'incoming'>('active');
  const [outgoing, setOutgoing] = useState<DealShareRow[]>([]);
  const [dealId, setDealId] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const myDeals = deals.filter((d) => !d.is_shared);
  const sharedWithMe = deals.filter((d) => d.is_shared);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (data?.user) setOutgoing(await fetchOutgoingShares(data.user.id));
  }, []);

  useEffect(() => {
    if (isOpen) {
      setMessage(null);
      void load();
    }
  }, [isOpen, load]);

  if (!isOpen) return null;

  const share = async () => {
    const target = email.trim().toLowerCase();
    if (!dealId) return setMessage({ kind: 'err', text: 'Please choose a deal to share from the dropdown.' });
    if (!target || !target.includes('@')) return setMessage({ kind: 'err', text: 'Please enter a valid colleague email address.' });
    setBusy(true);
    setMessage(null);
    const res = await invokeCollaboration<{ success?: boolean; error?: string }>('share_deal', {
      deal_id: dealId, share_type: 'email', target_id: target, permission: 'viewer', can_view_scenarios: true,
    });
    setBusy(false);
    if (!res || (res.success === false && res.error)) {
      return setMessage({ kind: 'err', text: `Failed to share deal: ${res?.error ?? 'no response from server'}` });
    }
    setEmail('');
    setMessage({ kind: 'ok', text: `Deal shared with ${target}! They can now view it in their MathTree account.` });
    await load();
    onChanged?.();
  };

  const revoke = async (shareId: string) => {
    if (!window.confirm("Remove this collaborator's access to the deal?")) return;
    await invokeCollaboration('revoke_share', { share_id: shareId });
    await load();
    onChanged?.();
  };

  return (
    <div role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-4 sm:p-6 space-y-5 shadow-2xl my-2 sm:my-6 max-h-[94vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20 font-black text-lg shrink-0">👥</div>
            <div>
              <h3 className="text-base font-extrabold text-white">Collaborators &amp; Shared Deals</h3>
              <p className="text-xs text-slate-400">Share deals directly with colleagues or manage team access</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg text-lg" aria-label="Close">✕</button>
        </div>

        {/* Quick share */}
        <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-3">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-1.5"><span>+ Share a Deal with a Colleague</span></h4>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-4">
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Choose Deal</label>
              <select value={dealId} onChange={(e) => setDealId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-semibold">
                <option value="">{myDeals.length === 0 ? 'No portfolio deals found' : 'Select a deal to share...'}</option>
                {myDeals.map((d) => <option key={d.id} value={d.id}>{dealName(d)}</option>)}
              </select>
            </div>
            <div className="sm:col-span-5">
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Colleague Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@firm.com"
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500" />
            </div>
            <div className="sm:col-span-3 flex items-end">
              <button type="button" onClick={share} disabled={busy}
                className="w-full py-2 px-3 rounded-xl text-xs font-extrabold text-slate-950 bg-cyan-400 hover:bg-cyan-300 shadow-md shadow-cyan-500/20 transition flex items-center justify-center space-x-1 disabled:opacity-60">
                <span>{busy ? 'Sharing...' : 'Share Deal'}</span>
              </button>
            </div>
          </div>
          {message && <p className={`text-[11px] font-semibold ${message.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{message.text}</p>}
          <p className="text-[11px] text-slate-500 leading-tight">
            Shared colleagues will immediately see this deal in their MathTree dashboard under &quot;Shared with Me&quot;.
          </p>
        </div>

        {/* Directory */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <button type="button" onClick={() => setTab('active')}
                className={tab === 'active'
                  ? 'px-3 py-1.5 rounded-xl text-xs font-bold transition bg-cyan-600 text-white shadow-sm flex items-center space-x-1.5'
                  : 'px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800 transition flex items-center space-x-1.5'}>
                <span>Deals Shared by You</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${tab === 'active' ? 'bg-cyan-950' : 'bg-slate-800'}`}>{outgoing.length}</span>
              </button>
              <button type="button" onClick={() => setTab('incoming')}
                className={tab === 'incoming'
                  ? 'px-3 py-1.5 rounded-xl text-xs font-bold transition bg-cyan-600 text-white shadow-sm flex items-center space-x-1.5'
                  : 'px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800 transition flex items-center space-x-1.5'}>
                <span>Deals Shared with You</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${tab === 'incoming' ? 'bg-cyan-950' : 'bg-slate-800'}`}>{sharedWithMe.length}</span>
              </button>
            </div>
          </div>

          {tab === 'active' ? (
            <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
              {outgoing.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-6 text-center">You have not shared any deals yet.</p>
              ) : outgoing.map((sh) => (
                <div key={sh.id} className="flex items-center justify-between p-3 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white">{sh.deals?.title || sh.deals?.name || 'Underwriting Property'}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Shared</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      Shared with: <strong className="text-slate-200">{sh.shared_with_email || 'Collaborator'}</strong> ({sh.permission}) • {new Date(sh.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button type="button" onClick={() => revoke(sh.id)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-rose-400 hover:text-white hover:bg-rose-600/30 border border-rose-800/40 transition">Revoke</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
              {sharedWithMe.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-6 text-center">No deals have been shared with your account yet.</p>
              ) : sharedWithMe.map((d) => (
                <div key={d.id} className="flex items-center justify-between p-3 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white">{dealName(d)}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">{(d as any).shared_permission || 'viewer'}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">{d.location || 'Pipeline Property'}</div>
                  </div>
                  <Link to={`/project?id=${encodeURIComponent(d.id)}`} onClick={onClose}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition shadow-sm">Open Deal</Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
