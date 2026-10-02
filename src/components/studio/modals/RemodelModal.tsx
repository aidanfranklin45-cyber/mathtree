import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DealInputs, DealRecord } from '../../../lib/math/types';
import {
  commitRemodelPatch, evaluateRemodel, getCommittedRemodel, getRemodelPlans, uncommitRemodelPatch,
  type RemodelPlan,
} from '../../../lib/remodel';

interface Props {
  isOpen: boolean;
  deal: DealRecord;
  onClose: () => void;
  /** Persist an inputs patch on the deal (plans, or committing a remodel). Resolves true on success. */
  onSave: (patch: Partial<DealInputs>) => Promise<boolean>;
}

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const pct = (n: number | null) => (n === null ? 'n/a' : `${n.toFixed(1)}%`);

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

function blankPlan(): RemodelPlan {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return {
    id: newId(), name: 'New remodel', startDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    durationMonths: 6, cost: 0, financing: 'cash', rentDuringWorksPct: 0, rentAfter: { mode: 'monthly', value: 0 }, valueMode: 'cap_rate',
  };
}

const field = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500/60';
const label = 'block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1';

/** Number input that lets the field be emptied while typing. */
const NumField: React.FC<{ value: number | undefined; onChange: (v: number) => void; step?: string; placeholder?: string }> = ({ value, onChange, step, placeholder }) => (
  <input type="number" inputMode="decimal" step={step} placeholder={placeholder} className={field} value={value === undefined || value === 0 ? '' : value}
    onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
);

export const RemodelModal: React.FC<Props> = ({ isOpen, deal, onClose, onSave }) => {
  const plans = useMemo(() => getRemodelPlans(deal), [deal]);
  const committed = getCommittedRemodel(deal);
  const [draft, setDraft] = useState<RemodelPlan | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(plans[0] ? { ...plans[0] } : null);
    setError(null);
    // open state only: saving must not reset what the user is typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const evaluation = useMemo(() => (draft ? evaluateRemodel(deal, draft) : null), [deal, draft]);

  if (!isOpen) return null;

  const set = (patch: Partial<RemodelPlan>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const isSaved = !!draft && plans.some((p) => p.id === draft.id);

  const run = async (fn: () => Promise<boolean>, failMsg: string) => {
    setBusy(true);
    setError(null);
    try {
      if (!(await fn())) setError(failMsg);
    } finally {
      setBusy(false);
    }
  };

  const savePlan = () => draft && run(async () => {
    const next = isSaved ? plans.map((p) => (p.id === draft.id ? draft : p)) : [...plans, draft];
    return onSave({ remodelPlans: next });
  }, 'Could not save the plan.');

  const deletePlan = () => draft && run(async () => {
    const ok = await onSave({ remodelPlans: plans.filter((p) => p.id !== draft.id) });
    if (ok) setDraft(plans.find((p) => p.id !== draft.id) ?? null);
    return ok;
  }, 'Could not delete the plan.');

  const commit = () => draft && run(async () => {
    const r = commitRemodelPatch(deal, draft);
    if (!r.ok) { setError(r.reason); return true; }
    const ok = await onSave(r.patch);
    if (ok) setDraft(null);
    return ok;
  }, 'Could not commit the remodel.');

  const uncommit = () => run(async () => {
    const r = uncommitRemodelPatch(deal);
    if (!r.ok) { setError(r.reason); return true; }
    const ok = await onSave(r.patch);
    if (ok && committed) setDraft({ ...committed.plan });
    return ok;
  }, 'Could not move the remodel back.');

  const ev = evaluation && evaluation.ok ? evaluation : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 bg-slate-950/80 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-black text-white">Remodel scenarios</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Model an expansion or remodel against doing nothing. Nothing here changes the live numbers until you commit it.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white text-lg leading-none px-1">×</button>
        </div>

        <div className="p-4 space-y-4">
          {committed && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-3">
              <p className="text-xs text-emerald-200"><b>{committed.plan.name}</b> is committed: its cost, downtime and rent are in the live numbers.</p>
              <button disabled={busy} onClick={uncommit} className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700">Move back to plans</button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {plans.map((p) => (
              <button key={p.id} onClick={() => setDraft({ ...p })}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${draft?.id === p.id ? 'bg-brand-600 text-white border-brand-500' : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'}`}>
                {p.name || 'Untitled'}
              </button>
            ))}
            {!committed && (
              <button onClick={() => setDraft(blankPlan())} className="px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-300 border border-dashed border-emerald-500/40 hover:bg-emerald-500/10">+ New</button>
            )}
          </div>

          {!draft && !committed && <p className="text-xs text-slate-500">No remodel plans yet. Add one to see whether it is worth it.</p>}

          {draft && !committed && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2"><span className={label}>Name</span><input className={field} value={draft.name} onChange={(e) => set({ name: e.target.value })} /></div>
                <div><span className={label}>Start</span><input type="month" className={field} value={draft.startDate.slice(0, 7)} onChange={(e) => set({ startDate: e.target.value })} /></div>
                <div><span className={label}>Months of work</span><NumField value={draft.durationMonths} onChange={(v) => set({ durationMonths: v })} /></div>

                <div><span className={label}>Total cost ($)</span><NumField value={draft.cost} onChange={(v) => set({ cost: v })} /></div>
                <div>
                  <span className={label}>Paid with</span>
                  <select className={field} value={draft.financing} onChange={(e) => set({ financing: e.target.value as RemodelPlan['financing'] })}>
                    <option value="cash">Cash</option>
                    <option value="new_loan">New loan</option>
                  </select>
                </div>
                <div>
                  <span className={label}>New rent</span>
                  <select className={field} value={draft.rentAfter.mode} onChange={(e) => set({ rentAfter: { ...draft.rentAfter, mode: e.target.value as RemodelPlan['rentAfter']['mode'] } })}>
                    <option value="monthly">Total $/month</option>
                    <option value="pct_increase">% increase</option>
                    <option value="per_sf">$/sf/yr on added sf</option>
                  </select>
                </div>
                <div>
                  <span className={label}>{draft.rentAfter.mode === 'pct_increase' ? 'Increase (%)' : draft.rentAfter.mode === 'per_sf' ? '$ per sf per year' : 'Rent per month ($)'}</span>
                  <NumField value={draft.rentAfter.value} onChange={(v) => set({ rentAfter: { ...draft.rentAfter, value: v } })} step="any" />
                </div>
                {draft.rentAfter.mode === 'per_sf' && (
                  <div><span className={label}>Added sq ft</span><NumField value={draft.rentAfter.addedSf} onChange={(v) => set({ rentAfter: { ...draft.rentAfter, addedSf: v } })} /></div>
                )}
                {draft.financing === 'new_loan' && (
                  <>
                    <div><span className={label}>Borrowed (% of cost)</span><NumField value={draft.ltcPct ?? 80} onChange={(v) => set({ ltcPct: v })} /></div>
                    <div><span className={label}>Loan rate (%)</span><NumField value={draft.loanRatePct ?? Number(deal.inputs?.interestRate ?? 0)} onChange={(v) => set({ loanRatePct: v })} step="any" /></div>
                    <div><span className={label}>Loan term (yrs)</span><NumField value={draft.loanTermYears ?? 20} onChange={(v) => set({ loanTermYears: v })} /></div>
                  </>
                )}
              </div>

              <button type="button" onClick={() => setMore((m) => !m)} className="text-[11px] font-semibold text-slate-400 hover:text-white">{more ? '▾' : '▸'} More assumptions</button>
              {more && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div><span className={label}>Rent kept during work (%)</span><NumField value={draft.rentDuringWorksPct} onChange={(v) => set({ rentDuringWorksPct: v })} /></div>
                  <div><span className={label}>Added upkeep ($/yr)</span><NumField value={draft.extraOpexAnnual} onChange={(v) => set({ extraOpexAnnual: v })} placeholder="auto" /></div>
                  <div>
                    <span className={label}>Value after</span>
                    <select className={field} value={draft.valueMode} onChange={(e) => set({ valueMode: e.target.value as RemodelPlan['valueMode'] })}>
                      <option value="cap_rate">From income (cap rate)</option>
                      <option value="manual">I will enter it</option>
                    </select>
                  </div>
                  {draft.valueMode === 'manual'
                    ? <div><span className={label}>Value after ($)</span><NumField value={draft.manualValue} onChange={(v) => set({ manualValue: v })} /></div>
                    : <div><span className={label}>Cap rate (%)</span><NumField value={draft.capRatePct} onChange={(v) => set({ capRatePct: v })} step="any" placeholder="deal's" /></div>}
                </div>
              )}
            </>
          )}

          {draft && !committed && evaluation && !evaluation.ok && <p className="text-xs text-slate-500">{evaluation.reason}</p>}

          {ev && !committed && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { k: 'Yield on cost', v: pct(ev.yieldOnCost), sub: `deal cap rate ${pct(ev.base.capRate ?? null)}` },
                  { k: 'Value created', v: ev.valueCreated === null ? 'n/a' : usd(ev.valueCreated), sub: 'after the cost', bad: (ev.valueCreated ?? 0) < 0 },
                  { k: 'Return on the remodel', v: pct(ev.incrementalIrr), sub: ev.incrementalMultiple ? `${ev.incrementalMultiple.toFixed(2)}x incl. sale` : 'IRR' },
                  { k: 'Payback', v: ev.paybackYears === null ? 'after sale' : `${ev.paybackYears} yrs`, sub: `peak cash ${usd(ev.peakCashNeeded)}` },
                ].map((c) => (
                  <div key={c.k} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[9px] uppercase font-bold tracking-wider text-slate-500">{c.k}</div>
                    <div className={`text-base font-black ${c.bad ? 'text-rose-400' : 'text-emerald-300'}`}>{c.v}</div>
                    <div className="text-[10px] text-slate-500">{c.sub}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">
                Whole property IRR {ev.base.irr.toFixed(1)}% to {ev.after.irr.toFixed(1)}% ({ev.irrChange >= 0 ? '+' : ''}{ev.irrChange.toFixed(1)} pts).
                {ev.minDscrDuringWorks !== null && ` Lowest coverage during the work ${ev.minDscrDuringWorks.toFixed(2)}x.`}
              </p>
              {ev.warnings.map((w) => <p key={w} className="text-[11px] text-amber-300">{w}</p>)}
            </div>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        {!committed && draft && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-slate-800">
            <div className="flex items-center gap-2">
              {isSaved && <button disabled={busy} onClick={deletePlan} className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-rose-300 hover:bg-rose-500/10">Delete</button>}
              {plans.length > 0 && <Link to={`/compare?mode=versions&scope=owned&dealId=${deal.id}`} className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-cyan-300 hover:bg-cyan-500/10">Compare side by side</Link>}
            </div>
            <div className="flex items-center gap-2">
              <button disabled={busy || !ev} onClick={commit} title="Put this remodel into the live numbers"
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40">Commit to live</button>
              <button disabled={busy || !draft.name.trim()} onClick={savePlan}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40">Save plan</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
