/**
 * Where to mount: the owned-deal Operations tab of the deal screen, once that rework lands. The parent passes the deal id and the
 * signed-in user's id. Not wired in yet. Needs draft migration 12 (public.expense_entries) applied; until then it shows a setup message.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import {
  EXPENSE_CATEGORY_LABELS, totalsByCategory, trailing12Months,
  type ExpenseCategory, type ExpenseEntry,
} from '../../lib/operations/expenses';
import { formatDateInput, parseDateInput } from '../../lib/operations/recoveryInput';
import { money } from './money';

interface Props { dealId: string; userId: string }

const field = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none';
const lbl = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';
const today = () => new Date().toISOString().split('T')[0];
// The generated DB types don't know expense_entries until migration 12 is applied and types are regenerated; then drop this cast.
const expenseTable = () => (supabase as any).from('expense_entries');
const CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

export const ExpenseLedger: React.FC<Props> = ({ dealId, userId }) => {
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [date, setDate] = useState(formatDateInput(today()));
  const [category, setCategory] = useState<ExpenseCategory>('repairs_maintenance');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [recurring, setRecurring] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await expenseTable().select('*').eq('deal_id', dealId)
      .order('expense_date', { ascending: false });
    if (error) { setUnavailable(true); setLoaded(true); return; }
    setUnavailable(false);
    setEntries((data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })) as ExpenseEntry[]);
    setLoaded(true);
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  const t12 = useMemo(() => trailing12Months(entries, today()), [entries]);
  const byCategory = useMemo(() => {
    const [y, m] = today().split('-').map(Number);
    const from = t12.months[0]?.month ?? `${y}-${String(m).padStart(2, '0')}`;
    return totalsByCategory(entries, { from: `${from}-01`, to: today() });
  }, [entries, t12]);

  const add = async () => {
    setErr(null);
    const iso = parseDateInput(date);
    if (!iso) { setErr('Type the date like 10/15/2026.'); return; }
    const amt = Number(amount.replace(/[$,\s]/g, ''));
    if (amount.trim() === '' || !Number.isFinite(amt) || amt < 0) { setErr('Amount must be a number, 0 or more.'); return; }
    setBusy(true);
    const { error } = await expenseTable().insert({
      user_id: userId, deal_id: dealId, expense_date: iso, category, amount: amt,
      vendor_note: note.trim() || null, recurring,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setAmount(''); setNote(''); setRecurring(false);
    await load();
  };

  const remove = async (e: ExpenseEntry) => {
    if (!window.confirm(`Delete this ${money(e.amount)} ${EXPENSE_CATEGORY_LABELS[e.category]} expense?`)) return;
    const { error } = await expenseTable().delete().eq('id', e.id);
    if (error) { setErr(error.message); return; }
    await load();
  };

  if (!loaded) return <p className="text-xs text-slate-500">Loading expenses…</p>;
  if (unavailable) return <p className="text-xs text-slate-500">Expense ledger isn't set up yet.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
        <div><label className={lbl}>Date</label><input className={field} value={date} onChange={(e) => setDate(e.target.value)} placeholder="10/15/2026" /></div>
        <div>
          <label className={lbl}>Category</label>
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div><label className={lbl}>Amount</label><input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        <div className="col-span-2"><label className={lbl}>Vendor or note</label><input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-emerald-500" /> Recurring
          </label>
          <button type="button" disabled={busy} onClick={() => { void add(); }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">Add</button>
        </div>
      </div>
      {err && <p className="text-[11px] text-rose-400">{err}</p>}

      <div className="text-xs text-slate-300">
        <span className="font-bold">Last 12 months:</span> {money(t12.total)}
        {byCategory.length > 0 && (
          <span className="text-slate-500"> · {byCategory.slice(0, 4).map((c) => `${EXPENSE_CATEGORY_LABELS[c.category]} ${money(c.total)}`).join(' · ')}</span>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-500">No expenses recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <span className="w-24 text-slate-400">{formatDateInput(e.expense_date)}</span>
              <span className="w-40 text-white">{EXPENSE_CATEGORY_LABELS[e.category]}</span>
              <span className="flex-1 truncate text-slate-400">{e.vendor_note ?? ''}</span>
              {e.recurring && <span className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-[10px] text-slate-300">Recurring</span>}
              <span className="w-24 text-right font-mono text-white">{money(e.amount)}</span>
              <button type="button" onClick={() => { void remove(e); }} className="text-slate-500 hover:text-rose-400" aria-label="Delete expense">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
