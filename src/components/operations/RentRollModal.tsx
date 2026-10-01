import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, ClipboardPaste, Trash2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import {
  emptyRow, parsePasted, validateGrid, planWrites, summarizeGrid, type GridRow, type RowIssue,
} from '../../lib/operations/rentRollGrid';
import { isResidentialAsset, isWashingtonProperty } from '../../../supabase/functions/_shared/rentIncreaseRules';

type Rec = Record<string, any>;

interface Props {
  isOpen: boolean;
  deals: Rec[];
  units: Rec[];
  leases: Rec[];
  initialDealId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const cell = 'bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none w-full';
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const unitTypeFor = (assetType: unknown): string => {
  const a = String(assetType ?? '').toLowerCase();
  if (a === 'single-family') return 'Single-Family';
  if (a === 'multi-unit' || a === 'multi_family' || a === 'multifamily') return 'Apartment';
  if (a === 'storage') return 'Storage Unit';
  return 'Commercial / Retail';
};

/** The property's current units and active tenants as grid rows. Leases that have no unit yet get a placeholder name to be confirmed. */
function rowsFromData(dealId: string, units: Rec[], leases: Rec[]): GridRow[] {
  const dealUnits = units.filter((u) => u.deal_id === dealId);
  const active = leases.filter((l) => l.deal_id === dealId && l.is_active !== false && !String(l.id).startsWith('deal-lease-'));
  const rows: GridRow[] = [];
  const usedLeaseIds = new Set<string>();
  for (const u of dealUnits) {
    const l = active.find((x) => x.unit_id === u.id);
    if (l) usedLeaseIds.add(l.id);
    rows.push(l ? rowFromLease(l, u.unit_number, u.id) : emptyRow({ unitId: u.id, unit: u.unit_number || '', rent: u.market_rent ? String(u.market_rent) : '' }));
  }
  for (const l of active) if (!usedLeaseIds.has(l.id)) rows.push(rowFromLease(l, l.unit_id ? '' : 'Main', l.unit_id || null));
  return rows;
}

function rowFromLease(l: Rec, unit: string, unitId: string | null): GridRow {
  const pct = l.escalation_rate != null && Number(l.escalation_rate) > 0 && String(l.escalation_type || '').toLowerCase().includes('percent') ? String(l.escalation_rate) : '';
  return emptyRow({
    leaseId: l.id,
    unitId,
    unit,
    tenant: l.tenant_name || '',
    rent: String(l.monthly_rent ?? ''),
    start: l.lease_start_date || '',
    end: l.lease_end_date || '',
    term: l.term_type === 'month_to_month' ? 'month_to_month' : 'fixed',
    dueDay: String(l.payment_due_day || 1),
    annualPct: pct,
    deposit: l.security_deposit ? String(l.security_deposit) : '',
    email: l.tenant_email || '',
  });
}

export const RentRollModal: React.FC<Props> = ({ isOpen, deals, units, leases, initialDealId, onClose, onSaved }) => {
  const [dealId, setDealId] = useState<string>('');
  const [rows, setRows] = useState<GridRow[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);

  const selectable = useMemo(() => deals.filter((d) => !d.is_demo), [deals]);
  const deal = selectable.find((d) => d.id === dealId) || null;

  useEffect(() => {
    if (!isOpen) return;
    const first = (initialDealId && selectable.some((d) => d.id === initialDealId) ? initialDealId : selectable.find((d) => d.status === 'owned')?.id || selectable[0]?.id) || '';
    setDealId(first);
    setError(null);
    setNotes([]);
    setPasteOpen(false);
    setShowIssues(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !dealId) return;
    setRows(rowsFromData(dealId, units, leases));
    setShowIssues(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, isOpen]);

  const issues = useMemo(() => validateGrid(rows), [rows]);
  const issuesByKey = useMemo(() => {
    const m = new Map<string, RowIssue[]>();
    for (const i of issues) m.set(i.key, [...(m.get(i.key) ?? []), i]);
    return m;
  }, [issues]);
  const summary = useMemo(() => summarizeGrid(rows), [rows]);

  if (!isOpen) return null;

  const residential = deal ? isResidentialAsset(deal.asset_type) : false;
  const waResidential = !!deal && residential && isWashingtonProperty({ location: deal.location, inputs: deal.inputs });

  const update = (key: string, patch: Partial<GridRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (r: GridRow) => {
    // A saved lease is closed, never deleted (its payment history stays); a row that was never saved just disappears
    if (r.leaseId || r.unitId) update(r.key, { remove: !r.remove });
    else setRows((cur) => cur.filter((x) => x.key !== r.key));
  };
  const issue = (key: string, field: keyof GridRow) => issuesByKey.get(key)?.find((i) => i.field === field)?.message;
  const fieldClass = (key: string, field: keyof GridRow) => `${cell} ${showIssues && issue(key, field) ? 'border-rose-500' : ''}`;

  const applyPaste = (replace: boolean) => {
    const { rows: parsed, notes: n } = parsePasted(pasteText);
    setNotes(n);
    if (parsed.length === 0) return;
    const fresh = parsed.map((p) => emptyRow({ ...p }));
    setRows((cur) => (replace ? [...cur.filter((r) => r.leaseId || r.unitId).map((r) => ({ ...r, remove: true })), ...fresh] : [...cur, ...fresh]));
    setPasteText('');
    setPasteOpen(false);
  };

  const save = async () => {
    if (!deal) return;
    setShowIssues(true);
    if (issues.length > 0) { setError(`Fix the ${issues.length} highlighted ${issues.length === 1 ? 'problem' : 'problems'} first.`); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) throw new Error('Please sign in again.');

      const plan = planWrites(rows, {
        today: todayIso(),
        defaultLeaseType: residential ? 'Gross' : 'NNN',
        defaultUnitType: unitTypeFor(deal.asset_type),
        noAutoIncrease: waResidential,
      });

      // 1. Units (existing ones keep their type)
      const unitIdByRow = new Map<string, string>();
      for (const u of plan.units) {
        if (u.unitId) {
          const { error: e } = await supabase.from('units').update({ unit_number: u.unit_number, market_rent: u.market_rent, status: u.status, updated_at: new Date().toISOString() }).eq('id', u.unitId);
          if (e) throw e;
          unitIdByRow.set(u.rowKey, u.unitId);
        } else {
          const { data, error: e } = await supabase.from('units').insert({ user_id: userId, deal_id: deal.id, unit_number: u.unit_number, unit_type: u.unit_type, market_rent: u.market_rent, status: u.status }).select('id').single();
          if (e) throw e;
          unitIdByRow.set(u.rowKey, (data as Rec).id);
        }
      }

      // 2. Leases: one per tenant (the deal's underwriting inputs are deliberately left alone)
      for (const l of plan.leases) {
        const common = {
          unit_id: unitIdByRow.get(l.rowKey) ?? null,
          tenant_name: l.tenant_name,
          tenant_email: l.tenant_email,
          monthly_rent: l.monthly_rent,
          security_deposit: l.security_deposit,
          lease_start_date: l.lease_start_date,
          lease_end_date: l.lease_end_date,
          term_type: l.term_type,
          payment_due_day: l.payment_due_day,
          escalation_type: l.escalation_type,
          escalation_rate: l.escalation_rate,
          escalation_frequency: l.escalation_frequency,
          next_escalation_date: l.next_escalation_date,
          is_active: true,
        };
        if (l.leaseId) {
          const { error: e } = await supabase.from('leases').update({ ...common, updated_at: new Date().toISOString() }).eq('id', l.leaseId);
          if (e) throw e;
        } else {
          const { error: e } = await supabase.from('leases').insert({
            ...common, user_id: userId, deal_id: deal.id, lease_type: l.lease_type, grace_period_days: l.grace_period_days, last_rent_increase_date: l.lease_start_date,
          });
          if (e) throw e;
        }
      }

      // 3. Tenants who moved out or rows removed: close the lease (history is kept)
      if (plan.deactivate.length > 0) {
        const { error: e } = await supabase.from('leases').update({ is_active: false, updated_at: new Date().toISOString() }).in('id', plan.deactivate);
        if (e) throw e;
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the rent roll.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl my-2 sm:my-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-extrabold text-white">Rent Roll</h3>
            <p className="text-xs text-slate-400">One row per unit or suite. Each tenant keeps their own rent and move-in date.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="block text-xs flex-1 max-w-md">
              <span className="block text-slate-400 font-bold mb-1">Property</span>
              <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={cell}>
                {selectable.map((d) => <option key={d.id} value={d.id}>{d.title || d.name} ({d.status || 'prospect'})</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPasteOpen((v) => !v)} className="px-3 py-2 rounded-xl border border-slate-700 text-xs font-bold text-slate-200 hover:text-white hover:border-slate-500 flex items-center gap-1.5"><ClipboardPaste className="w-3.5 h-3.5" />Paste from spreadsheet</button>
              <button type="button" onClick={() => setRows((cur) => [...cur, emptyRow()])} className="px-3 py-2 rounded-xl border border-slate-700 text-xs font-bold text-slate-200 hover:text-white hover:border-slate-500 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Add row</button>
            </div>
          </div>

          {pasteOpen && (
            <div className="border border-slate-800 rounded-xl p-3 space-y-2 bg-slate-950/60">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Copy the rows from your spreadsheet and paste them here. A first line of column names is recognised (Unit, Tenant, Rent, Move-in, Lease End, Due day, Deposit, Email, Increase %), in any order.
                Without one, columns are read in that order. Put <strong>MTM</strong> in Lease End for a month-to-month tenant. Leave Tenant blank for a vacant unit.
              </p>
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} placeholder={'Unit\tTenant\tRent\tMove-in\tLease End\n1A\tJane Doe\t1450\t3/1/2024\t2/28/2026\n1B\tSam Lee\t1395\t9/15/2023\tMTM'} className={`${cell} font-mono`} />
              <div className="flex gap-2">
                <button type="button" onClick={() => applyPaste(false)} disabled={!pasteText.trim()} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold disabled:opacity-40">Add these rows</button>
                <button type="button" onClick={() => applyPaste(true)} disabled={!pasteText.trim()} className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-bold text-slate-300 hover:text-white disabled:opacity-40" title="Close the current tenants and use only the pasted rows">Replace the current rent roll</button>
              </div>
            </div>
          )}

          {notes.length > 0 && (
            <div className="text-[11px] text-amber-300 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2 space-y-0.5">
              {notes.map((n) => <div key={n}>{n}</div>)}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            {[
              ['Units', String(summary.units)],
              ['Occupied', `${summary.occupied} (${summary.occupancyPct}%)`],
              ['Vacant', String(summary.vacant)],
              ['Monthly rent', money(summary.monthlyRent)],
              ['Annual rent', money(summary.annualRent)],
            ].map(([l, v]) => (
              <div key={l} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"><div className="text-[10px] font-bold uppercase text-slate-500">{l}</div><div className="font-extrabold text-white mt-0.5">{v}</div></div>
            ))}
          </div>

          {waResidential && (
            <p className="text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
              Washington residential: yearly increases are not scheduled automatically. Each increase needs written notice, handled one at a time under Record Rent Escalation.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs min-w-[980px]">
              <thead className="bg-slate-950/80 text-slate-400">
                <tr>
                  {['Unit / Suite', 'Tenant (blank = vacant)', 'Rent / asking', 'Move-in', 'Term', 'Lease end', 'Due day', 'Yearly %', 'Deposit', 'Tenant email', ''].map((h) => <th key={h} className="py-2 px-2 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/60">
                {rows.length === 0 && (
                  <tr><td colSpan={11} className="py-8 text-center text-slate-500">No units yet. Add a row, or paste your rent roll from a spreadsheet.</td></tr>
                )}
                {rows.map((r) => {
                  const m2m = r.term === 'month_to_month';
                  const vacant = r.tenant.trim() === '';
                  return (
                    <tr key={r.key} className={r.remove ? 'opacity-40' : vacant ? 'bg-slate-950/30' : ''}>
                      <td className="py-1.5 px-2 w-28"><input value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} disabled={r.remove} className={fieldClass(r.key, 'unit')} title={issue(r.key, 'unit')} /></td>
                      <td className="py-1.5 px-2 w-48"><input value={r.tenant} onChange={(e) => update(r.key, { tenant: e.target.value })} disabled={r.remove} placeholder="Vacant" className={fieldClass(r.key, 'tenant')} /></td>
                      <td className="py-1.5 px-2 w-24"><input value={r.rent} inputMode="decimal" onChange={(e) => update(r.key, { rent: e.target.value })} disabled={r.remove} className={fieldClass(r.key, 'rent')} title={issue(r.key, 'rent')} /></td>
                      <td className="py-1.5 px-2 w-32"><input type="date" value={r.start} onChange={(e) => update(r.key, { start: e.target.value })} disabled={r.remove || vacant} className={fieldClass(r.key, 'start')} title={issue(r.key, 'start')} /></td>
                      <td className="py-1.5 px-2 w-28">
                        <select value={r.term} onChange={(e) => update(r.key, { term: e.target.value as GridRow['term'], end: e.target.value === 'month_to_month' ? '' : r.end })} disabled={r.remove || vacant} className={cell}>
                          <option value="fixed">Fixed term</option>
                          <option value="month_to_month">Month to month</option>
                        </select>
                      </td>
                      <td className="py-1.5 px-2 w-32"><input type="date" value={r.end} onChange={(e) => update(r.key, { end: e.target.value })} disabled={r.remove || vacant || m2m} className={fieldClass(r.key, 'end')} title={issue(r.key, 'end')} /></td>
                      <td className="py-1.5 px-2 w-16"><input value={r.dueDay} inputMode="numeric" onChange={(e) => update(r.key, { dueDay: e.target.value })} disabled={r.remove || vacant} className={fieldClass(r.key, 'dueDay')} title={issue(r.key, 'dueDay')} /></td>
                      <td className="py-1.5 px-2 w-20"><input value={r.annualPct} inputMode="decimal" onChange={(e) => update(r.key, { annualPct: e.target.value })} disabled={r.remove || vacant || m2m || waResidential} placeholder={waResidential || m2m ? '–' : ''} className={fieldClass(r.key, 'annualPct')} title={issue(r.key, 'annualPct')} /></td>
                      <td className="py-1.5 px-2 w-24"><input value={r.deposit} inputMode="decimal" onChange={(e) => update(r.key, { deposit: e.target.value })} disabled={r.remove || vacant} className={cell} /></td>
                      <td className="py-1.5 px-2 w-44"><input value={r.email} onChange={(e) => update(r.key, { email: e.target.value })} disabled={r.remove || vacant} className={fieldClass(r.key, 'email')} title={issue(r.key, 'email')} /></td>
                      <td className="py-1.5 px-2 w-10 text-right">
                        <button type="button" onClick={() => removeRow(r)} className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800" title={r.leaseId || r.unitId ? (r.remove ? 'Undo remove' : 'Close this tenancy (history is kept)') : 'Remove row'}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Saving creates or updates one unit and one lease per tenant. Removing a saved tenant, or clearing the tenant name, closes the lease and keeps its payment history.
            This list is your operating record: it does not change the property's underwriting.
          </p>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span></div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white bg-slate-950 border border-slate-800 font-bold text-sm">Cancel</button>
            <button type="button" onClick={save} disabled={saving || !deal} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-sm disabled:opacity-50">
              {saving ? 'Saving…' : 'Save rent roll'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
