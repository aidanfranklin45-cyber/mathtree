import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase/client';
import { MonthlyRentReconciliationView } from '../../lib/supabase/types';
import { X, AlertCircle, Printer, ShieldCheck } from 'lucide-react';
import {
  checkWashingtonRentIncrease, buildRentIncreaseNoticeHtml, isResidentialAsset, isWashingtonProperty, daysBetween,
} from '../../../supabase/functions/_shared/rentIncreaseRules';

interface RentIncreaseModalProps {
  isOpen: boolean;
  item: MonthlyRentReconciliationView | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface Facts {
  lease: Record<string, any>;
  deal: Record<string, any>;
  lastIncreaseDate: string | null;
  landlordName: string;
  /** A scheduled (not yet effective) increase for this lease, if one exists. */
  scheduled: { id: string; effective_date: string; old_rent: number | null; new_rent: number | null; notice_sent_date: string | null } | null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export const RentIncreaseModal: React.FC<RentIncreaseModalProps> = ({
  isOpen,
  item,
  onClose,
  onSuccess,
}) => {
  const [currentRent, setCurrentRent] = useState<number>(0);
  const [newRent, setNewRent] = useState<string>('');
  const [increaseType, setIncreaseType] = useState<string>('Percentage Bump (%)');
  const [pctBump, setPctBump] = useState<string>('3.0');
  const [effectiveDate, setEffectiveDate] = useState<string>(todayIso());
  const [noticeServed, setNoticeServed] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);

  useEffect(() => {
    if (!item) return;
    const cr = Number(item.contractual_rent) || 0;
    setCurrentRent(cr);
    setNewRent((Math.round(cr * 1.03 * 100) / 100).toString());
    setPctBump('3.0');
    setEffectiveDate(todayIso());
    setNoticeServed('');
    setError(null);
    setFacts(null);

    let live = true;
    (async () => {
      if (!item.lease_id) return;
      const [{ data: lease }, { data: deal }, { data: applied }, { data: pending }, sess] = await Promise.all([
        supabase.from('leases').select('*').eq('id', item.lease_id).maybeSingle(),
        item.deal_id ? supabase.from('deals').select('id,title,asset_type,location,inputs,user_id').eq('id', item.deal_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('rent_increases').select('effective_date').eq('lease_id', item.lease_id).eq('is_applied', true).order('effective_date', { ascending: false }).limit(1),
        supabase.from('rent_increases').select('id,effective_date,old_rent,new_rent,notice_sent_date').eq('lease_id', item.lease_id).eq('is_applied', false).gte('effective_date', todayIso()).order('effective_date', { ascending: true }).limit(1),
        supabase.auth.getSession(),
      ]);
      if (!live || !lease) return;
      let landlordName = 'Landlord';
      const uid = sess.data?.session?.user?.id;
      if (uid) {
        const { data: prof } = await supabase.from('profiles').select('company_name,full_name').eq('id', uid).maybeSingle();
        landlordName = (prof?.company_name || prof?.full_name || 'Landlord') as string;
      }
      const last = (applied?.[0]?.effective_date as string | undefined) || (lease.last_rent_increase_date as string | null) || null;
      setFacts({
        lease: lease as Record<string, any>,
        deal: (deal as Record<string, any>) || {},
        lastIncreaseDate: last,
        landlordName,
        scheduled: (pending?.[0] as Facts['scheduled']) || null,
      });
    })();
    return () => { live = false; };
  }, [item]);

  // Washington residential rent increases follow RCW 59.18.140 / 59.18.700; everything else keeps the plain form
  const wa = !!facts && isResidentialAsset(facts.deal.asset_type) && isWashingtonProperty({ location: facts.deal.location, inputs: facts.deal.inputs });

  const newRentNum = parseFloat(newRent) || 0;
  const check = useMemo(() => {
    if (!wa || !facts) return null;
    return checkWashingtonRentIncrease({
      today: todayIso(),
      currentRent,
      newRent: newRentNum,
      effectiveDate,
      noticeServedDate: noticeServed || null,
      tenancyStartDate: facts.lease.lease_start_date || null,
      lastIncreaseDate: facts.lastIncreaseDate,
      termType: facts.lease.term_type || 'fixed',
      leaseEndDate: facts.lease.lease_end_date || null,
      subsidized: !!facts.lease.is_subsidized,
      stabilizationExempt: !!facts.lease.stabilization_exempt,
    });
  }, [wa, facts, currentRent, newRentNum, effectiveDate, noticeServed]);

  // Once the property is known to be a Washington home, start at the earliest legal effective date rather than today
  useEffect(() => {
    if (!wa || !facts) return;
    const first = checkWashingtonRentIncrease({
      today: todayIso(), currentRent, newRent: Math.max(currentRent + 1, currentRent * 1.03), effectiveDate: todayIso(),
      tenancyStartDate: facts.lease.lease_start_date || null, termType: facts.lease.term_type || 'fixed', leaseEndDate: facts.lease.lease_end_date || null,
      subsidized: !!facts.lease.is_subsidized, stabilizationExempt: !!facts.lease.stabilization_exempt,
    });
    setEffectiveDate(first.earliestEffectiveDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wa, facts]);

  if (!isOpen || !item) return null;

  const handlePctChange = (val: string) => {
    setPctBump(val);
    const pct = parseFloat(val) || 0;
    setNewRent((Math.round(currentRent * (1 + pct / 100) * 100) / 100).toString());
  };

  const printNotice = (rent: { current: number; next: number; effective: string }) => {
    const html = buildRentIncreaseNoticeHtml({
      landlordName: facts?.landlordName || 'Landlord',
      tenantName: item.tenant_name || 'Tenant',
      propertyAddress: facts?.deal.location || item.deal_title || '',
      unit: item.unit_number || undefined,
      currentRent: rent.current,
      newRent: rent.next,
      effectiveDate: rent.effective,
      noticeDate: noticeServed || todayIso(),
    });
    const w = window.open('', '_blank');
    if (!w) { setError('Allow pop-ups to print the notice.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const recordScheduledNotice = async () => {
    if (!facts?.scheduled || !noticeServed) { setError('Enter the date the notice was given to the tenant.'); return; }
    if (noticeServed > todayIso()) { setError('The notice date cannot be in the future.'); return; }
    const sch = facts.scheduled;
    const need = facts.lease.is_subsidized ? 30 : 90;
    if (daysBetween(noticeServed, sch.effective_date) < need) {
      setError(`That notice date is less than ${need} days before the ${sch.effective_date} effective date, so the increase cannot take effect then.`);
      return;
    }
    setSaving(true);
    const { error: upErr } = await supabase.from('rent_increases').update({ notice_sent_date: noticeServed }).eq('id', sch.id);
    setSaving(false);
    if (upErr) { setError(upErr.message); return; }
    onSuccess();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newRentNum <= 0) {
      setError('Please enter a valid new rent amount');
      return;
    }
    if (!item.lease_id) {
      setError('Invalid lease ID for this record');
      return;
    }
    if (check && !check.ok) {
      setError('This increase does not meet Washington\'s requirements. See the notes above.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const sessionRes = await supabase.auth.getSession();
      const userId = sessionRes.data?.session?.user?.id;
      const takesEffectLater = wa && effectiveDate > todayIso();

      if (takesEffectLater) {
        // Scheduled: the rent changes on the effective date, and only if the written notice was recorded in time
        if (item.deal_id) {
          const { error: insErr } = await supabase.from('rent_increases').insert({
            user_id: userId,
            lease_id: item.lease_id,
            deal_id: item.deal_id,
            effective_date: effectiveDate,
            old_rent: currentRent,
            new_rent: newRentNum,
            reason: notes.trim() || `Scheduled ${(check?.increasePct ?? 0).toFixed(2)}% increase (Washington written-notice rules)`,
            is_applied: false,
            increase_type: 'percentage',
            scheduled_amount: parseFloat(pctBump) || null,
            notice_sent_date: noticeServed || null,
          });
          if (insErr) throw insErr;
        }
      } else {
        const nextDate = new Date(effectiveDate);
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        const nextDateStr = nextDate.toISOString().slice(0, 10);

        // 1. Update the lease record (the transaction record: nothing here rewrites the deal's underwriting)
        const { error: leaseErr } = await supabase
          .from('leases')
          .update({
            previous_rent_amount: currentRent,
            monthly_rent: newRentNum,
            last_rent_increase_date: effectiveDate,
            next_escalation_date: wa ? null : nextDateStr,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.lease_id);
        if (leaseErr) throw leaseErr;

        // 2. Record the applied increase in the audit ledger
        if (item.deal_id) {
          await supabase.from('rent_increases').insert({
            user_id: userId,
            lease_id: item.lease_id,
            deal_id: item.deal_id,
            effective_date: effectiveDate,
            old_rent: currentRent,
            new_rent: newRentNum,
            reason: notes.trim() || `Applied ${pctBump}% Contractual Escalation`,
            is_applied: true,
            increase_type: 'percentage',
            scheduled_amount: parseFloat(pctBump) || 3.0,
            notice_sent_date: noticeServed || null,
          });
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to apply rent increase:', err);
      setError(err.message || 'Failed to update rent amount');
    } finally {
      setSaving(false);
    }
  };

  const sch = facts?.scheduled;
  const blocked = !!check && !check.ok;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 relative my-auto">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <span className="text-emerald-400">📈</span>
            <span>Record Rent Escalation</span>
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {sch && (
          <div className="mb-4 p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2">
            <div className="font-bold text-white">Scheduled increase</div>
            <div className="text-slate-400">
              ${Number(sch.old_rent || currentRent).toLocaleString()} to ${Number(sch.new_rent || 0).toLocaleString()} effective {sch.effective_date}.{' '}
              {sch.notice_sent_date ? <span className="text-emerald-400">Notice recorded {sch.notice_sent_date}.</span> : <span className="text-amber-400">No written notice recorded yet: the rent will not change until it is.</span>}
            </div>
            {!sch.notice_sent_date && (
              <div className="flex items-center gap-2">
                <input type="date" value={noticeServed} onChange={(e) => setNoticeServed(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white tabular-nums" />
                <button type="button" disabled={saving} onClick={recordScheduledNotice} className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold disabled:opacity-50">Record notice given</button>
                <button type="button" onClick={() => printNotice({ current: Number(sch.old_rent || currentRent), next: Number(sch.new_rent || 0), effective: sch.effective_date })} className="px-3 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white flex items-center gap-1"><Printer className="w-3.5 h-3.5" />Notice</button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-400 font-bold mb-1">Property & Tenant</label>
            <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl">
              <div className="font-bold text-white">{item.tenant_name || 'Commercial Tenant'}</div>
              <div className="text-[11px] text-slate-400">
                {item.deal_title} • {item.unit_number || 'Unit 1'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Current Monthly Rent</label>
              <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-300 font-bold tabular-nums">
                ${currentRent.toLocaleString()}
              </div>
            </div>
            <div>
              <label className="block text-emerald-400 font-bold mb-1">Increase (%)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  value={pctBump}
                  onChange={(e) => handlePctChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold focus:border-emerald-500 focus:outline-none tabular-nums"
                />
                <span className="absolute right-3 top-2 text-slate-400 tabular-nums">%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-emerald-400 font-bold mb-1">New Monthly Rent ($) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={newRent}
                onChange={(e) => setNewRent(e.target.value)}
                className="w-full bg-slate-950 border border-emerald-950 rounded-xl px-3 py-2 text-emerald-400 font-bold text-sm focus:border-emerald-500 focus:outline-none tabular-nums"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Effective Date *</label>
              <input
                type="date"
                required
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none tabular-nums"
              />
            </div>
          </div>

          {wa && check && (
            <div className={`rounded-xl border p-3 space-y-2 ${blocked ? 'border-rose-500/40 bg-rose-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
              <div className={`font-bold flex items-center gap-1.5 ${blocked ? 'text-rose-300' : 'text-emerald-300'}`}>
                <ShieldCheck className="w-4 h-4" />
                <span>Washington rent-increase rules (RCW 59.18.140 and .700)</span>
              </div>
              <div className="text-[11px] text-slate-300 leading-relaxed">
                Written notice of at least <strong>{check.noticeDays} days</strong> is required
                {check.maxPct !== null ? <>, and this increase may not exceed <strong>{check.maxPct}%</strong> (most you can charge: <strong>${check.maxNewRent?.toLocaleString()}</strong>)</> : <> (this property is marked exempt from the percentage limit)</>}.
                Earliest effective date today: <strong>{check.earliestEffectiveDate}</strong>.
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1">Date written notice was given to the tenant</label>
                <input
                  type="date"
                  value={noticeServed}
                  onChange={(e) => setNoticeServed(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none tabular-nums"
                />
                <p className="text-[10px] text-slate-500 mt-1">Leave blank until you have given it. The rent only changes after a notice date is recorded that is far enough ahead of the effective date.</p>
              </div>
              {check.errors.map((m) => <div key={m} className="text-[11px] text-rose-300">• {m}</div>)}
              {check.warnings.map((m) => <div key={m} className="text-[11px] text-amber-300/90">• {m}</div>)}
              <button
                type="button"
                disabled={newRentNum <= currentRent}
                onClick={() => printNotice({ current: currentRent, next: newRentNum, effective: effectiveDate })}
                className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:text-white hover:border-slate-500 flex items-center gap-1.5 disabled:opacity-40"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print notice for the tenant</span>
              </button>
            </div>
          )}

          <div>
            <label className="block text-slate-400 font-bold mb-1">Escalation Mechanism</label>
            <select
              value={increaseType}
              onChange={(e) => setIncreaseType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="Percentage Bump (%)">Contractual Anniversary Escalation (%)</option>
              <option value="CPI Index">CPI Inflation Adjustment</option>
              <option value="Fair Market Review">Fair Market Value (FMV) Reset</option>
              <option value="Fixed Step ($)">Scheduled Fixed Step ($)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Notes / Estoppel Reference</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Executed Lease Amendment #2, CPI adjustment"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white bg-slate-950 border border-slate-800 font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || blocked}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black transition disabled:opacity-50 flex items-center space-x-2"
            >
              {saving ? <span>Saving...</span> : <span>{wa && effectiveDate > todayIso() ? 'Schedule Rent Increase' : 'Apply Rent Increase'}</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
