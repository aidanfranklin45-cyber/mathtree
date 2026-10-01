import React, { useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { meterCharge } from '../../lib/operations/recoveries';
import { money } from './money';

type Row = Record<string, any>;

interface Props {
  lease: Row;
  /** The lease's submetered-utility terms; each meter belongs to one. */
  meterTerms: Row[];
  items: Row[];
  meters: Row[];
  readings: Row[];
  onChanged: () => void;
}

const field = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none';
const lbl = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';
const today = () => new Date().toISOString().split('T')[0];
const UTILITY_UNITS: Record<string, string> = { electric: 'kWh', water: 'gal', gas: 'therm', sewer: 'gal', other: 'unit' };

/** Submetered utilities: enter a meter reading against a scheduled billing item and it fills in the amount the tenant owes. */
export const MeterBilling: React.FC<Props> = ({ lease, meterTerms, items, meters, readings, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [mLabel, setMLabel] = useState('');
  const [mType, setMType] = useState('electric');
  const [mUnit, setMUnit] = useState('kWh');
  const [mRate, setMRate] = useState('');
  const [mMult, setMMult] = useState('1');
  const [mBase, setMBase] = useState('');
  const [mTerm, setMTerm] = useState<string>(meterTerms[0]?.id ?? '');

  const [openMeter, setOpenMeter] = useState<string | null>(null);
  const [curr, setCurr] = useState('');
  const [itemId, setItemId] = useState('');
  const [date, setDate] = useState(today());

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const lastReading = (meterId: string) => readings.filter((r) => r.meter_id === meterId).sort((a, b) => b.reading_date.localeCompare(a.reading_date))[0];
  /** Scheduled items for this meter's term that have not been billed from a reading yet. */
  const unbilled = (meter: Row) => items
    .filter((i) => i.term_id === meter.term_id && i.amount_actual == null && !i.paid_date && !i.verified)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const addMeter = () => run(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) throw new Error('Sign in again to save.');
    if (!mLabel.trim()) throw new Error('Name the meter (e.g. Suite 4 electric).');
    if (!(Number(mRate) >= 0) || mRate.trim() === '') throw new Error('Enter the rate per unit.');
    const { error } = await supabase.from('utility_meters').insert({
      user_id: uid, lease_id: lease.id, deal_id: lease.deal_id, term_id: mTerm || null, label: mLabel.trim(),
      utility_type: mType, unit_of_measure: mUnit.trim() || 'unit', rate_per_unit: Number(mRate),
      multiplier: Number(mMult) > 0 ? Number(mMult) : 1, base_charge: mBase.trim() === '' ? 0 : Number(mBase),
    });
    if (error) throw new Error(error.message);
    setAdding(false); setMLabel(''); setMRate(''); setMBase('');
  });

  const removeMeter = (m: Row) => {
    if (!window.confirm(`Remove meter "${m.label}" and its readings?`)) return;
    void run(async () => {
      const { error } = await supabase.from('utility_meters').delete().eq('id', m.id);
      if (error) throw new Error(error.message);
    });
  };

  const startReading = (m: Row) => {
    setOpenMeter(m.id); setCurr(''); setDate(today()); setErr(null);
    setItemId(unbilled(m)[0]?.id ?? '');
  };

  const saveReading = (m: Row) => run(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) throw new Error('Sign in again to save.');
    const prev = lastReading(m.id)?.current_reading ?? 0;
    const calc = meterCharge({ previousReading: Number(prev), currentReading: Number(curr), ratePerUnit: m.rate_per_unit, multiplier: m.multiplier, baseCharge: m.base_charge });
    if (curr.trim() === '' || calc.error) throw new Error(calc.error ?? 'Enter the current reading.');
    const { error } = await supabase.from('meter_readings').insert({
      user_id: uid, meter_id: m.id, lease_id: lease.id, deal_id: lease.deal_id, item_id: itemId || null, reading_date: date,
      previous_reading: Number(prev), current_reading: Number(curr), usage: calc.usage, charge: calc.charge,
    });
    if (error) throw new Error(error.code === '23505' ? 'There is already a reading for this meter on that date.' : error.message);
    if (itemId) {
      const { error: iErr } = await supabase.from('lease_recovery_items')
        .update({ amount_actual: calc.charge, amount_expected: calc.charge, updated_at: new Date().toISOString() } as never).eq('id', itemId);
      if (iErr) throw new Error(iErr.message);
    }
    setOpenMeter(null);
  });

  return (
    <div>
      <h5 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">Submetered utilities</h5>
      <div className="space-y-2">
        {meters.map((m) => {
          const last = lastReading(m.id);
          const prev = Number(last?.current_reading ?? 0);
          const open = openMeter === m.id;
          const preview = open && curr.trim() !== '' ? meterCharge({ previousReading: prev, currentReading: Number(curr), ratePerUnit: m.rate_per_unit, multiplier: m.multiplier, baseCharge: m.base_charge }) : null;
          const choices = unbilled(m);
          return (
            <div key={m.id} className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-[11px]">
                  <span className="font-bold text-slate-200">{m.label}</span>
                  <span className="text-slate-500"> · {money(m.rate_per_unit)}/{m.unit_of_measure}{Number(m.multiplier) !== 1 ? ` × ${m.multiplier}` : ''}{Number(m.base_charge) > 0 ? ` + ${money(m.base_charge)} base` : ''}</span>
                  <div className="text-slate-500">{last ? `Last reading ${last.current_reading} on ${last.reading_date} (${money(last.charge)})` : 'No readings yet'}</div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {!open && <button type="button" onClick={() => startReading(m)} className="px-2.5 py-1 rounded-md text-[11px] font-bold text-cyan-200 bg-cyan-950/60 border border-cyan-700 hover:bg-cyan-700 transition">Enter reading</button>}
                  <button type="button" disabled={busy} onClick={() => removeMeter(m)} className="text-slate-500 hover:text-rose-400 transition" aria-label="Remove meter">✕</button>
                </div>
              </div>
              {open && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={lbl}>Reading date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></div>
                  <div><label className={lbl}>Current reading (was {prev})</label><input type="number" step="any" value={curr} onChange={(e) => setCurr(e.target.value)} className={field} /></div>
                  <div className="col-span-2"><label className={lbl}>Bill it against</label>
                    <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={field}>
                      <option value="">Just record the reading</option>
                      {choices.map((i) => <option key={i.id} value={i.id}>Due {i.due_date}</option>)}
                    </select></div>
                  {preview && <p className={`col-span-2 text-[11px] ${preview.error ? 'text-rose-400' : 'text-slate-300'}`}>{preview.error ?? `${preview.usage} ${m.unit_of_measure} used, tenant owes ${money(preview.charge)}`}</p>}
                  <div className="col-span-2 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => { void saveReading(m); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition">Save reading</button>
                    <button type="button" onClick={() => setOpenMeter(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 px-3 py-1.5 rounded-lg text-[11px] font-bold text-emerald-200 bg-emerald-950/60 border border-emerald-700 hover:bg-emerald-700 transition">+ Add meter</button>
      ) : (
        <div className="mt-2 p-3 bg-slate-900/70 border border-slate-800 rounded-xl grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={lbl}>Meter name</label><input type="text" value={mLabel} onChange={(e) => setMLabel(e.target.value)} placeholder="e.g. Suite 4 electric" className={field} /></div>
          <div><label className={lbl}>Utility</label>
            <select value={mType} onChange={(e) => { setMType(e.target.value); setMUnit(UTILITY_UNITS[e.target.value] ?? 'unit'); }} className={field}>
              {Object.keys(UTILITY_UNITS).map((u) => <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</option>)}
            </select></div>
          <div><label className={lbl}>Unit</label><input type="text" value={mUnit} onChange={(e) => setMUnit(e.target.value)} className={field} /></div>
          <div><label className={lbl}>Rate per unit</label><input type="number" min="0" step="0.0001" value={mRate} onChange={(e) => setMRate(e.target.value)} className={field} /></div>
          <div><label className={lbl}>Multiplier</label><input type="number" min="0" step="any" value={mMult} onChange={(e) => setMMult(e.target.value)} className={field} /></div>
          <div><label className={lbl}>Base charge (optional)</label><input type="number" min="0" step="0.01" value={mBase} onChange={(e) => setMBase(e.target.value)} className={field} /></div>
          {meterTerms.length > 1 && (
            <div><label className={lbl}>Billing schedule</label>
              <select value={mTerm} onChange={(e) => setMTerm(e.target.value)} className={field}>
                {meterTerms.map((t) => <option key={t.id} value={t.id}>{t.label || 'Submetered utilities'} ({t.frequency})</option>)}
              </select></div>
          )}
          <div className="col-span-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => { void addMeter(); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition">Save meter</button>
            <button type="button" onClick={() => { setAdding(false); setErr(null); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition">Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-[11px] text-rose-400">{err}</p>}
    </div>
  );
};
