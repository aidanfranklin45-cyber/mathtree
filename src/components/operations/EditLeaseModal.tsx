import React, { useEffect, useState } from 'react';
import { supabase, SUPABASE_URL } from '../../lib/supabase/client';

type Row = Record<string, any>;

interface Step {
  key: string;
  id?: string | null;
  effective_date: string;
  increase_type: 'percentage' | 'fixed_step' | 'cpi';
  scheduled_amount: string;
  reason: string;
}

interface Props {
  leaseId: string | null;
  deals: Row[];
  units: Row[];
  increases: Row[];
  /** Real lease rows plus leases derived from deal inputs (id starts with "deal-lease-"). */
  leases: Row[];
  onClose: () => void;
  onSaved: () => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none';
const cell = 'bg-slate-950/70 border border-slate-700/70 rounded-lg px-2 py-1 text-slate-200 text-xs w-full focus:outline-none focus:border-emerald-500';
let stepCounter = 0;
const newStep = (init: Partial<Step> = {}): Step => ({
  key: `s${++stepCounter}`,
  id: null,
  effective_date: '',
  increase_type: 'percentage',
  scheduled_amount: '3.0',
  reason: '',
  ...init,
});

export const EditLeaseModal: React.FC<Props> = ({ leaseId, deals, units, increases, leases, onClose, onSaved }) => {
  const lease = leaseId ? leases.find((l) => l.id === leaseId) || null : null;
  const deal = lease ? deals.find((d) => d.id === lease.deal_id) : null;
  const unit = lease ? units.find((u) => u.id === lease.unit_id) : null;

  const [tenantName, setTenantName] = useState('');
  const [rent, setRent] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [deposit, setDeposit] = useState('');
  const [active, setActive] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lease) return;
    setError(null);
    setTenantName(lease.tenant_name || '');
    setRent(String(lease.monthly_rent ?? 0));
    setStart(lease.lease_start_date || '');
    setEnd(lease.lease_end_date || '');
    setEmail(lease.tenant_email || '');
    setPhone(lease.tenant_phone || '');
    setDeposit(String(lease.security_deposit || lease.deposit_amount || ''));
    setActive(lease.is_active !== false);

    const scheduled = increases
      .filter((inc) => inc.lease_id === lease.id && inc.is_applied !== true)
      .sort((a, b) => +new Date(a.effective_date) - +new Date(b.effective_date));
    if (scheduled.length > 0) {
      setSteps(scheduled.map((s) => newStep({
        id: s.id,
        effective_date: s.effective_date,
        increase_type: s.increase_type || 'percentage',
        scheduled_amount: String(s.scheduled_amount ?? s.percentage_change ?? 3.0),
        reason: s.reason || '',
      })));
    } else if (lease.next_escalation_date) {
      setSteps([newStep({
        effective_date: lease.next_escalation_date,
        increase_type: String(lease.escalation_type || '').toLowerCase().includes('fixed') ? 'fixed_step' : 'percentage',
        scheduled_amount: String(lease.escalation_rate || 3.0),
        reason: `Scheduled ${lease.escalation_frequency || 'Annual'} Escalation`,
      })]);
    } else {
      setSteps([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseId]);

  if (!leaseId || !lease) return null;

  const patchStep = (key: string, patch: Partial<Step>) => setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const onTypeChange = (s: Step, type: Step['increase_type']) => {
    const amt = parseFloat(s.scheduled_amount);
    if (type === 'percentage' && (!s.scheduled_amount || amt > 50)) patchStep(s.key, { increase_type: type, scheduled_amount: '3.0' });
    else if (type === 'fixed_step' && (!s.scheduled_amount || amt <= 10)) patchStep(s.key, { increase_type: type, scheduled_amount: '150' });
    else patchStep(s.key, { increase_type: type });
  };

  const autoAnnual = () => {
    let y = new Date().getFullYear();
    let m = String(new Date().getMonth() + 1).padStart(2, '0');
    let d = '01';
    if (start.includes('-')) {
      const [yy, mm, dd] = start.split('-');
      y = parseInt(yy, 10); m = mm; d = dd;
    }
    const rate = parseFloat(String(lease.escalation_rate)) || 3.0;
    let years = 10;
    if (end.includes('-')) {
      const endYear = parseInt(end.split('-')[0], 10);
      if (endYear > y) years = endYear - y;
    }
    const out: Step[] = [];
    for (let i = 1; i <= years; i++) {
      const eff = `${y + i}-${m}-${d}`;
      if (end && eff > end) break;
      if (end && eff === end && i === years) break;
      out.push(newStep({ effective_date: eff, increase_type: 'percentage', scheduled_amount: String(rate), reason: `Year ${i + 1} Contractual ${rate}% Escalation (Commenced ${start || y})` }));
    }
    setSteps(out);
  };

  /** Facts only: the deal's rent and lease list. Analysis is recomputed from these on demand, never stored. */
  const syncLeaseFactsToDeal = async (dealId: string) => {
    const dealRow = deals.find((d) => String(d.id) === String(dealId));
    if (!dealRow) return;
    const { data: fresh } = await supabase.from('leases').select('*').eq('deal_id', dealId).neq('is_active', false);
    const list = fresh || [];
    const total = list.reduce((s: number, l: Row) => s + (parseFloat(l.monthly_rent) || 0), 0);
    const inputs = { ...(dealRow.inputs || {}) };
    inputs.monthlyRent = total;
    inputs.grossRentPerMonth = total;
    inputs.grossRentAnnual = total * 12;
    inputs.leases = list.map((l: Row) => ({
      tenantName: l.tenant_name || 'Commercial Tenant',
      monthlyRent: parseFloat(l.monthly_rent) || 0,
      annualRent: (parseFloat(l.monthly_rent) || 0) * 12,
      leaseStartDate: l.lease_start_date || inputs.leaseStartDate || inputs.closingDate || '',
      leaseEndDate: l.lease_end_date || inputs.leaseExpiration || '',
      leaseType: l.lease_type || inputs.leaseType || 'NNN',
      escalationType: l.escalation_type || 'Percentage Bump (%)',
      escalationRate: l.escalation_rate !== undefined && l.escalation_rate !== null ? parseFloat(l.escalation_rate) : 3.0,
      escalationFrequency: l.escalation_frequency || 'Annual on Anniversary',
      nextEscalationDate: l.next_escalation_date || '',
    }));
    await supabase.from('deals').update({ inputs, updated_at: new Date().toISOString() } as any).eq('id', dealId);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const valid = steps
        .filter((s) => s.effective_date)
        .map((s) => ({ id: s.id || null, effective_date: s.effective_date, increase_type: s.increase_type, scheduled_amount: parseFloat(s.scheduled_amount) || 0, reason: s.reason.trim() }))
        .sort((a, b) => +new Date(a.effective_date) - +new Date(b.effective_date));

      let escType = lease.escalation_type || 'Percentage Bump (%)';
      let escRate = parseFloat(String(lease.escalation_rate)) || 0;
      let nextEsc: string | null = lease.next_escalation_date || null;
      if (valid.length > 0) {
        nextEsc = valid[0].effective_date;
        escRate = valid[0].scheduled_amount;
        escType = valid[0].increase_type === 'fixed_step' ? 'Fixed Step ($)' : valid[0].increase_type === 'cpi' ? 'CPI Index' : 'Percentage Bump (%)';
      }
      const monthlyRent = parseFloat(rent) || 0;
      const realId = UUID.test(leaseId) ? leaseId : undefined;

      const payload = {
        lease_id: realId,
        deal_id: lease.deal_id,
        unit_id: lease.unit_id && UUID.test(String(lease.unit_id)) ? lease.unit_id : null,
        tenant_name: tenantName.trim() || 'In-Place Tenant',
        monthly_rent: monthlyRent,
        lease_start_date: start,
        lease_end_date: end || null,
        tenant_email: email.trim() || null,
        tenant_phone: phone.trim() || null,
        security_deposit: parseFloat(deposit) || 0,
        is_active: active,
        escalation_type: escType,
        escalation_rate: escRate,
        escalation_frequency: lease.escalation_frequency || 'Annual on Anniversary',
        next_escalation_date: nextEsc,
        scheduled_escalations: valid,
      };

      let edgeOk = false;
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/configure-lease-terms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(payload),
        });
        const result = await res.json().catch(() => ({}));
        edgeOk = res.ok && (result as { success?: boolean }).success === true;
      } catch (edgeErr) {
        console.warn('[configure-lease-terms] unreachable, falling back to direct sync:', edgeErr);
      }

      if (!edgeOk) {
        const { data: auth } = await supabase.auth.getUser();
        const { data: saved, error: upErr } = await supabase
          .from('leases')
          .upsert({
            id: realId,
            deal_id: lease.deal_id,
            user_id: auth?.user?.id,
            tenant_name: payload.tenant_name,
            monthly_rent: monthlyRent,
            lease_start_date: start,
            lease_end_date: end || null,
            tenant_email: payload.tenant_email,
            tenant_phone: payload.tenant_phone,
            security_deposit: payload.security_deposit,
            is_active: active,
            escalation_type: escType,
            escalation_rate: escRate,
            escalation_frequency: payload.escalation_frequency,
            next_escalation_date: nextEsc,
            updated_at: new Date().toISOString(),
          } as any)
          .select('id')
          .single();
        if (upErr) throw upErr;
        const savedId = (saved as Row).id as string;
        await supabase.from('rent_increases').delete().eq('lease_id', savedId).eq('is_applied', false);
        if (valid.length > 0) {
          await supabase.from('rent_increases').insert(valid.map((s) => ({
            user_id: auth?.user?.id,
            lease_id: savedId,
            deal_id: lease.deal_id,
            effective_date: s.effective_date,
            increase_type: s.increase_type,
            scheduled_amount: s.scheduled_amount,
            old_rent: monthlyRent,
            new_rent: s.increase_type === 'percentage' ? Math.round(monthlyRent * (1 + s.scheduled_amount / 100) * 100) / 100 : monthlyRent + s.scheduled_amount,
            reason: s.reason || `Scheduled ${s.increase_type} increase`,
            is_applied: false,
          })) as any);
        }
      }

      await syncLeaseFactsToDeal(lease.deal_id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error configuring lease terms');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl p-6 relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <h3 className="text-base font-bold text-white flex items-center space-x-2"><span className="text-emerald-400">📝</span><span>Edit Lease &amp; Escalation Schedule</span></h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg" aria-label="Close">✕</button>
        </div>

        <form onSubmit={save} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-400 font-bold mb-1">Property &amp; Unit</label>
            <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl font-semibold text-slate-200">
              {deal ? (deal.title || deal.name) : 'Asset'} • {unit ? unit.unit_number : lease.derived_unit_number || 'Main Suite'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Tenant Name *</label>
              <input type="text" required value={tenantName} onChange={(e) => setTenantName(e.target.value)} className={input} />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Current Monthly Rent ($) *</label>
              <input type="number" step="0.01" required value={rent} onChange={(e) => setRent(e.target.value)} className={`${input} text-emerald-400 font-mono font-bold`} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Lease Start Date *</label>
              <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={`${input} font-mono`} />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Lease Expiration Date</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${input} font-mono`} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Tenant Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tenant@example.com" className={input} />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Tenant Phone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(509) 555-0100" className={input} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Security Deposit ($)</label>
              <input type="number" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} className={`${input} font-mono`} />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Lease Status</label>
              <select value={active ? 'active' : 'terminated'} onChange={(e) => setActive(e.target.value === 'active')} className={input}>
                <option value="active">Active In-Place Lease</option>
                <option value="terminated">Terminated / Inactive</option>
              </select>
            </div>
          </div>

          {/* Escalation schedule */}
          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/90 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1 border-b border-slate-800/80">
              <div>
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center space-x-1.5"><span>📈</span><span>Predetermined Rent Increases (Escalation Schedule)</span></span>
                <p className="text-[10px] text-slate-400">Configure contractual future rent increases. Persisted with audit precision.</p>
              </div>
              <div className="flex items-center space-x-1.5 shrink-0 pt-1 sm:pt-0">
                <button type="button" onClick={autoAnnual} className="px-2 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60 text-[10px] font-semibold transition">⚡ Auto Annual 3%</button>
                <button type="button" onClick={() => setSteps((p) => [...p, newStep()])} className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition shadow-sm flex items-center space-x-1"><span>+</span><span>Add Step</span></button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800/60">
                    <th className="pb-1.5 pr-2">Effective Date *</th>
                    <th className="pb-1.5 pr-2">Escalation Type</th>
                    <th className="pb-1.5 pr-2">Scheduled Value</th>
                    <th className="pb-1.5 pr-2">Notes / Reason</th>
                    <th className="pb-1.5 text-right w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {steps.map((s) => (
                    <tr key={s.key} className="hover:bg-slate-800/40 transition">
                      <td className="py-1.5 pr-2"><input type="date" value={s.effective_date} onChange={(e) => patchStep(s.key, { effective_date: e.target.value })} className={cell} /></td>
                      <td className="py-1.5 pr-2">
                        <select value={s.increase_type} onChange={(e) => onTypeChange(s, e.target.value as Step['increase_type'])} className={cell}>
                          <option value="percentage">Percentage (%)</option>
                          <option value="fixed_step">Fixed Step ($)</option>
                          <option value="cpi">CPI Index</option>
                        </select>
                      </td>
                      <td className="py-1.5 pr-2"><input type="number" step="0.01" value={s.scheduled_amount} onChange={(e) => patchStep(s.key, { scheduled_amount: e.target.value })}
                        placeholder={s.increase_type === 'cpi' ? 'CPI Cap % (e.g. 3.5)' : s.increase_type === 'fixed_step' ? '150' : '3.0'} className={cell} /></td>
                      <td className="py-1.5 pr-2"><input type="text" value={s.reason} onChange={(e) => patchStep(s.key, { reason: e.target.value })} placeholder="e.g. Year 2 contractual increase" className={cell} /></td>
                      <td className="py-1.5 text-right w-8"><button type="button" onClick={() => setSteps((p) => p.filter((x) => x.key !== s.key))} className="text-slate-500 hover:text-rose-400 p-1 transition" title="Remove step">✕</button></td>
                    </tr>
                  ))}
                  {steps.length === 0 && (
                    <tr><td colSpan={5} className="py-3 text-center text-[11px] text-slate-500 italic">No scheduled increases. Use “Add Step” or “Auto Annual”.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {error && <p className="text-[11px] font-semibold text-rose-400">Notice: {error}</p>}

          <div className="flex space-x-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-md shadow-emerald-900/30 disabled:opacity-60">
              {saving ? 'Configuring Lease Terms...' : 'Save Changes & Update Portfolio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
