import React, { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import {
  RECOVERY_CATEGORY_LABELS, defaultTrackRecoveries, itemStatus, proRataSharePct,
  type RecoveryCategory, type RecoveryFrequency, type RecoveryMode, type RecoveryStatus,
} from '../../lib/operations/recoveries';
import { setItemDone, syncRecoveryItems } from '../../lib/operations/recoveryDb';
import { formatDateInput, parseDateInput, parsePercentInput } from '../../lib/operations/recoveryInput';
import { CamReconciliation } from './CamReconciliation';
import { money } from './money';
import { MeterBilling } from './MeterBilling';

type Row = Record<string, any>;

interface Props {
  lease: Row;
  /** A tenancy derived from deal inputs has no lease row yet, so nothing can be saved against it. */
  derived: boolean;
  /** Property gross leasable sqft and this tenant's sqft, used to suggest a pro-rata share. */
  propertySqft: number | null;
  unitSqft: number | null;
  terms: Row[];
  items: Row[];
  recons: Row[];
  meters: Row[];
  readings: Row[];
  /** Owner's reminder lead time per category, so "Due soon" here matches the alerts. */
  leadDays?: Partial<Record<RecoveryCategory, number>>;
  onChanged: () => void;
}


const STATUS_STYLE: Record<RecoveryStatus, string> = {
  complete: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  overdue: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  due_soon: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  upcoming: 'bg-slate-800 text-slate-300 border-slate-700',
};
const STATUS_LABEL: Record<RecoveryStatus, string> = { complete: 'Done', overdue: 'Overdue', due_soon: 'Due soon', upcoming: 'Upcoming' };
const FREQ_LABEL: Record<RecoveryFrequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Twice a year', annual: 'Yearly' };
const MODE_LABEL: Record<RecoveryMode, string> = { direct_pay: 'Tenant pays vendor', reimburse: 'Tenant reimburses us' };
const field = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none';
const lbl = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';
const today = () => new Date().toISOString().split('T')[0];

export const RecoveriesPanel: React.FC<Props> = ({ lease, derived, propertySqft, unitSqft, terms, items, recons, meters, readings, leadDays, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const [category, setCategory] = useState<RecoveryCategory>('property_tax');
  const [mode, setMode] = useState<RecoveryMode>('direct_pay');
  const [basis, setBasis] = useState<'pro_rata_share' | 'fixed_amount' | 'actual_metered'>('fixed_amount');
  const [frequency, setFrequency] = useState<RecoveryFrequency>('semiannual');
  const [firstDue, setFirstDue] = useState(formatDateInput(today()));
  const [amount, setAmount] = useState('');
  const [sharePct, setSharePct] = useState('');
  const [label, setLabel] = useState('');

  const leaseTerms = useMemo(() => terms.filter((t) => t.lease_id === lease.id && t.is_active !== false), [terms, lease.id]);
  const leaseItems = useMemo(() => items.filter((i) => i.lease_id === lease.id), [items, lease.id]);
  const termById = useMemo(() => new Map(leaseTerms.map((t) => [t.id, t])), [leaseTerms]);
  const suggestedShare = proRataSharePct(unitSqft, propertySqft);
  const tracked = Boolean(lease.track_recoveries);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const toggleTracking = (on: boolean) => run(async () => {
    const { error } = await supabase.from('leases').update({ track_recoveries: on, updated_at: new Date().toISOString() } as never).eq('id', lease.id);
    if (error) throw new Error(error.message);
  });

  const addTerm = () => run(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) throw new Error('Sign in again to save.');
    const dueIso = parseDateInput(firstDue);
    if (!dueIso) throw new Error('Type the next due date like 10/15/2026.');
    const share = parsePercentInput(sharePct);
    if (Number.isNaN(share)) throw new Error('Tenant share must be a number from 0 to 100, like 25.');
    const { data, error } = await supabase.from('lease_recovery_terms').insert({
      user_id: uid, lease_id: lease.id, deal_id: lease.deal_id, category, mode, basis, frequency,
      first_due_date: dueIso, expected_amount: amount.trim() === '' ? null : Number(amount), share_pct: share, label: label.trim(),
    }).select().single();
    if (error) {
      throw new Error(error.code === '23505' ? `This lease already has a ${RECOVERY_CATEGORY_LABELS[category]} entry. Add a label to tell them apart.` : error.message);
    }
    await syncRecoveryItems([data], []);
    setAdding(false); setAmount(''); setSharePct(''); setLabel('');
  });

  const removeTerm = (t: Row) => {
    if (!window.confirm(`Remove ${RECOVERY_CATEGORY_LABELS[t.category as RecoveryCategory]} tracking and its history for ${lease.tenant_name}?`)) return;
    void run(async () => {
      const { error } = await supabase.from('lease_recovery_terms').delete().eq('id', t.id);
      if (error) throw new Error(error.message);
    });
  };

  const pickCategory = (c: RecoveryCategory) => {
    setCategory(c);
    if (c === 'property_tax') { setMode('direct_pay'); setFrequency('semiannual'); setBasis('fixed_amount'); }
    else if (c === 'insurance') { setMode('direct_pay'); setFrequency('annual'); setBasis('fixed_amount'); }
    else if (c === 'cam') { setMode('reimburse'); setFrequency('monthly'); setBasis('pro_rata_share'); }
    else if (c === 'utilities_submetered') { setMode('reimburse'); setFrequency('monthly'); setBasis('actual_metered'); }
  };

  const views = leaseItems.flatMap((item) => {
    const term = termById.get(item.term_id);
    if (!term) return [];
    return [{ item, term, status: itemStatus(item as any, term.mode, today(), { dueSoonDays: leadDays?.[term.category as RecoveryCategory] }) }];
  }).sort((a, b) => a.item.due_date.localeCompare(b.item.due_date));
  const open = views.filter((v) => v.status !== 'complete');
  const done = views.filter((v) => v.status === 'complete').reverse();
  const camTerm = leaseTerms.find((t) => t.category === 'cam');
  const meterTerms = leaseTerms.filter((t) => t.category === 'utilities_submetered');

  if (derived) {
    return <p className="text-xs text-slate-500">Set up this tenancy as a lease first (Edit lease), then you can track what the tenant owes beyond rent.</p>;
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
        <input type="checkbox" checked={tracked} disabled={busy} onChange={(e) => { void toggleTracking(e.target.checked); }} className="mt-0.5 accent-emerald-500" />
        <span>
          <span className="font-bold">Track tenant-paid taxes, insurance, CAM &amp; utilities</span>
          <span className="block text-slate-500">
            {defaultTrackRecoveries(lease.lease_type) ? 'Usually on for NNN leases.' : 'Off by default for this lease type.'} Tracking only, none of this changes your underwriting.
          </span>
        </span>
      </label>

      {err && <p className="text-[11px] text-rose-400">{err}</p>}

      {tracked && (
        <>
          <div>
            <h5 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">What the tenant owes</h5>
            {leaseTerms.length === 0 && <p className="text-xs text-slate-500 mb-2">Nothing set up yet. Add property tax, insurance, CAM or utilities below.</p>}
            <ul className="space-y-1">
              {leaseTerms.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-[11px] bg-slate-900 rounded-lg px-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-200">
                    <span className="font-bold">{RECOVERY_CATEGORY_LABELS[t.category as RecoveryCategory]}{t.label ? ` · ${t.label}` : ''}</span>
                    <span className="text-slate-500"> · {MODE_LABEL[t.mode as RecoveryMode]} · {FREQ_LABEL[t.frequency as RecoveryFrequency]}{t.expected_amount != null ? ` · ${money(t.expected_amount)}` : ''}{t.share_pct != null ? ` · ${t.share_pct}% share` : ''}</span>
                  </span>
                  <button type="button" disabled={busy} onClick={() => removeTerm(t)} className="shrink-0 text-slate-500 hover:text-rose-400 transition" aria-label="Remove">✕</button>
                </li>
              ))}
            </ul>

            {!adding ? (
              <button type="button" onClick={() => setAdding(true)} className="mt-2 px-3 py-1.5 rounded-lg text-[11px] font-bold text-emerald-200 bg-emerald-950/60 border border-emerald-700 hover:bg-emerald-700 transition">+ Add item</button>
            ) : (
              <div className="mt-2 p-3 bg-slate-900/70 border border-slate-800 rounded-xl grid grid-cols-2 gap-3">
                <div><label className={lbl}>What</label>
                  <select value={category} onChange={(e) => pickCategory(e.target.value as RecoveryCategory)} className={field}>
                    {(Object.keys(RECOVERY_CATEGORY_LABELS) as RecoveryCategory[]).map((c) => <option key={c} value={c}>{RECOVERY_CATEGORY_LABELS[c]}</option>)}
                  </select></div>
                <div><label className={lbl}>Who pays the vendor</label>
                  <select value={mode} onChange={(e) => setMode(e.target.value as RecoveryMode)} className={field}>
                    <option value="direct_pay">Tenant pays vendor (we confirm)</option>
                    <option value="reimburse">We pay, tenant reimburses</option>
                  </select></div>
                <div><label className={lbl}>How often</label>
                  <select value={frequency} onChange={(e) => setFrequency(e.target.value as RecoveryFrequency)} className={field}>
                    {(Object.keys(FREQ_LABEL) as RecoveryFrequency[]).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
                  </select></div>
                <div><label className={lbl}>Next due date</label>
                  <input type="text" inputMode="numeric" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} placeholder="MM/DD/YYYY" className={field} /></div>
                <div><label className={lbl}>Amount each time (optional)</label>
                  <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1250" className={field} /></div>
                <div><label className={lbl}>Tenant share % (optional)</label>
                  <input type="text" inputMode="decimal" value={sharePct} onChange={(e) => setSharePct(e.target.value)} placeholder="e.g. 25" className={field} />
                  {suggestedShare != null && <p className="mt-1 text-[10px] text-slate-500">This suite is {suggestedShare}% of the building by square footage. {sharePct.trim() !== String(suggestedShare) && <button type="button" onClick={() => setSharePct(String(suggestedShare))} className="text-emerald-400 hover:underline">Use {suggestedShare}%</button>}</p>}
                </div>
                <div className="col-span-2"><label className={lbl}>Label (optional, to tell two of the same apart)</label>
                  <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Parcel 2" className={field} /></div>
                <div className="col-span-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => { void addTerm(); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition">Save</button>
                  <button type="button" onClick={() => { setAdding(false); setErr(null); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {leaseTerms.length > 0 && (
            <div>
              <h5 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">To track</h5>
              {open.length === 0 ? (
                <p className="text-xs text-emerald-400">✓ Everything is up to date.</p>
              ) : (
                <ul className="space-y-1">
                  {open.map(({ item, term, status }) => <ItemRow key={item.id} item={item} term={term} status={status} busy={busy} onDone={(d) => run(() => setItemDone(item, term.mode, d, item.amount_actual ?? item.amount_expected))} />)}
                </ul>
              )}
              {done.length > 0 && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowDone((s) => !s)} className="text-[11px] text-slate-400 hover:text-white transition">{showDone ? 'Hide' : 'Show'} completed ({done.length})</button>
                  {showDone && (
                    <ul className="space-y-1 mt-1">
                      {done.slice(0, 12).map(({ item, term, status }) => <ItemRow key={item.id} item={item} term={term} status={status} busy={busy} onDone={(d) => run(() => setItemDone(item, term.mode, d))} />)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {camTerm && <CamReconciliation lease={lease} camTerm={camTerm} camItems={leaseItems.filter((i) => i.category === 'cam')} recons={recons.filter((r) => r.lease_id === lease.id)} onChanged={onChanged} />}
          {meterTerms.length > 0 && (
            <MeterBilling lease={lease} meterTerms={meterTerms} items={leaseItems} meters={meters.filter((m) => m.lease_id === lease.id)} readings={readings.filter((r) => r.lease_id === lease.id)} onChanged={onChanged} />
          )}
        </>
      )}
    </div>
  );
};

const ItemRow: React.FC<{ item: Row; term: Row; status: RecoveryStatus; busy: boolean; onDone: (done: boolean) => void }> = ({ item, term, status, busy, onDone }) => {
  const direct = term.mode === 'direct_pay';
  const amt = item.amount_actual ?? item.amount_expected;
  const needsReading = term.basis === 'actual_metered' && amt == null && status !== 'complete';
  return (
    <li className="flex items-center justify-between gap-2 text-[11px] bg-slate-900 rounded-lg px-3 py-1.5">
      <span className="min-w-0 truncate">
        <span className="font-mono text-slate-400">{item.due_date}</span>{' '}
        <span className="font-bold text-slate-200">{RECOVERY_CATEGORY_LABELS[term.category as RecoveryCategory]}{term.label ? ` · ${term.label}` : ''}</span>
        {amt != null && <span className="font-mono text-slate-400"> {money(amt)}</span>}
      </span>
      <span className="shrink-0 flex items-center gap-2">
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
        {status === 'complete' ? (
          <button type="button" disabled={busy} onClick={() => onDone(false)} className="text-slate-500 hover:text-white transition">Undo</button>
        ) : needsReading ? (
          <span className="text-slate-500" title="Enter the meter reading below to bill this">Needs reading</span>
        ) : direct ? (
          <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
            <input type="checkbox" disabled={busy} checked={false} onChange={() => onDone(true)} className="accent-emerald-500" /> Verified paid
          </label>
        ) : (
          <button type="button" disabled={busy} onClick={() => onDone(true)} className="px-2 py-0.5 rounded-md font-bold text-emerald-200 bg-emerald-950/80 border border-emerald-600 hover:bg-emerald-600 transition">Mark paid</button>
        )}
      </span>
    </li>
  );
};
