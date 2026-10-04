import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, SUPABASE_URL } from '../../lib/supabase/client';
import { authJsonHeaders } from '../../lib/supabase/authHeaders';
import { MonthlyRentReconciliationView } from '../../lib/supabase/types';
import { buildOperations, formatPeriodMonth, type Row, type RentRollRow } from '../../lib/operations/rentRoll';
import { LogPaymentModal } from './LogPaymentModal';
import { AddLeaseModal } from './AddLeaseModal';
import { RentRollModal } from './RentRollModal';
import { RentIncreaseModal } from './RentIncreaseModal';
import { AlertSettingsModal } from './AlertSettingsModal';
import { AuditTrailModal } from './AuditTrailModal';
import { EditLeaseModal } from './EditLeaseModal';
import { OpsSummaryStrip, type RollFilter } from './OpsSummaryStrip';
import { ActionNeededList } from './ActionNeededList';
import { RentRollTable } from './RentRollTable';
import { LeaseDrawer } from './LeaseDrawer';
import { ProjectedVsActual } from './ProjectedVsActual';
import { LeaseExpiryLadder } from './LeaseExpiryLadder';
import { MenuItem, Popover, triggerBtn } from './Popover';
import { RecoveriesPanel } from './RecoveriesPanel';
import { summarizeLeaseRecoveries, normalizeRecoveryPrefs, maxLeadDays, DEFAULT_RECOVERY_PREFS, type LeaseRecoverySummary, type RecoveryPrefs, RECOVERY_CATEGORY_LABELS } from '../../lib/operations/recoveries';
import { syncRecoveryItems } from '../../lib/operations/recoveryDb';
import { isResidentialAsset } from '../../../supabase/functions/_shared/rentIncreaseRules';
import { buildRowView, type RowHandlers } from './rowStatus';

type OpsSnapshot = {
  entities: Row[]; deals: Row[]; leases: Row[]; units: Row[]; payments: Row[]; increases: Row[]; baselines: Row[];
  recTerms: Row[]; recItems: Row[]; recons: Row[]; meters: Row[]; readings: Row[]; recPrefs: RecoveryPrefs;
};

// Last loaded data, kept for the session so revisiting the page paints instantly while a fresh load runs in the background.
let opsCache: OpsSnapshot | null = null;
supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') opsCache = null; });

export interface OperationsWorkspaceProps {
  /**
   * Show a single property (the deal screen's Operate tab). The property picker, entity and portfolio filters, the
   * portfolio-only comparison and the page header are left out; everything else is the same code the Operations page runs.
   */
  lockedDealId?: string;
  /** Page mode: renders the page header. It gets the loaded deals, a reload, and the Add Lease / More actions the header shows. */
  renderHeader?: (api: { deals: Row[]; reload: () => void; actions: React.ReactNode }) => React.ReactNode;
}

export const OperationsWorkspace: React.FC<OperationsWorkspaceProps> = ({ lockedDealId, renderHeader }) => {
  const locked = !!lockedDealId;
  const [searchParams, setSearchParams] = useSearchParams();

  // Raw database facts (everything below is derived from these on render)
  const [entities, setEntities] = useState<Row[]>(opsCache?.entities ?? []);
  const [deals, setDeals] = useState<Row[]>(opsCache?.deals ?? []);
  const [leases, setLeases] = useState<Row[]>(opsCache?.leases ?? []);
  const [units, setUnits] = useState<Row[]>(opsCache?.units ?? []);
  const [payments, setPayments] = useState<Row[]>(opsCache?.payments ?? []);
  const [increases, setIncreases] = useState<Row[]>(opsCache?.increases ?? []);
  const [baselines, setBaselines] = useState<Row[]>(opsCache?.baselines ?? []);
  const [recTerms, setRecTerms] = useState<Row[]>(opsCache?.recTerms ?? []);
  const [recItems, setRecItems] = useState<Row[]>(opsCache?.recItems ?? []);
  const [recons, setRecons] = useState<Row[]>(opsCache?.recons ?? []);
  const [meters, setMeters] = useState<Row[]>(opsCache?.meters ?? []);
  const [readings, setReadings] = useState<Row[]>(opsCache?.readings ?? []);
  const [recPrefs, setRecPrefs] = useState<RecoveryPrefs>(opsCache?.recPrefs ?? DEFAULT_RECOVERY_PREFS);
  // Only show the blocking loading state when there is nothing cached to display
  const [loading, setLoading] = useState(!opsCache);

  // Filters
  const [entityId, setEntityId] = useState('all');
  const [dealId, setDealId] = useState(lockedDealId ?? 'all');
  const [scope, setScope] = useState<'owned' | 'all'>(lockedDealId ? 'all' : 'owned');
  const [activeDate, setActiveDate] = useState<Date>(() => new Date());

  // Modals + feedback
  const [paymentItem, setPaymentItem] = useState<MonthlyRentReconciliationView | null>(null);
  const [rentIncreaseItem, setRentIncreaseItem] = useState<MonthlyRentReconciliationView | null>(null);
  const [addLeaseOpen, setAddLeaseOpen] = useState(false);
  const [rentRollOpen, setRentRollOpen] = useState(false);
  const [addLeaseDealId, setAddLeaseDealId] = useState<string | null>(null);
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false);
  const [auditLeaseId, setAuditLeaseId] = useState<string | null>(null);
  const [editLeaseId, setEditLeaseId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RollFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    if (!opsCache) setLoading(true);
    try {
      // Local session read: avoids a network round trip to /auth/v1/user before any data can load
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth?.session?.user?.id;
      const scoped = (q: any) => (uid ? q.eq('user_id', uid) : q);
      const [rDeals, rLeases, rUnits, rPay, rInc, rEnt, rBase, rTerms, rItems, rRecons, rMeters, rReads] = await Promise.allSettled([
        scoped(supabase.from('deals').select('*')).order('title', { ascending: true }),
        scoped(supabase.from('leases').select('*')).order('is_active', { ascending: false }),
        scoped(supabase.from('units').select('*')).order('unit_number', { ascending: true }),
        scoped(supabase.from('rent_payments').select('*')).order('period_month', { ascending: false }),
        scoped(supabase.from('rent_increases').select('*')).order('effective_date', { ascending: false }),
        scoped(supabase.from('entities').select('*')).order('name', { ascending: true }),
        scoped(supabase.from('deal_baselines').select('deal_id,baseline_type,projected_gross_rent_annual,captured_at')),
        scoped(supabase.from('lease_recovery_terms').select('*')),
        scoped(supabase.from('lease_recovery_items').select('*')).order('due_date', { ascending: true }),
        scoped(supabase.from('cam_reconciliations').select('*')),
        scoped(supabase.from('utility_meters').select('*')),
        scoped(supabase.from('meter_readings').select('*')),
      ]);
      const rows = (r: PromiseSettledResult<any>): Row[] => (r.status === 'fulfilled' && r.value.data) || [];
      // Recovery tables may not exist yet on an older database; that just means nothing is tracked.
      const termRows = rows(rTerms);
      let itemRows = rows(rItems);
      let prefs = DEFAULT_RECOVERY_PREFS;
      const trackedIds = new Set(rows(rLeases).filter((l) => l.track_recoveries && l.is_active !== false).map((l) => l.id));
      try {
        const { data: prof } = uid ? await supabase.from('profiles').select('alert_preferences').eq('id', uid).maybeSingle() : { data: null };
        prefs = normalizeRecoveryPrefs(prof?.alert_preferences as Record<string, unknown> | null);
        setRecPrefs(prefs);
        const created = await syncRecoveryItems(termRows.filter((t) => trackedIds.has(t.lease_id)), itemRows, maxLeadDays([prefs]));
        if (created > 0) {
          const { data } = await scoped(supabase.from('lease_recovery_items').select('*')).order('due_date', { ascending: true });
          itemRows = data || itemRows;
        }
      } catch (syncErr) {
        console.warn('Recovery schedule sync skipped:', syncErr);
      }
      setRecTerms(termRows);
      setRecItems(itemRows);
      setRecons(rows(rRecons));
      setMeters(rows(rMeters));
      setReadings(rows(rReads));
      setDeals(rows(rDeals));
      setLeases(rows(rLeases));
      setUnits(rows(rUnits));
      setPayments(rows(rPay));
      setIncreases(rows(rInc));
      setEntities(rows(rEnt));
      setBaselines(rows(rBase));
      opsCache = {
        entities: rows(rEnt), deals: rows(rDeals), leases: rows(rLeases), units: rows(rUnits), payments: rows(rPay),
        increases: rows(rInc), baselines: rows(rBase), recTerms: termRows, recItems: itemRows, recons: rows(rRecons),
        meters: rows(rMeters), readings: rows(rReads), recPrefs: prefs,
      };
    } catch (err) {
      console.error('Operations load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Deep link from the Action Center: /operations?action=add-lease&deal_id=...
  useEffect(() => {
    if (loading || locked) return; // embedded in a deal screen: its URL belongs to that page
    // Deep link from a recovery notification: /operations?lease_id=... opens that lease's drawer
    const linkedLease = searchParams.get('lease_id');
    if (linkedLease && !searchParams.get('action')) {
      setSelectedId(linkedLease);
      setSearchParams({}, { replace: true });
      return;
    }
    if (searchParams.get('action') === 'add-lease') {
      setAddLeaseDealId(searchParams.get('deal_id'));
      setAddLeaseOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [loading, locked, searchParams, setSearchParams]);

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

  // Stable so the expiry ladder only recomputes when the leases or units change
  const sqftOf = useCallback(
    (l: Row) => parseFloat(units.find((u) => u.id === l.unit_id)?.sqft) || parseFloat(l.derived_sqft) || 0,
    [units],
  );

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

  const isCurrentPeriod = period === formatPeriodMonth(now);
  const currentMonthPeriod = formatPeriodMonth(now);

  // One computed view per row, shared by the action list, the table and the drawer
  // NNN recovery roll-up per opted-in lease (empty for everyone else)
  // Any lease ever recorded (including ended ones) counts as history
  const historyDealIds = useMemo(() => new Set<string>(leases.map((l) => l.deal_id)), [leases]);

  const recoverySummaries = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const out = new Map<string, LeaseRecoverySummary>();
    for (const l of leases) {
      if (!l.track_recoveries) continue;
      out.set(l.id, summarizeLeaseRecoveries(l, recTerms.filter((t) => t.lease_id === l.id) as any, recItems.filter((i) => i.lease_id === l.id) as any, today, { leadDays: recPrefs.leadDays }));
    }
    return out;
  }, [leases, recTerms, recItems, recPrefs]);

  const views = useMemo(
    () => rows.map((r) => {
      const view = buildRowView(
        r,
        r.is_vacant ? undefined : payments.find((p) => p.lease_id === r.id && p.period_month === period),
        r.is_vacant ? undefined : payments.find((p) => p.lease_id === r.id && p.period_month === currentMonthPeriod),
        increases,
        new Date(),
        isCurrentPeriod,
      );
      if (!view.vacant && isCurrentPeriod && (recoverySummaries.get(r.id)?.overdue ?? 0) > 0) view.attention.push('recovery');
      return view;
    }),
    [rows, payments, increases, period, currentMonthPeriod, isCurrentPeriod, recoverySummaries],
  );

  const recoveryNote = (leaseId: string) => {
    const s = recoverySummaries.get(leaseId);
    if (!s || s.overdue === 0) return '';
    return `${s.overdue} NNN ${s.overdue === 1 ? 'item' : 'items'} overdue${s.next ? ` · ${RECOVERY_CATEGORY_LABELS[s.next.category]} due ${s.next.due_date}` : ''}`;
  };

  const visibleViews = useMemo(() => views.filter((v) => {
    switch (statusFilter) {
      case 'attention': return v.attention.length > 0;
      case 'unpaid': return !v.vacant && !v.isPaid;
      case 'overdue': return v.statusKey === 'overdue' || v.statusKey === 'late';
      case 'vacant': return v.vacant;
      case 'escalation': return Boolean(v.esc && (v.esc.isScheduledDue || v.esc.isAdvanceScheduled || v.esc.nearestScheduled));
      default: return true;
    }
  }), [views, statusFilter]);

  const filterLabels: Record<RollFilter, string> = {
    all: 'All', attention: 'Needs attention', unpaid: 'Unpaid', overdue: 'Overdue', vacant: 'Vacant units', escalation: 'Escalations',
  };

  const handlers: RowHandlers = {
    pay: (row) => { void quickPay(row); },
    snooze: (row) => { void quickSnooze(row); },
    remind: (row) => { void remind(row); },
    log: (row) => setPaymentItem(toItem(row)),
    escalate: (row) => setRentIncreaseItem(toItem(row)),
    edit: (row) => setEditLeaseId(row.id),
    history: (row) => setAuditLeaseId(row.is_vacant ? `vacant-${row.deal_id}` : row.id),
    addTenant: (id) => { setAddLeaseDealId(id); setAddLeaseOpen(true); },
  };

  // Actions that open a modal close the drawer first so the modal isn't stacked behind it
  const drawerHandlers: RowHandlers = {
    ...handlers,
    log: (row) => { setSelectedId(null); handlers.log(row); },
    escalate: (row) => { setSelectedId(null); handlers.escalate(row); },
    edit: (row) => { setSelectedId(null); handlers.edit(row); },
    history: (row) => { setSelectedId(null); handlers.history(row); },
  };

  const selectedView = selectedId ? views.find((v) => v.row.id === selectedId && !v.vacant) ?? null : null;
  const dealTitleOf = (id: string) => dealOf(id)?.title || dealOf(id)?.name || 'Unknown Asset';
  const activeFilterCount = (entityId !== 'all' ? 1 : 0) + (scope !== 'owned' ? 1 : 0);

  const defaultDealId = lockedDealId ?? null;

  // Add Lease and the More menu: in the page header on /operations, in the toolbar on a deal screen
  const actions = (
    <>
      <button
        onClick={() => { setAddLeaseDealId(defaultDealId); setAddLeaseOpen(true); }}
        aria-label="Add lease" className="flex items-center space-x-1.5 py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-900/30 transition"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
        <span className="hidden sm:inline">Add Lease</span>
      </button>
      <Popover trigger={<span>More ▾</span>} triggerClassName={triggerBtn} triggerTitle="Rent roll, alert emails and sync" panelClassName="w-56">
        {(close) => (
          <>
            <MenuItem onClick={() => { close(); setRentRollOpen(true); }}>{locked ? 'Edit rent roll' : 'Edit rent roll by property'}</MenuItem>
            <MenuItem onClick={() => { close(); setAlertSettingsOpen(true); }}>Alert email settings</MenuItem>
            <MenuItem onClick={() => { close(); void forceSync(); }} disabled={syncing}>{syncing ? 'Syncing…' : 'Run daily sync now'}</MenuItem>
          </>
        )}
      </Popover>
    </>
  );

  return (
    <>
      {renderHeader?.({ deals, reload: () => { void load(); }, actions })}

      <div className={locked ? 'flex flex-col space-y-4' : 'flex-grow max-w-6xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-7 flex flex-col space-y-4'}>
        {toast && (
          <div className={`px-4 py-3 rounded-xl border text-xs font-semibold ${toast.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
            {toast.text}
          </div>
        )}

        {/* Slim controls: property, month, and the less-used filters tucked in a popover */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {locked ? actions : (<>
            <select value={dealId} onChange={(e) => setDealId(e.target.value)} aria-label="Property"
              className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 focus:outline-none focus:border-emerald-500 min-w-[180px] cursor-pointer">
              <option value="all">All Properties</option>
              {propertyOptions.map((d) => <option key={d.id} value={d.id}>{d.title || d.name}</option>)}
            </select>
            <Popover
              align="left"
              panelClassName="w-72 p-3 space-y-3"
              triggerTitle="Entity and portfolio scope"
              triggerClassName={triggerBtn}
              trigger={<><span>Filters</span>{activeFilterCount > 0 && <span className="ml-1 px-1.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-extrabold">{activeFilterCount}</span>}</>}
            >
              {() => (
                <>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Ownership entity (LLC)</label>
                    <select value={entityId} onChange={(e) => { setEntityId(e.target.value); setDealId('all'); }}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-emerald-500 cursor-pointer">
                      <option value="all">All entities (consolidated)</option>
                      {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Portfolio scope</label>
                    <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-700/80">
                      {(['owned', 'all'] as const).map((s) => (
                        <button key={s} type="button" onClick={() => setScope(s)}
                          className={scope === s
                            ? 'px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 transition'
                            : 'px-2.5 py-1 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition'}>
                          {s === 'owned' ? 'Owned assets' : 'All deals (incl. pipeline)'}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </Popover>
            </>)}
          </div>

          <div className="flex items-center space-x-2">
            <button onClick={() => changeMonth(-1)} className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition" title="Previous month" aria-label="Previous month">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-xs sm:text-sm font-extrabold text-white font-mono min-w-[110px] text-center">{monthLabel}</span>
            <button onClick={() => changeMonth(1)} className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition" title="Next month" aria-label="Next month">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            {!isCurrentPeriod && (
              <button onClick={() => setActiveDate(new Date())} className="text-[11px] text-slate-400 hover:text-white px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 transition">Today</button>
            )}
          </div>
        </div>

        <OpsSummaryStrip kpis={kpis} active={statusFilter} onFilter={setStatusFilter} />

        {isCurrentPeriod && (
          <ActionNeededList
            views={views}
            dealTitle={dealTitleOf}
            handlers={handlers}
            onSelect={setSelectedId}
            onShowAll={() => setStatusFilter('attention')}
            recoveryNote={recoveryNote}
          />
        )}

        {/* Rent roll */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl shadow-xl">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-900/90 rounded-t-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-extrabold text-white">Rent roll</h3>
              <span className="text-[11px] text-slate-400">
                {activeLeaseCount} active {activeLeaseCount === 1 ? 'lease' : 'leases'}{vacantCount > 0 ? ` · ${vacantCount} vacant` : ''}
              </span>
              {statusFilter !== 'all' && (
                <button type="button" onClick={() => setStatusFilter('all')} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 transition">
                  {filterLabels[statusFilter]} ✕
                </button>
              )}
            </div>
            <button onClick={() => { void load(); }} className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-800 border border-slate-700 hover:border-slate-600 transition" title="Refresh" aria-label="Refresh">
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>
          <div className="overflow-x-auto sm:overflow-visible">
            <RentRollTable
              views={visibleViews}
              loading={loading}
              dealOf={dealOf}
              unitOf={unitOf}
              handlers={handlers}
              onSelect={setSelectedId}
              onAddFirstLease={() => { setAddLeaseDealId(defaultDealId); setAddLeaseOpen(true); }}
              recoverySummaries={recoverySummaries}
              historyDealIds={historyDealIds}
              filtered={statusFilter !== 'all'}
            />
          </div>
        </div>

        <LeaseExpiryLadder leases={ops.scopedLeases} sqftOf={sqftOf} dealTitle={dealTitleOf} onSelect={setSelectedId} />

        {!locked && <ProjectedVsActual deals={scopedDeals} leases={leases} baselines={baselines} />}

        {!locked && (
          <div className="text-center">
            <Link to="/" className="text-[11px] text-slate-500 hover:text-emerald-400 transition">← Back to Portfolio &amp; Pipeline</Link>
          </div>
        )}
      </div>

      <LeaseDrawer
        view={selectedView}
        dealTitle={selectedView ? dealTitleOf(selectedView.row.deal_id) : ''}
        unit={selectedView ? unitOf(selectedView.row) : null}
        payments={payments}
        handlers={drawerHandlers}
        recoveries={selectedView && !isResidentialAsset(dealOf(selectedView.row.deal_id)?.asset_type) ? (
          <RecoveriesPanel
            lease={selectedView.row}
            derived={selectedView.derived}
            propertySqft={Number(dealOf(selectedView.row.deal_id)?.inputs?.gla ?? dealOf(selectedView.row.deal_id)?.inputs?.commSqFt) || null}
            unitSqft={Number(unitOf(selectedView.row).sqft) || null}
            terms={recTerms}
            items={recItems}
            recons={recons}
            meters={meters}
            readings={readings}
            leadDays={recPrefs.leadDays}
            onChanged={() => { void load(); }}
          />
        ) : null}
        onClose={() => setSelectedId(null)}
      />

      <LogPaymentModal isOpen={!!paymentItem} item={paymentItem} onClose={() => setPaymentItem(null)} onSuccess={() => { setPaymentItem(null); void load(); }} />
      <RentIncreaseModal isOpen={!!rentIncreaseItem} item={rentIncreaseItem} onClose={() => setRentIncreaseItem(null)} onSuccess={() => { setRentIncreaseItem(null); void load(); }} />
      <AddLeaseModal
        isOpen={addLeaseOpen}
        deals={deals.map((d) => ({ id: d.id, title: d.title || d.name }))}
        initialDealId={addLeaseDealId}
        onClose={() => setAddLeaseOpen(false)}
        onSuccess={() => { setAddLeaseOpen(false); void load(); }}
      />
      <RentRollModal
        isOpen={rentRollOpen}
        deals={deals}
        units={units}
        leases={leases}
        initialDealId={lockedDealId ?? (dealId !== 'all' ? dealId : null)}
        onClose={() => setRentRollOpen(false)}
        onSaved={() => { setRentRollOpen(false); void load(); flash('ok', 'Rent roll saved.'); }}
      />
      <EditLeaseModal leaseId={editLeaseId} deals={deals} units={units} increases={increases} leases={ops.scopedLeases} onClose={() => setEditLeaseId(null)} onSaved={() => { setEditLeaseId(null); void load(); }} />
      <AlertSettingsModal isOpen={alertSettingsOpen} onClose={() => setAlertSettingsOpen(false)} />
      <AuditTrailModal leaseId={auditLeaseId} deals={deals} leases={leases} units={units} increases={increases} derivedLeases={ops.scopedLeases} onClose={() => setAuditLeaseId(null)} />
    </>
  );
};
