import React, { useCallback, useEffect, useState } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabase/client';

type Row = Record<string, any>;

export interface EntityTarget {
  dealId: string;
  dealTitle?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** When set, entities can be attached to this property and new ones are attached on save. */
  target?: EntityTarget | null;
  onClearTarget?: () => void;
  /** Shown as a back arrow (used when opened from the Investor Profile). */
  onBack?: () => void;
  onChanged?: () => void;
}

const FN = `${SUPABASE_URL}/functions/v1/manage-entities`;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${data?.session?.access_token || SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
}

export const EntityManagerModal: React.FC<Props> = ({ isOpen, onClose, target, onClearTarget, onBack, onChanged }) => {
  const [entities, setEntities] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('llc');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(FN, { headers: await authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.entities)) return setEntities(data.entities);
      }
    } catch (e) {
      console.warn('[manage-entities] load failed, using direct query:', e);
    }
    const { data } = await supabase.from('entities').select('*').order('created_at', { ascending: false });
    setEntities((data as Row[]) || []);
  }, []);

  useEffect(() => {
    if (isOpen) { setError(null); void load(); }
  }, [isOpen, load]);

  if (!isOpen) return null;

  const changed = () => { window.dispatchEvent(new CustomEvent('mathtree:entity-changed')); onChanged?.(); };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(FN, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ name: trimmed, entity_type: type, formation_state: state.trim() || null, deal_id: target?.dealId ?? null }),
      });
      if (!res.ok) {
        const { data: auth } = await supabase.auth.getUser();
        const { data, error: insErr } = await supabase
          .from('entities')
          .insert({ name: trimmed, entity_type: type, formation_state: state.trim() || null, user_id: auth?.user?.id } as any)
          .select()
          .single();
        if (insErr) throw insErr;
        if (target?.dealId && data?.id) await supabase.from('deals').update({ entity_id: data.id }).eq('id', target.dealId);
      }
      setName(''); setState(''); setType('llc');
      await load();
      changed();
      if (target?.dealId) onClose();
    } catch (err) {
      setError(`Error creating entity: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Are you sure you want to remove this entity? Any properties assigned to it will be unassigned.')) return;
    setError(null);
    try {
      const res = await fetch(`${FN}?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() });
      if (!res.ok) {
        await supabase.from('deals').update({ entity_id: null }).eq('entity_id', id);
        const { error: delErr } = await supabase.from('entities').delete().eq('id', id);
        if (delErr) throw delErr;
      }
      await load();
      changed();
    } catch (err) {
      setError(`Error deleting entity: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const attach = async (entityId: string) => {
    if (!target?.dealId) return;
    setError(null);
    try {
      const res = await fetch(FN, {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'attach_to_deal', deal_id: target.dealId, entity_id: entityId }),
      });
      if (!res.ok) {
        const { error: upErr } = await supabase.from('deals').update({ entity_id: entityId }).eq('id', target.dealId);
        if (upErr) throw upErr;
      }
      changed();
      onClose();
    } catch (err) {
      setError(`Error assigning entity: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const field = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none';

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl flex flex-col max-h-[88vh] my-auto relative overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-900/95 backdrop-blur z-10">
          <div className="flex items-center space-x-2">
            <button type="button" onClick={onBack ?? onClose} className="p-1.5 -ml-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition" title="Back">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            </button>
            <h3 className="text-base font-bold text-white flex items-center space-x-2"><span className="text-emerald-400">🏛️</span><span>Manage Legal Entities (LLCs)</span></h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white hover:bg-slate-800 p-1.5 rounded-lg transition text-base leading-none font-bold" title="Close">✕</button>
        </div>

        {target?.dealId && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40">
            <div className="flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Target Property:</span>
                <strong className="text-white">{target.dealTitle || 'Selected Deal'}</strong>
              </div>
              {onClearTarget && <button type="button" onClick={onClearTarget} className="text-[11px] text-slate-400 hover:text-white underline">Clear</button>}
            </div>
          </div>
        )}

        <div className="overflow-y-auto px-6 py-4 flex-1">
          <div className="space-y-2 mb-5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Entities</label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {entities.length === 0 ? (
                <div className="text-xs text-slate-500 italic p-3 text-center bg-slate-950 rounded-xl border border-slate-800/60">No legal entities registered yet. Register your first structure below.</div>
              ) : entities.map((en) => {
                const dealsCount = en.deals_count || (Array.isArray(en.deals) ? en.deals.length : 0);
                return (
                  <div key={en.id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-xs truncate">{en.name}</span>
                        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 text-emerald-400">{String(en.entity_type || 'LLC').toUpperCase()}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {en.formation_state || 'State unassigned'}{' '}
                        {dealsCount > 0 && <span className="text-[10px] text-emerald-400 font-semibold">• {dealsCount} linked deal{dealsCount > 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      {target?.dealId && (
                        <button type="button" onClick={() => attach(en.id)} className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition">✓ Attach</button>
                      )}
                      <button type="button" onClick={() => remove(en.id)} className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition" title="Delete Entity">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <form onSubmit={create} className="border-t border-slate-800 pt-4 space-y-3 text-xs">
            <span className="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider">+ Register New Legal Entity</span>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Entity Legal Name *</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cascade Property Group LLC" className={field} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 font-bold mb-1">Structure Type</label>
                <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
                  <option value="llc">LLC (Limited Liability Co.)</option>
                  <option value="series_llc">Series LLC</option>
                  <option value="lp">LP (Limited Partnership)</option>
                  <option value="corporation">Corporation (C/S-Corp)</option>
                  <option value="trust">Land Trust / Trust</option>
                  <option value="individual">Individual</option>
                  <option value="tic">Tenants in Common (TIC)</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1">Formation State</label>
                <input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. WA, DE, WY" className={field} />
              </div>
            </div>
            {error && <p className="text-[11px] font-semibold text-rose-400">{error}</p>}
            <button type="submit" disabled={busy} className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-md shadow-emerald-900/30 flex items-center justify-center space-x-2 disabled:opacity-60">
              <span>{target?.dealId ? 'Save & Attach to Property' : 'Save Entity'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
