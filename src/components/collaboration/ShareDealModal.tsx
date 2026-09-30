import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import type { DealRecord } from '../../lib/math/types';
import { fetchDealShares, invokeCollaboration, type DealShareRow } from '../../lib/collaborationEdge';

interface Props {
  deal: DealRecord | null;
  onClose: () => void;
  onChanged?: () => void;
}

export const ShareDealModal: React.FC<Props> = ({ deal, onClose, onChanged }) => {
  const [shares, setShares] = useState<DealShareRow[]>([]);
  const [ownerEmail, setOwnerEmail] = useState('You');
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'viewer' | 'editor'>('viewer');
  const [includeScenarios, setIncludeScenarios] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (deal) setShares(await fetchDealShares(deal.id));
  }, [deal]);

  useEffect(() => {
    if (!deal) return;
    setError(null);
    setEmail('');
    void load();
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.email) setOwnerEmail(`${data.user.email} (You)`);
    });
  }, [deal, load]);

  if (!deal) return null;
  const name = (deal as any).name || deal.title || 'Underwriting Property';

  const submit = async () => {
    const target = email.trim().toLowerCase();
    if (!target || !target.includes('@')) return setError('Please enter a valid colleague email address.');
    setBusy(true);
    setError(null);
    const res = await invokeCollaboration<{ success?: boolean; error?: string }>('share_deal', {
      deal_id: deal.id, share_type: 'email', target_id: target, permission, can_view_scenarios: includeScenarios,
    });
    setBusy(false);
    if (!res || (res.success === false && res.error)) return setError(`Failed to share deal: ${res?.error ?? 'no response from server'}`);
    setEmail('');
    await load();
    onChanged?.();
  };

  const remove = async (shareId: string) => {
    if (!window.confirm("Remove this collaborator's access to the deal?")) return;
    await invokeCollaboration('revoke_share', { share_id: shareId });
    await load();
    onChanged?.();
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/project?id=${encodeURIComponent(deal.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy deal link:', url);
    }
  };

  return (
    <div role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-4 sm:p-6 space-y-5 shadow-2xl my-2 sm:my-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20 font-black text-lg shrink-0">🤝</div>
            <div>
              <h3 className="text-base font-extrabold text-white">Share &quot;{name}&quot;</h3>
              <p className="text-xs text-slate-400">Recipients can view this deal directly in their MathTree account</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg text-lg" aria-label="Close">✕</button>
        </div>

        <div className="space-y-2 bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800">
          <label className="block text-xs font-bold text-slate-300">Add People</label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@firm.com"
              className="flex-grow bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500" />
            <div className="flex items-center gap-2">
              <select value={permission} onChange={(e) => setPermission(e.target.value as 'viewer' | 'editor')}
                className="bg-slate-900 border border-slate-700/80 rounded-xl px-2.5 py-2 text-xs text-white font-semibold focus:outline-none focus:border-cyan-500">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button type="button" onClick={submit} disabled={busy}
                className="px-4 py-2 rounded-xl text-xs font-extrabold text-slate-950 bg-cyan-400 hover:bg-cyan-300 shadow-md shadow-cyan-500/20 transition shrink-0 disabled:opacity-60">
                {busy ? 'Sharing...' : 'Share'}
              </button>
            </div>
          </div>
          <div className="flex items-center space-x-2 pt-1">
            <input type="checkbox" id="share-scenarios" checked={includeScenarios} onChange={(e) => setIncludeScenarios(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0" />
            <label htmlFor="share-scenarios" className="text-slate-400 text-[11px] cursor-pointer">Include Scenario &amp; Sensitivity History</label>
          </div>
          {error && <p className="text-[11px] font-semibold text-rose-400">{error}</p>}
        </div>

        <div className="space-y-2 border-t border-slate-800 pt-3">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">People with Access</h4>
          <div className="flex items-center justify-between p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-300 font-bold text-[11px] flex items-center justify-center">👤</div>
              <div>
                <span className="font-bold text-white block">{ownerEmail}</span>
                <span className="text-[10px] text-slate-500">Project Owner</span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">Owner</span>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {shares.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic py-2">No other collaborators have access to this deal yet.</p>
            ) : shares.map((sh) => (
              <div key={sh.id} className="flex items-center justify-between p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs">
                <div className="space-y-0.5">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">
                      {sh.collaborator_groups?.name || sh.group_name ? `👥 ${sh.collaborator_groups?.name || sh.group_name}` : `✉️ ${sh.shared_with_email || 'Direct Collaborator'}`}
                    </span>
                    {sh.permission === 'editor'
                      ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Editor</span>
                      : <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">Viewer</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">Access granted: {new Date(sh.created_at).toLocaleDateString()}</div>
                </div>
                <button type="button" onClick={() => remove(sh.id)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-rose-400 hover:text-white hover:bg-rose-600/30 border border-rose-800/40 transition">Remove</button>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-800 pt-3 flex items-center justify-between">
          <button type="button" onClick={copyLink}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-950 border border-slate-800 hover:border-slate-700 transition flex items-center space-x-1.5">
            <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            <span>{copied ? '✓ Link Copied!' : 'Copy Deal Link'}</span>
          </button>
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition">Done</button>
        </div>
      </div>
    </div>
  );
};
