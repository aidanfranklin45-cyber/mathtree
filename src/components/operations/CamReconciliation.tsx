import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { estimatesPaidInYear, reconcileCam } from '../../lib/operations/recoveries';
import { money } from './money';

type Row = Record<string, any>;

interface Props {
  lease: Row;
  camTerm: Row;
  camItems: Row[];
  recons: Row[];
  onChanged: () => void;
}

const field = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none';
const lbl = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';
const num = (s: string) => (s.trim() === '' ? 0 : Number(s));

/** Year-end CAM true-up: the tenant's share of actual expenses (after any cap) against the estimates they already paid. */
export const CamReconciliation: React.FC<Props> = ({ lease, camTerm, camItems, recons, onChanged }) => {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - 1);
  const existing = recons.find((r) => r.year === year);
  const prior = recons.find((r) => r.year === year - 1);
  const paidEstimates = useMemo(() => estimatesPaidInYear(camItems as any, year), [camItems, year]);

  const [expenses, setExpenses] = useState('');
  const [share, setShare] = useState('');
  const [estimates, setEstimates] = useState('');
  const [cap, setCap] = useState('');
  const [priorBilled, setPriorBilled] = useState('');
  const [adminFee, setAdminFee] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load the saved reconciliation for the year, or prefill from what the lease already knows.
  useEffect(() => {
    setErr(null);
    if (existing) {
      setExpenses(String(existing.total_expenses ?? '')); setShare(String(existing.share_pct ?? ''));
      setEstimates(String(existing.estimates_paid ?? '')); setCap(existing.cap_pct != null ? String(existing.cap_pct) : '');
      setPriorBilled(existing.prior_year_billed != null ? String(existing.prior_year_billed) : '');
      setAdminFee(existing.admin_fee_pct != null ? String(existing.admin_fee_pct) : ''); setNotes(existing.notes ?? '');
    } else {
      setExpenses(''); setShare(camTerm.share_pct != null ? String(camTerm.share_pct) : '');
      setEstimates(paidEstimates ? String(paidEstimates) : ''); setCap('');
      setPriorBilled(prior ? String(prior.charge) : ''); setAdminFee(''); setNotes('');
    }
    // Re-run only when the year or the saved row changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, existing?.id, existing?.updated_at]);

  const result = reconcileCam({
    totalExpenses: num(expenses), sharePct: num(share), estimatesPaid: num(estimates),
    capPct: cap.trim() === '' ? null : Number(cap), priorYearBilled: priorBilled.trim() === '' ? null : Number(priorBilled),
    adminFeePct: adminFee.trim() === '' ? null : Number(adminFee),
  });
  const status: string = existing?.status ?? 'draft';

  const save = async (nextStatus: 'draft' | 'billed' | 'settled') => {
    setBusy(true); setErr(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) throw new Error('Sign in again to save.');
      if (num(expenses) <= 0) throw new Error('Enter the total CAM expenses for the year.');
      const { error } = await supabase.from('cam_reconciliations').upsert({
        user_id: uid, lease_id: lease.id, deal_id: lease.deal_id, year,
        total_expenses: num(expenses), share_pct: num(share), estimates_paid: num(estimates),
        cap_pct: cap.trim() === '' ? null : Number(cap), prior_year_billed: priorBilled.trim() === '' ? null : Number(priorBilled),
        admin_fee_pct: adminFee.trim() === '' ? null : Number(adminFee),
        charge: result.charge, true_up: result.trueUp, cap_applied: result.capApplied,
        status: nextStatus, settled_date: nextStatus === 'settled' ? new Date().toISOString().split('T')[0] : null,
        notes: notes.trim() || null, updated_at: new Date().toISOString(),
      } as never, { onConflict: 'lease_id,year' });
      if (error) throw new Error(error.message);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  const owed = result.trueUp > 0 ? `Tenant owes ${money(result.trueUp)}` : result.trueUp < 0 ? `Refund due to tenant ${money(-result.trueUp)}` : 'Even, nothing owed';

  return (
    <div>
      <h5 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">CAM year-end reconciliation</h5>
      <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-3">
        <div className="flex items-center justify-between gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${field} !w-28`} aria-label="Year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{existing ? status : 'not started'}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Total CAM expenses</label><input type="number" min="0" step="0.01" value={expenses} onChange={(e) => setExpenses(e.target.value)} className={field} /></div>
          <div><label className={lbl}>Tenant share %</label><input type="number" min="0" max="100" step="0.01" value={share} onChange={(e) => setShare(e.target.value)} className={field} /></div>
          <div><label className={lbl}>Estimates paid</label><input type="number" min="0" step="0.01" value={estimates} onChange={(e) => setEstimates(e.target.value)} className={field} />
            {paidEstimates > 0 && num(estimates) !== paidEstimates && <button type="button" onClick={() => setEstimates(String(paidEstimates))} className="mt-1 text-[10px] text-emerald-400 hover:underline">Use {money(paidEstimates)} marked paid in {year}</button>}</div>
          <div><label className={lbl}>Admin fee % (optional)</label><input type="number" min="0" step="0.01" value={adminFee} onChange={(e) => setAdminFee(e.target.value)} className={field} /></div>
          <div><label className={lbl}>Annual cap % (optional)</label><input type="number" min="0" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} className={field} /></div>
          <div><label className={lbl}>Billed last year</label><input type="number" min="0" step="0.01" value={priorBilled} onChange={(e) => setPriorBilled(e.target.value)} disabled={cap.trim() === ''} placeholder={cap.trim() === '' ? 'needed for a cap' : ''} className={`${field} disabled:opacity-40`} /></div>
        </div>

        <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-[11px] space-y-0.5">
          <div className="flex justify-between text-slate-400"><span>Tenant's charge for {year}</span><span className="font-mono text-slate-200">{money(result.charge)}</span></div>
          {result.capApplied && <div className="flex justify-between text-amber-300"><span>Cap applied (uncapped {money(result.uncappedCharge)})</span><span /></div>}
          <div className="flex justify-between font-bold"><span className={result.trueUp > 0 ? 'text-amber-300' : 'text-emerald-400'}>{owed}</span><span className="font-mono">{result.trueUp > 0 ? '+' : ''}{money(result.trueUp)}</span></div>
        </div>

        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className={field} />
        {err && <p className="text-[11px] text-rose-400">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || status === 'settled'} onClick={() => { void save('draft'); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition">Save draft</button>
          <button type="button" disabled={busy || status === 'settled'} onClick={() => { void save('billed'); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-blue-200 bg-blue-950/60 border border-blue-700 hover:bg-blue-700 disabled:opacity-40 transition">Mark billed to tenant</button>
          <button type="button" disabled={busy || status === 'settled'} onClick={() => { void save('settled'); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-emerald-200 bg-emerald-950/60 border border-emerald-700 hover:bg-emerald-700 disabled:opacity-40 transition">Mark settled</button>
          {status === 'settled' && <button type="button" disabled={busy} onClick={() => { void save('billed'); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white transition">Reopen</button>}
        </div>
      </div>
    </div>
  );
};
