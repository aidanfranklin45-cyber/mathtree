import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase/client';

/**
 * The rent checklist: a public, no-sign-in page opened from the "Manage rent payments" button in a digest email. The one-time token in the
 * link is the credential and covers exactly the tenants in that email. Tick the people who paid and press Save: ticked tenants are recorded
 * as paid, unticked tenants are snoozed (the owner's snooze setting) and followed up from there. Reopening the link lets you correct a mistake.
 */

type RowState = 'unpaid' | 'snoozed' | 'paid_here' | 'paid_other';

interface Row {
  lease_id: string;
  tenant_name: string;
  space: string;
  amount_due: number;
  amount_paid: number;
  snooze_until: string | null;
  state: RowState;
}

interface Batch {
  deal_title: string;
  period_month: string;
  kind: 'reminder' | 'followup';
  snooze_days: number | null;
  expires_at: string;
  rows: Row[];
}

interface Saved {
  paid: number;
  snoozed: number;
  already_recorded: number;
  snooze_days: number;
}

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const monthLabel = (iso: string) => {
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export const RentChecklist: React.FC<{ token: string }> = ({ token }) => {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('get_rent_batch_by_token' as never, { p_token: token } as never);
    const res = data as unknown as (Batch & { success: boolean; error?: string }) | null;
    if (rpcErr || !res || !res.success) {
      setError(res?.error || rpcErr?.message || 'This link is invalid or has expired.');
      return;
    }
    setBatch(res);
    // Already ticked on an earlier visit stays ticked, so a correction is just an untick
    setTicked(new Set(res.rows.filter((r) => r.state === 'paid_here').map((r) => r.lease_id)));
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { document.title = 'Manage rent payments | MathTree'; }, []);

  const editable = useMemo(() => (batch?.rows ?? []).filter((r) => r.state !== 'paid_other'), [batch]);
  const tickedRows = editable.filter((r) => ticked.has(r.lease_id));
  const unticked = editable.length - tickedRows.length;
  const tickedTotal = tickedRows.reduce((s, r) => s + Number(r.amount_due || 0), 0);
  const snoozeText = batch?.snooze_days ? `${batch.snooze_days} day${batch.snooze_days === 1 ? '' : 's'}` : "each lease's grace period";

  const toggle = (id: string) => setTicked((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async () => {
    if (!batch) return;
    setSaving(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('submit_rent_batch_by_token' as never, { p_token: token, p_paid: [...ticked] } as never);
    setSaving(false);
    const res = data as unknown as (Saved & { success: boolean; error?: string }) | null;
    if (rpcErr || !res || !res.success) {
      setError(res?.error || rpcErr?.message || 'Could not save. Please try again.');
      return;
    }
    setSaved(res);
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 sm:p-8">{children}</div>
    </div>
  );

  if (error && !batch) {
    return shell(
      <div className="text-center space-y-3">
        <div className="text-3xl">⚠️</div>
        <h1 className="text-xl font-extrabold text-white">This link can't be used</h1>
        <p className="text-sm text-slate-400">{error} Open Operations to record payments, or use the link in your most recent rent email.</p>
        <Link to="/operations" className="inline-block mt-2 px-4 py-2.5 rounded-xl bg-emerald-500 text-emerald-950 font-bold text-sm">Open Operations</Link>
      </div>,
    );
  }

  if (!batch) {
    return shell(
      <div className="text-center py-8">
        <div className="mx-auto w-8 h-8 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin" />
        <p className="text-xs text-slate-500 mt-3">Loading your tenants…</p>
      </div>,
    );
  }

  if (saved) {
    return shell(
      <div className="space-y-4">
        <div className="text-center space-y-1">
          <div className="text-3xl">✓</div>
          <h1 className="text-xl font-extrabold text-white">Saved</h1>
          <p className="text-sm text-slate-400">{batch.deal_title} &middot; {monthLabel(batch.period_month)}</p>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm space-y-2">
          <div className="flex justify-between"><span className="text-slate-400">Marked paid</span><strong className="text-emerald-400">{saved.paid}</strong></div>
          <div className="flex justify-between"><span className="text-slate-400">Snoozed for {saved.snooze_days} day{saved.snooze_days === 1 ? '' : 's'}</span><strong className="text-amber-300">{saved.snoozed}</strong></div>
          {saved.already_recorded > 0 && <div className="flex justify-between"><span className="text-slate-400">Already recorded paid (left alone)</span><strong className="text-slate-200">{saved.already_recorded}</strong></div>}
        </div>
        <p className="text-xs text-slate-500 text-center">Snoozed tenants get a follow-up when the snooze ends. You can reopen this link to change an answer.</p>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => { setSaved(null); void load(); }} className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-bold text-sm">Change my answers</button>
          <Link to="/operations" className="px-4 py-2.5 rounded-xl bg-emerald-500 text-emerald-950 font-bold text-sm text-center">Open Operations</Link>
        </div>
      </div>,
    );
  }

  return shell(
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-extrabold text-emerald-400 uppercase tracking-widest mb-1">MathTree &bull; {batch.kind === 'followup' ? 'Past-due rent' : 'Rent checklist'}</div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-white">{batch.deal_title}</h1>
        <p className="text-sm text-slate-400">{monthLabel(batch.period_month)} &middot; tick everyone who has paid, then Save.</p>
      </div>

      {error && <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">{error}</div>}

      <div className="flex items-center justify-between text-xs">
        <div className="space-x-2">
          <button type="button" onClick={() => setTicked(new Set(editable.map((r) => r.lease_id)))} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 font-semibold">Everyone paid</button>
          <button type="button" onClick={() => setTicked(new Set())} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 font-semibold">Clear</button>
        </div>
        <span className="text-slate-500">{tickedRows.length} of {editable.length} ticked</span>
      </div>

      <ul className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
        {batch.rows.map((r) => {
          const locked = r.state === 'paid_other';
          const on = locked || ticked.has(r.lease_id);
          return (
            <li key={r.lease_id}>
              <label className={`flex items-center gap-3 px-3.5 py-3.5 ${locked ? 'opacity-70' : 'cursor-pointer hover:bg-slate-900/60'} ${on && !locked ? 'bg-emerald-500/5' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={() => toggle(r.lease_id)}
                  className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 shrink-0"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-white truncate">{r.tenant_name}</span>
                  <span className="block text-[11px] text-slate-400 truncate">
                    {r.space || 'Main space'}
                    {r.state === 'snoozed' && r.snooze_until ? <span className="text-amber-300"> &middot; snoozed until {r.snooze_until}</span> : null}
                    {locked ? <span className="text-emerald-400"> &middot; already recorded as paid</span> : null}
                  </span>
                </span>
                <span className="text-sm font-extrabold text-emerald-400 tabular-nums">{money(r.amount_due)}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-400 space-y-1">
        <div className="flex justify-between"><span>Will be marked paid</span><strong className="text-emerald-400">{tickedRows.length} &middot; {money(tickedTotal)}</strong></div>
        <div className="flex justify-between"><span>Will be snoozed for {snoozeText}</span><strong className="text-amber-300">{unticked}</strong></div>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving || editable.length === 0}
        className="w-full px-4 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-extrabold text-sm transition disabled:opacity-50"
      >
        {saving ? 'Saving…' : `Save (${tickedRows.length} paid, ${unticked} snoozed)`}
      </button>
      <p className="text-[11px] text-slate-500 text-center leading-relaxed">
        No sign-in needed. A different amount, or part of a payment? Save the rest here and use Log Payment in Operations for that tenant.
      </p>
    </div>,
  );
};
