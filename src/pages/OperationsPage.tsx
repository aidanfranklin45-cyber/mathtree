import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, SUPABASE_URL } from '../lib/supabase/client';
import { authJsonHeaders } from '../lib/supabase/authHeaders';
import { MonthlyRentReconciliationView } from '../lib/supabase/types';
import { buildOperations, escalationInfo, formatPeriodMonth, getDueInfo, type Row, type RentRollRow } from '../lib/operations/rentRoll';
import { ConnectedHeader } from '../components/layout/ConnectedHeader';
import { LogPaymentModal } from '../components/operations/LogPaymentModal';
import { AddLeaseModal } from '../components/operations/AddLeaseModal';
import { RentIncreaseModal } from '../components/operations/RentIncreaseModal';
import { AlertSettingsModal } from '../components/operations/AlertSettingsModal';
import { AuditTrailModal } from '../components/operations/AuditTrailModal';
import { EditLeaseModal } from '../components/operations/EditLeaseModal';

const btnBase = 'px-2 py-1 rounded-lg text-[11px] font-bold transition';

export const OperationsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Raw database facts (everything below is derived from these on render)
  const [entities, setEntities] = useState<Row[]>([]);
  const [deals, setDeals] = useState<Row[]>([]);
  const [leases, setLeases] = useState<Row[]>([]);
  const [units, setUnits] = useState<Row[]>([]);
  const [payments, setPayments] = useState<Row[]>([]);
  const [increases, setIncreases] = useState<Row[]>([]);
  const [baselines, setBaselines] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [entityId, setEntityId] = useState('all');
  const [dealId, setDealId] = useState('all');
  const [scope, setScope] = useState<'owned' | 'all'>('owned');
  const [activeDate, setActiveDate] = useState<Date>(() => new Date());

  // Modals + feedback
  const [paymentItem, setPaymentItem] = useState<MonthlyRentReconciliationView | null>(null);
  const [rentIncreaseItem, setRentIncreaseItem] = useState<MonthlyRentReconciliationView | null>(null);
  const [addLeaseOpen, setAddLeaseOpen] = useState(false);
  const [addLeaseDealId, setAddLeaseDealId] = useState<string | null>(null);
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false);
  const [auditLeaseId, setAuditLeaseId] = useState<string | null>(null);
  const [editLeaseId, setEditLeaseId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      const scoped = (q: any) => (uid ? q.eq('user_id', uid) : q);
      const [rDeals, rLeases, rUnits, rPay, rInc, rEnt, rBase] = await Promise.allSettled([
        scoped(supabase.from('deals').select('*')).order('title', { ascending: true }),
        scoped(supabase.from('leases').select('*')).order('is_active', { ascending: false }),
        scoped(supabase.from('units').select('*')).order('unit_number', { ascending: true }),
        scoped(supabase.from('rent_payments').select('*')).order('period_month', { ascending: false }),
        scoped(supabase.from('rent_increases').select('*')).order('effective_date', { ascending: false }),
        scoped(supabase.from('entities').select('*')).order('name', { ascending: true }),
        scoped(supabase.from('deal_baselines').select('deal_id,baseline_type,projected_gross_rent_annual,captured_at')),
      ]);
      const rows = (r: PromiseSettledResult<any>): Row[] => (r.status === 'fulfilled' && r.value.data) || [];
      setDeals(rows(rDeals));
      setLeases(rows(rLeases));
      setUnits(rows(rUnits));
      setPayments(rows(rPay));
      setIncreases(rows(rInc));
      setEntities(rows(rEnt));
      setBaselines(rows(rBase));
    } catch (err) {
      console.error('Operations load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Deep link from the Action Center: /operations?action=add-lease&deal_id=...
  useEffect(() => {
    if (loading) return;
    if (searchParams.get('action') === 'add-lease') {
      setAddLeaseDealId(searchParams.get('deal_id'));
      setAddLeaseOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [loading, searchParams, setSearchParams]);

  const ops = useMemo(
    () => buildOperations({ deals, leases, units, payments, increases, scope, entityId, dealId, activeDate }),
    [deals, leases, units, payments, increases, scope, entityId, dealId, activeDate],
  );
  const { rows, kpis, scopedDeals } = ops;
  const period = formatPeriodMonth(activeDate);
  const now = new Date();

  // Property dropdown lists the deals visible under the current scope + entity (not the property filter itself)
  const propertyOptions = useMemo(() => {
    let list = deals;
    if (scope === 'owned') list = list.filter((d) => (d.status || 'prospect') === 'owned');
    if (entityId !== 'all') list = list.filter((d) => d.entity_id === entityId);
    return list;
  }, [deals, scope, entityId]);

  const monthLabel = activeDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const changeMonth = (delta: number) => setActiveDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  const paymentFor = (leaseId: string) => payments.find((p) => p.lease_id === leaseId && p.period_month === period);
  const dealOf = (id: string) => deals.find((d) => d.id === id);
  const unitOf = (row: RentRollRow) =>
    units.find((u) => u.id === row.unit_id) || {
      unit_number: row.derived_unit_number || 'Main Suite',
      unit_type: row.derived_unit_type || 'Commercial Suite',
      sqft: row.derived_sqft || 0,
    };

  /** Shape a rent-roll row for the existing Log Payment / Escalate modals. */
  const toItem = (row: RentRollRow): MonthlyRentReconciliationView => {
    const p = paymentFor(row.id);
    return {
      lease_id: row.id,
      deal_id: row.deal_id,
      deal_title: dealOf(row.deal_id)?.title,
      tenant_name: row.tenant_name,
      unit_number: unitOf(row).unit_number,
      contractual_rent: parseFloat(row.monthly_rent) || 0,
      payment_id: p?.id ?? null,
      amount_paid: p ? parseFloat(p.amount_paid) || 0 : 0,
      paid_date: p?.paid_date ?? null,
      payment_method: p?.payment_method ?? null,
      reference_note: p?.reference_note ?? null,
      snooze_until: p?.snooze_until ?? null,
      payment_status: p?.status ?? 'pending',
      current_period: period,
      is_active: row.is_active,
    } as unknown as MonthlyRentReconciliationView;
  };

  const upsertPayment = async (row: RentRollRow, patch: Record<string, unknown>, okText: string) => {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('rent_payments').upsert(
      {
        user_id: auth?.user?.id,
        lease_id: row.id,
        deal_id: row.deal_id,
        period_month: period,
        due_date: period,
        amount_due: row.monthly_rent,
        ...patch,
      } as any,
      { onConflict: 'lease_id,period_month' },
    );
    if (error) return flash('err', `Could not update payment: ${error.message}`);
    flash('ok', okText);
    await load();
  };

  const quickPay = (row: RentRollRow) =>
    upsertPayment(row, {
      amount_paid: row.monthly_rent,
      paid_date: new Date().toISOString().split('T')[0],
      status: 'paid',
      payment_method: '1-Click Direct Reconcile',
      reference_note: 'Direct 1-click verification',
    }, `${row.tenant_name} marked paid for ${monthLabel}.`);

  const quickSnooze = (row: RentRollRow) => {
    const grace = row.grace_period_days || 5;
    const until = new Date();
    until.setDate(until.getDate() + grace);
    return upsertPayment(row, {
      amount_paid: 0,
      status: 'snoozed',
      snooze_until: until.toISOString().split('T')[0],
      snoozed_at: new Date().toISOString(),
      reference_note: `Snoozed by owner: dynamic grace policy of ${grace} days applied`,
    }, `Alert snoozed for ${row.tenant_name} (${grace}-day grace).`);
  };

  const remind = async (row: RentRollRow) => {
    if (!window.confirm(`Send an instant rent reminder email for ${row.tenant_name || 'this tenant'} via Resend?`)) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/cron-daily-lease-monitor`, {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ lease_id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}: ${res.statusText}`);
      flash('ok', `Reminder sent to ${(data as any).recipient || 'recipient'}.`);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      flash('err', text.includes('own email address') || text.includes('verify a domain')
        ? 'Resend free tier only delivers test emails to your own account email. Verify a domain at resend.com/domains to email tenants.'
        : `Failed to send reminder email: ${text}`);
    }
  };

  const forceSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/cron-daily-lease-monitor`, {
        method: 'POST',
        headers: await authJsonHeaders(),
      });
      const data = await res.json();
      if (data?.success) {
        flash('ok', `Monitor complete: ${data.escalations?.leases_escalated || 0} leases escalated, ${data.escalations?.deals_recalculated || 0} deals recalculated, ${data.due_date_notifications_sent || 0} notifications sent.`);
        await load();
      } else {
        flash('err', `Notice from Daily Monitor: ${data?.error || 'Check edge function logs.'}`);
      }
    } catch (err) {
      flash('err', `Daily Monitor invocation: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  const activeLeaseCount = rows.filter((r) => !r.is_vacant).length;
  const vacantCount = rows.filter((r) => r.is_vacant).length;

  const collDot = kpis.overdueCount > 0 ? 'bg-rose-400 animate-pulse' : kpis.pendingCount > 0 ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <ConnectedHeader
        active="operations"
        deals={deals as any}
        onDealsChanged={() => { void load(); }}
        extraActions={(
          <>
            <button
              onClick={() => setAlertSettingsOpen(true)}
              className="flex items-center space-x-1.5 py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition cursor-pointer"
              title="Rent Reconciliation & Alert Email Settings"
            >
              <svg className="w-3.5 h-3.5 text-blue-400 shrink-0 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              <span className="pointer-events-none">Alert Emails</span>
            </button>
            <button
              onClick={() => { setAddLeaseDealId(null); setAddLeaseOpen(true); }}
              className="flex items-center space-x-1.5 py-1.5 px-3 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-900/30 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
              <span>Add Lease</span>
            </button>
          </>
        )}
      />

      <main className="flex-grow max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-7 flex flex-col space-y-6">
        {toast && (
          <div className={`px-4 py-3 rounded-xl border text-xs font-semibold ${toast.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
            {toast.text}
          </div>
        )}

        {/* Filters */}
        <div className="bg-slate-900/70 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-lg backdrop-blur-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Ownership Entity (LLC)</label>
              <div className="relative">
                <select value={entityId} onChange={(e) => { setEntityId(e.target.value); setDealId('all'); }}
                  className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-emerald-500 pr-8 min-w-[200px] sm:min-w-[240px] appearance-none cursor-pointer">
                  <option value="all">All Entities (Consolidated Portfolio)</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Property Filter</label>
              <div className="relative">
                <select value={dealId} onChange={(e) => setDealId(e.target.value)}
                  className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 focus:outline-none focus:border-emerald-500 pr-8 min-w-[180px] sm:min-w-[210px] appearance-none cursor-pointer">
                  <option value="all">All Properties</option>
                  {propertyOptions.map((d) => <option key={d.id} value={d.id}>{d.title || d.name}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Portfolio Scope</label>
              <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-700/80">
                <button type="button" onClick={() => setScope('owned')}
                  className={scope === 'owned'
                    ? 'px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 transition'
                    : 'px-2.5 py-1 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition'}>Owned Assets</button>
                <button type="button" onClick={() => setScope('all')}
                  className={scope === 'all'
                    ? 'px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 transition'
                    : 'px-2.5 py-1 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition'}>All Deals (Inc. Pipeline)</button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end space-x-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800">
            <button onClick={() => changeMonth(-1)} className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-950 border border-slate-800 hover:border-slate-700 transition" title="Previous Month">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div className="text-center px-3">
              <span className="block text-xs sm:text-sm font-extrabold text-white font-mono">{monthLabel}</span>
              <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Billing Cycle</span>
            </div>
            <button onClick={() => changeMonth(1)} className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-950 border border-slate-800 hover:border-slate-700 transition" title="Next Month">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            <button onClick={() => setActiveDate(new Date())} className="text-[11px] text-slate-400 hover:text-white px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 transition">Today</button>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-xl backdrop-blur-sm hover:border-emerald-700/50 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">Portfolio Monthly Rent</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
            </div>
            <span className="text-xl sm:text-2xl font-black text-white mt-1.5 block font-mono">${Math.round(kpis.monthlyRent).toLocaleString()}</span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-800/80">
              <span>Run-Rate:</span>
              <span className="text-emerald-400 font-bold font-mono">${Math.round(kpis.annualRent).toLocaleString()} / yr</span>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-xl backdrop-blur-sm hover:border-blue-700/50 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">Physical Occupancy</span>
              <span className="w-2 h-2 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50" />
            </div>
            <span className="text-xl sm:text-2xl font-black text-white mt-1.5 block font-mono">{kpis.occupancyPct}%</span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-800/80">
              <span>Units Leased:</span>
              <span className="text-blue-400 font-bold font-mono">{kpis.occupiedUnits} / {kpis.totalUnits}</span>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-xl backdrop-blur-sm hover:border-emerald-700/50 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">30-Day Collections</span>
              <span className={`w-2 h-2 rounded-full ${collDot}`} />
            </div>
            <span className="text-xl sm:text-2xl font-black text-emerald-400 mt-1.5 block font-mono">{kpis.collectedPct}%</span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-800/80">
              <span>Status:</span>
              <span className="text-slate-300 font-medium text-[10px]">{kpis.paidCount} Paid • {kpis.pendingCount} Pending • {kpis.overdueCount} Overdue</span>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-xl backdrop-blur-sm hover:border-amber-700/50 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">Upcoming Escalations</span>
              <span className={`w-2 h-2 rounded-full ${kpis.escalationsDueCount > 0 ? 'bg-amber-400 animate-pulse' : kpis.scheduledCount > 0 ? 'bg-cyan-400' : 'bg-emerald-400'}`} />
            </div>
            <span className="text-xl sm:text-2xl font-black text-white mt-1.5 block font-mono">
              {kpis.escalationsDueCount > 0 ? `${kpis.escalationsDueCount} Due Now` : kpis.scheduledCount > 0 ? `${kpis.scheduledCount} Scheduled` : '0 Leases'}
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-800/80">
              <span>Next Scheduled:</span>
              <span className="text-slate-400 text-[10px] truncate max-w-[140px]">
                {kpis.escalationsDueCount > 0
                  ? <span className="text-amber-400 font-bold">Action Required</span>
                  : kpis.scheduledCount > 0
                    ? (kpis.earliestUpcomingStep
                      ? <span className="text-cyan-300 font-mono font-medium">
                          {kpis.earliestUpcomingStep.effective_date} ({kpis.earliestUpcomingStep.increase_type === 'fixed_step' ? `+$${kpis.earliestUpcomingStep.scheduled_amount}` : `+${kpis.earliestUpcomingStep.scheduled_amount}%`})
                        </span>
                      : <span className="text-emerald-400 font-bold">Defined Schedule</span>)
                    : 'All Up-to-Date'}
              </span>
            </div>
          </div>
        </div>

        {/* Underwriting vs Actuals */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm">
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90">
            <h3 className="text-sm sm:text-base font-extrabold text-white"><span>⚖️ Projected vs. Actual (Baseline at Purchase vs. In-Place Rent)</span></h3>
            <p className="text-xs text-slate-400 mt-0.5">Actual = what each property really rents for today. Projected = what we expected when we bought it. Nothing here changes the underwriting: the payments and leases are the record of what happened.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 bg-slate-950/50">
                  <th className="py-3 px-4">Property Asset</th>
                  <th className="py-3 px-4 text-right">Projected at Purchase</th>
                  <th className="py-3 px-4 text-right">Actual In-Place Rent</th>
                  <th className="py-3 px-4 text-right">Monthly Variance ($)</th>
                  <th className="py-3 px-4 text-right">Variance (%)</th>
                  <th className="py-3 px-4 text-center">Actual vs Projected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {scopedDeals.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500 font-semibold">No property models loaded in this scope.</td></tr>
                ) : scopedDeals.map((deal) => {
                  const actual = leases.filter((l) => String(l.deal_id) === String(deal.id) && l.is_active !== false)
                    .reduce((s, l) => s + (parseFloat(l.monthly_rent) || 0), 0);
                  // Expected = the frozen baseline captured at acquisition; deals without one fall back to today's pro-forma
                  const baseline = baselines.find((b) => String(b.deal_id) === String(deal.id) && b.baseline_type === 'initial_underwriting');
                  const inputs = deal.inputs || {};
                  const projAnnual = baseline ? (parseFloat(baseline.projected_gross_rent_annual) || 0) : (parseFloat(inputs.grossRentAnnual) || 0);
                  const proj = projAnnual > 0 ? projAnnual / 12 : (parseFloat(inputs.grossRentPerMonth) || parseFloat(inputs.monthlyRent) || 0);
                  const expectedNote = baseline ? `Baseline ${String(baseline.captured_at || '').slice(0, 10)}` : 'Pro-forma (no baseline yet)';
                  const varUsd = actual - proj;
                  const varPct = proj > 0 ? (varUsd / proj) * 100 : 0;
                  const absPct = Math.abs(varPct);
                  const accuracy = Math.max(0, Math.min(100, Math.round(100 - absPct)));
                  const varColor = absPct <= 2 ? 'text-emerald-400' : varUsd > 0 ? 'text-teal-400' : 'text-amber-400';
                  const barColor = accuracy >= 90 ? 'bg-emerald-500' : accuracy >= 75 ? 'bg-amber-500' : 'bg-rose-500';
                  return (
                    <tr key={deal.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-white">{deal.title || deal.name}</div>
                        <div className="text-[10px] text-slate-400 capitalize">{deal.status || 'prospect'} • {deal.asset_class || deal.asset_type || 'Commercial'}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300">
                        ${Math.round(proj).toLocaleString()} / mo
                        <span className="block text-[10px] font-sans text-slate-500">{expectedNote}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">${Math.round(actual).toLocaleString()} / mo</td>
                      <td className={`py-3 px-4 text-right font-mono font-bold ${varColor}`}>{varUsd >= 0 ? '+' : ''}${Math.round(varUsd).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">
                        {absPct <= 2
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Aligned</span>
                          : varUsd > 0
                            ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/10 text-teal-400 border border-teal-500/20">+{varPct.toFixed(1)}% Outperforming</span>
                            : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">{varPct.toFixed(1)}% Trailing</span>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-2 max-w-[140px] mx-auto">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className={`h-full rounded-full ${barColor}`} style={{ width: `${accuracy}%` }} /></div>
                          <span className="font-mono text-[10px] font-bold text-slate-300">{accuracy}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Master Rent Roll */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm">
          <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center space-x-2">
                <span>Master Rent Roll &amp; Lease Ledger</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {activeLeaseCount} Active {activeLeaseCount === 1 ? 'Lease' : 'Leases'}{vacantCount > 0 ? ` • ${vacantCount} Vacant` : ''}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Monitor tenant lease status, due dates, in-place cash flows, and escalation opportunities.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={forceSync} disabled={syncing}
                className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium transition disabled:opacity-60">
                <span>{syncing ? '⏳' : '⚡'}</span>
                <span className="hidden sm:inline">{syncing ? 'Syncing...' : 'Force Sync'}</span>
              </button>
              <button onClick={() => { void load(); }} className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-800 border border-slate-700 hover:border-slate-600 transition" title="Refresh Live Database">
                <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 bg-slate-950/50">
                  <th className="py-3 px-4">Property &amp; Unit</th>
                  <th className="py-3 px-4">Tenant</th>
                  <th className="py-3 px-4 text-right">In-Place Rent</th>
                  <th className="py-3 px-4">Rent Due</th>
                  <th className="py-3 px-4">Lease Expiration</th>
                  <th className="py-3 px-4">Last Escalation</th>
                  <th className="py-3 px-4 text-center">Month Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-slate-400"><div className="animate-pulse flex flex-col items-center justify-center space-y-2"><div className="h-4 w-32 bg-slate-800 rounded" /><span className="text-xs">Connecting to Supabase production database...</span></div></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="py-10 text-center text-slate-400">
                    <div className="max-w-sm mx-auto space-y-3">
                      <span className="text-3xl block">📋</span>
                      <p className="font-bold text-white text-sm">No Properties or Leases in Selected Scope</p>
                      <p className="text-xs text-slate-500">Register an entity and link an active lease to begin tracking real-time rent rolls and escalation logs.</p>
                      <button onClick={() => { setAddLeaseDealId(null); setAddLeaseOpen(true); }} className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">+ Add First Lease</button>
                    </div>
                  </td></tr>
                ) : rows.map((row) => {
                  const deal = dealOf(row.deal_id) || { title: 'Unknown Asset' };

                  if (row.is_vacant) {
                    return (
                      <tr key={row.id} className="hover:bg-slate-800/30 transition bg-slate-950/20">
                        <td className="py-3 px-4">
                          <span className="block font-bold text-white text-xs">{deal.title || deal.name}</span>
                          <span className="block text-[11px] text-slate-400 font-medium">{row.unit_number} <span className="text-slate-500">({row.unit_type})</span></span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="block font-semibold text-slate-400 italic">— Vacant / No Active Tenant —</span>
                          <span className="block text-[10px] text-slate-500">Ready for tenancy</span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-500 text-xs">$0.00</td>
                        <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">—</td>
                        <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">—</td>
                        <td className="py-3 px-4"><span className="text-[11px] text-slate-500 italic">No Active Lease</span></td>
                        <td className="py-3 px-4 text-center"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">Vacant</span></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            <button onClick={() => { setAddLeaseDealId(deal.id); setAddLeaseOpen(true); }}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border border-emerald-500/50 shadow-md transition">
                              <span>+ Add Tenant</span>
                            </button>
                            {['✓ Pay', '⏳ Snooze', '📧 Remind', 'Escalate'].map((label) => (
                              <button key={label} disabled className={`${btnBase} text-slate-600 bg-slate-900/60 border border-slate-800/40 cursor-not-allowed opacity-30`}>{label}</button>
                            ))}
                            <button onClick={() => setAuditLeaseId(`vacant-${deal.id}`)} className="p-1 rounded-lg text-slate-500 hover:text-slate-300 bg-slate-800 hover:bg-slate-700 transition" title="View Property History">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const unit = unitOf(row);
                  const payment = paymentFor(row.id);
                  const dueInfo = getDueInfo(row, payments.find((p) => p.lease_id === row.id && p.period_month === formatPeriodMonth(now)), now);
                  const esc = escalationInfo(row, increases, now);
                  const isPaid = payment?.status === 'paid';
                  const isSnoozed = Boolean(payment?.snooze_until && new Date(payment.snooze_until) >= now);
                  const isOverdue = payment?.status === 'overdue';
                  const grace = row.grace_period_days || 5;
                  const derived = Boolean(row.is_derived);
                  const rentFormatted = (parseFloat(row.monthly_rent) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                  const statusBadge = isPaid
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">✓ Paid</span>
                    : isSnoozed
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40" title={`Alert snoozed until ${payment?.snooze_until} (${grace}-day grace)`}>⏳ Snoozed</span>
                      : isOverdue
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">⚠️ Overdue</span>
                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20" title={`Rent due on day ${row.payment_due_day || 1}`}>Due Day {row.payment_due_day || 1}</span>;

                  const disabledTip = derived ? 'Use ✎ Edit to save this tenancy as a lease first' : undefined;

                  return (
                    <tr key={row.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <span className="block font-bold text-white text-xs">{deal.title}</span>
                        <span className="block text-[11px] text-emerald-400 font-medium">{unit.unit_number} <span className="text-slate-500">({unit.unit_type || 'Commercial'})</span></span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="block font-semibold text-slate-200">{row.tenant_name}</span>
                        <span className="block text-[10px] text-slate-400">{row.tenant_email || row.tenant_phone || 'No contact on file'}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400 text-xs">${rentFormatted}</td>
                      <td className="py-3 px-4">
                        <span className="block font-mono text-[11px] text-slate-200">
                          Next due {dueInfo.nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          <span className="text-slate-500"> · {dueInfo.daysUntilNext === 0 ? 'today' : `in ${dueInfo.daysUntilNext}d`}</span>
                        </span>
                        <span className={`block text-[10px] font-semibold ${dueInfo.state === 'paid' ? 'text-emerald-400' : dueInfo.state === 'overdue' ? 'text-rose-400' : dueInfo.state === 'late' || dueInfo.state === 'snoozed' ? 'text-amber-400' : 'text-slate-400'}`}>{dueInfo.summary}</span>
                        <span className="block text-[10px] text-slate-500">Due day {dueInfo.dueDay}{row.is_derived ? ' (set via Edit)' : ''}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">
                        {row.lease_end_date ? row.lease_end_date : <span className="text-amber-400/90 font-semibold">Month-to-Month</span>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col space-y-0.5">
                          <div className="flex items-center space-x-1.5">
                            <span className="font-mono text-[11px] text-slate-300">{row.last_rent_increase_date || row.lease_start_date}</span>
                            {esc.isScheduledDue
                              ? <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[9px] font-bold" title="Scheduled escalation date has arrived">⚠️ Escalation Due</span>
                              : esc.isAdvanceScheduled
                                ? <span className="px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[9px] font-bold" title={`Scheduled contractual increase queued for ${esc.nearestScheduled?.effective_date}`}>📈 Scheduled: {esc.scheduledValStr}</span>
                                : esc.isUnscheduledReviewDue
                                  ? <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[9px] font-bold" title="No escalation schedule in place (>12 months)">⚠️ Review Due</span>
                                  : esc.hasDefinedSchedule
                                    ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[9px] font-bold" title="Contractual escalation schedule active">✓ Defined Schedule</span>
                                    : null}
                          </div>
                          {esc.hasDefinedSchedule && (
                            <span className="text-[10px] text-slate-400">
                              {row.escalation_frequency || 'Annual'}: <strong className="text-slate-300">{esc.scheduledValStr || (row.escalation_rate ? `+${row.escalation_rate}%` : (row.escalation_type || 'Scheduled'))}</strong>
                              {esc.nearestScheduled && <> • Next: <span className="font-mono text-slate-300">{esc.nearestScheduled.effective_date}</span></>}
                              {esc.leaseScheduledSteps.length > 1 && <> <span className="text-[9px] text-cyan-400/90 font-medium">({esc.leaseScheduledSteps.length} steps queued)</span></>}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">{statusBadge}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          {!isPaid && (
                            <>
                              <button disabled={derived} title={disabledTip} onClick={() => quickPay(row)}
                                className={`${btnBase} text-emerald-300 bg-emerald-950/80 border border-emerald-600 hover:bg-emerald-600 hover:text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed`}>✓ Pay</button>
                              <button disabled={derived} title={disabledTip} onClick={() => quickSnooze(row)}
                                className={`${btnBase} text-amber-300 bg-amber-950/80 border border-amber-600 hover:bg-amber-600 hover:text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed`}>⏳ Snooze</button>
                              <button disabled={derived} title={disabledTip} onClick={() => remind(row)}
                                className={`${btnBase} text-indigo-300 bg-indigo-950/80 border border-indigo-600 hover:bg-indigo-600 hover:text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed`}>📧 Remind</button>
                            </>
                          )}
                          <button onClick={() => setEditLeaseId(row.id)} title="Edit Lease & Escalation Schedule"
                            className={`${btnBase} text-cyan-300 bg-cyan-950/60 border border-cyan-800/60 hover:bg-cyan-800`}>✎ Edit</button>
                          <button disabled={derived} title={derived ? disabledTip : 'Log Payment'} onClick={() => setPaymentItem(toItem(row))}
                            className={`${btnBase} text-emerald-300 bg-emerald-950/60 border border-emerald-800/60 hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed`}>Log</button>
                          <button disabled={derived} title={derived ? disabledTip : 'Record or Schedule Rent Escalation'} onClick={() => setRentIncreaseItem(toItem(row))}
                            className={`${btnBase} text-blue-300 bg-blue-950/60 border border-blue-800/60 hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed`}>Escalate</button>
                          <button onClick={() => setAuditLeaseId(row.id)} className="p-1 rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition" title="View Audit Trail">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-center">
          <Link to="/" className="text-[11px] text-slate-500 hover:text-emerald-400 transition">← Back to Portfolio &amp; Pipeline</Link>
        </div>
      </main>

      <LogPaymentModal isOpen={!!paymentItem} item={paymentItem} onClose={() => setPaymentItem(null)} onSuccess={() => { setPaymentItem(null); void load(); }} />
      <RentIncreaseModal isOpen={!!rentIncreaseItem} item={rentIncreaseItem} onClose={() => setRentIncreaseItem(null)} onSuccess={() => { setRentIncreaseItem(null); void load(); }} />
      <AddLeaseModal
        isOpen={addLeaseOpen}
        deals={deals.map((d) => ({ id: d.id, title: d.title || d.name }))}
        initialDealId={addLeaseDealId}
        onClose={() => setAddLeaseOpen(false)}
        onSuccess={() => { setAddLeaseOpen(false); void load(); }}
      />
      <EditLeaseModal leaseId={editLeaseId} deals={deals} units={units} increases={increases} leases={ops.scopedLeases} onClose={() => setEditLeaseId(null)} onSaved={() => { setEditLeaseId(null); void load(); }} />
      <AlertSettingsModal isOpen={alertSettingsOpen} onClose={() => setAlertSettingsOpen(false)} />
      <AuditTrailModal leaseId={auditLeaseId} deals={deals} leases={leases} units={units} increases={increases} derivedLeases={ops.scopedLeases} onClose={() => setAuditLeaseId(null)} />
    </div>
  );
};
