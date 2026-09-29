import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import {
  Building2,
  ArrowLeft,
  ShieldCheck,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { EntityRow, MonthlyRentReconciliationView } from '../lib/supabase/types';
import { MasterRentRoll } from '../components/operations/MasterRentRoll';
import { LogPaymentModal } from '../components/operations/LogPaymentModal';
import { AddLeaseModal } from '../components/operations/AddLeaseModal';
import { RentIncreaseModal } from '../components/operations/RentIncreaseModal';

export const OperationsPage: React.FC = () => {
  const [reconciliationItems, setReconciliationItems] = useState<MonthlyRentReconciliationView[]>([]);
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [rawLeases, setRawLeases] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Month Navigation (Billing Cycle)
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  // Portfolio Scope: 'owned' | 'all'
  const [portfolioScope, setPortfolioScope] = useState<'owned' | 'all'>('owned');

  // Modals
  const [selectedItem, setSelectedItem] = useState<MonthlyRentReconciliationView | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [isAddLeaseModalOpen, setIsAddLeaseModalOpen] = useState<boolean>(false);
  const [isRentIncreaseModalOpen, setIsRentIncreaseModalOpen] = useState<boolean>(false);

  const monthLabel = useMemo(() => {
    return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [currentDate]);

  const changeMonth = (delta: number) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + delta);
      return d;
    });
  };

  const resetCurrentMonth = () => {
    setCurrentDate(new Date());
  };

  const loadOperations = useCallback(async () => {
    setLoading(true);
    try {
      // Determine if we're viewing the current billing period or a historical one
      const now = new Date();
      const isCurrentMonth =
        currentDate.getFullYear() === now.getFullYear() &&
        currentDate.getMonth() === now.getMonth();

      // The target period in YYYY-MM-01 format
      const targetPeriod = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-01`;

      const [resEntities, resDeals, resLeases] = await Promise.allSettled([
        supabase.from('entities').select('*').order('name', { ascending: true }),
        supabase.from('deals').select('*').order('created_at', { ascending: false }),
        supabase.from('leases').select('*').order('created_at', { ascending: false }),
      ]);

      let loadedEntities: EntityRow[] =
        ((resEntities.status === 'fulfilled' && resEntities.value.data) || []) as EntityRow[];
      let loadedDeals: any[] =
        ((resDeals.status === 'fulfilled' && resDeals.value.data) || []);
      let loadedLeases: any[] =
        ((resLeases.status === 'fulfilled' && resLeases.value.data) || []);

      let loadedRecon: MonthlyRentReconciliationView[] = [];

      if (isCurrentMonth) {
        // Current month: use the live view which computes payment_status against CURRENT_DATE
        const resRecon = await supabase.from('view_monthly_rent_reconciliation').select('*');
        loadedRecon = (resRecon.data || []) as MonthlyRentReconciliationView[];
      } else {
        // Historical month: reconstruct payment status from rent_payments + leases directly
        const { data: payments } = await supabase
          .from('rent_payments')
          .select('*')
          .eq('period_month', targetPeriod);

        const paymentsByLease = new Map<string, any>();
        (payments || []).forEach((p: any) => paymentsByLease.set(p.lease_id, p));

        loadedRecon = loadedLeases
          .filter((l: any) => l.is_active !== false)
          .map((l: any) => {
            const payment = paymentsByLease.get(l.id);
            const contractualRent = parseFloat(l.monthly_rent) || 0;
            const amountPaid = payment ? parseFloat(payment.amount_paid) || 0 : 0;
            let paymentStatus = 'missed';
            if (payment?.status === 'paid' || (amountPaid > 0 && amountPaid >= contractualRent)) {
              paymentStatus = 'paid';
            } else if (payment?.status === 'partial' || amountPaid > 0) {
              paymentStatus = 'partial';
            } else if (payment?.status === 'snoozed') {
              paymentStatus = 'snoozed';
            }
            return {
              lease_id: l.id,
              deal_id: l.deal_id,
              tenant_name: l.tenant_name,
              unit_number: l.unit_number,
              contractual_rent: contractualRent,
              payment_status: paymentStatus,
              amount_paid: amountPaid,
              amount_due: contractualRent,
              paid_date: payment?.paid_date || null,
              payment_method: payment?.payment_method || null,
              reference_note: payment?.reference_note || null,
              payment_id: payment?.id || null,
              snooze_until: payment?.snooze_until || null,
              current_period: targetPeriod,
              is_active: l.is_active,
            } as unknown as MonthlyRentReconciliationView;
          });
      }

      if (loadedEntities.length === 0) {
        loadedEntities = [
          {
            id: 'b1a42178-a979-4234-b018-eabaf8b7c481',
            name: 'Summit Crest Holdings LLC',
            formation_state: 'WA',
            ein: '84-1928374',
            bank_name: 'Chase Commercial (*4892)',
            notes: 'Primary title holding vehicle for Stop and Go Burger assets',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            user_id: 'benchmark-user',
            formation_date: '2023-04-15',
          },
        ];
      }

      setEntities(loadedEntities);
      setReconciliationItems(loadedRecon);
      setDeals(loadedDeals);
      setRawLeases(loadedLeases);
    } catch (err) {
      console.error('Operations load error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  // Filtered deals according to Scope
  const scopedDeals = useMemo(() => {
    if (portfolioScope === 'owned') {
      return deals.filter((d) => d.status === 'owned');
    }
    return deals;
  }, [deals, portfolioScope]);

  // Filtered reconciliation items according to Scope
  const scopedReconciliation = useMemo(() => {
    if (portfolioScope === 'owned') {
      const ownedIds = new Set(deals.filter((d) => d.status === 'owned').map((d) => d.id));
      return reconciliationItems.filter((item) => item.deal_id && ownedIds.has(item.deal_id));
    }
    return reconciliationItems;
  }, [reconciliationItems, deals, portfolioScope]);

  // 4 High-Impact Institutional KPI Tiles (Matching operations.html)
  const kpis = useMemo(() => {
    const totalMonthlyRent = scopedReconciliation.reduce(
      (sum, item) => sum + Number(item.contractual_rent || 0),
      0
    );
    const annualRunRate = totalMonthlyRent * 12;

    const totalUnits = Math.max(scopedReconciliation.length, 1);
    const occupiedUnits = scopedReconciliation.filter((item) => item.is_active !== false).length;
    const occupancyRate = Math.round((occupiedUnits / totalUnits) * 100);

    const paidCount = scopedReconciliation.filter((item) => (item.payment_status || '').toLowerCase() === 'paid').length;
    const pendingCount = scopedReconciliation.length - paidCount;
    const collectedPct = scopedReconciliation.length > 0 ? Math.round((paidCount / scopedReconciliation.length) * 100) : 100;

    // Upcoming escalations check
    const now = new Date();
    const sixtyDaysLater = new Date();
    sixtyDaysLater.setDate(now.getDate() + 60);

    const upcomingEscalations = rawLeases.filter((l) => {
      if (!l.next_escalation_date) return false;
      const d = new Date(l.next_escalation_date);
      return d >= now && d <= sixtyDaysLater;
    });

    return {
      monthlyRent: totalMonthlyRent,
      annualRunRate,
      occupancyRate,
      occupiedUnits,
      totalUnits,
      collectedPct,
      paidCount,
      pendingCount,
      upcomingEscalationsCount: upcomingEscalations.length,
    };
  }, [scopedReconciliation, rawLeases]);

  // Underwriting vs Actuals Performance Tracking Data
  const performanceRows = useMemo(() => {
    return scopedDeals.map((deal) => {
      const activeLeases = rawLeases.filter(
        (l) => String(l.deal_id) === String(deal.id) && l.is_active !== false
      );
      const actualMonthlyRent = activeLeases.reduce(
        (sum, l) => sum + (parseFloat(l.monthly_rent) || 0),
        0
      );

      const inputs = deal.inputs || {};
      const projAnnual = parseFloat(inputs.grossRentAnnual) || 0;
      const projMonthly = projAnnual > 0
        ? projAnnual / 12
        : (parseFloat(inputs.grossRentPerMonth) || parseFloat(inputs.monthlyRent) || 0);

      const varianceUsd = actualMonthlyRent - projMonthly;
      const variancePct = projMonthly > 0 ? (varianceUsd / projMonthly) * 100 : 0;
      const absVariancePct = Math.abs(variancePct);
      const accuracyScore = Math.max(0, Math.min(100, Math.round(100 - absVariancePct)));

      return {
        deal,
        projMonthly,
        actualMonthlyRent,
        varianceUsd,
        variancePct,
        accuracyScore,
      };
    });
  }, [scopedDeals, rawLeases]);

  const handleOpenPaymentModal = (item: MonthlyRentReconciliationView) => {
    setSelectedItem(item);
    setIsPaymentModalOpen(true);
  };

  const handleOpenRentIncreaseModal = (item: MonthlyRentReconciliationView) => {
    setSelectedItem(item);
    setIsRentIncreaseModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Header */}
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              to="/"
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-emerald-400 transition"
              title="Return to Portfolio Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-base font-black text-white tracking-tight">
                Operations &amp; Commercial Rent Roll
              </h1>
              <p className="text-[11px] text-slate-400">
                Authoritative Monthly Rent Reconciliation &amp; Holding Entities
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={loadOperations}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
              title="Refresh Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <Link
              to="/"
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition"
            >
              Portfolio
            </Link>
            <Link
              to="/project"
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs transition shadow-sm"
            >
              Deal Studio
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Historical / Future Period Banner */}
        {(() => {
          const now = new Date();
          const isPast =
            currentDate.getFullYear() < now.getFullYear() ||
            (currentDate.getFullYear() === now.getFullYear() && currentDate.getMonth() < now.getMonth());
          const isFuture =
            currentDate.getFullYear() > now.getFullYear() ||
            (currentDate.getFullYear() === now.getFullYear() && currentDate.getMonth() > now.getMonth());
          if (isPast) {
            return (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold">
                <span>🗂</span>
                <span>
                  Viewing <span className="font-black">{monthLabel}</span> — Historical Payment Audit.
                  Paid status reflects actual receipts recorded for this period.
                </span>
                <button
                  onClick={resetCurrentMonth}
                  className="ml-auto shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-bold transition text-[11px]"
                >
                  Back to Live View
                </button>
              </div>
            );
          }
          if (isFuture) {
            return (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-semibold">
                <span>📅</span>
                <span>
                  Viewing <span className="font-black">{monthLabel}</span> — Future period.
                  No payments exist yet; showing expected rent obligations.
                </span>
                <button
                  onClick={resetCurrentMonth}
                  className="ml-auto shrink-0 px-2.5 py-1 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 font-bold transition text-[11px]"
                >
                  Back to Live View
                </button>
              </div>
            );
          }
          return null;
        })()}

        {/* Controls Bar: Scope Selector & Billing Month Navigation */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Portfolio Scope */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Portfolio Scope
            </label>
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => setPortfolioScope('owned')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                  portfolioScope === 'owned'
                    ? 'bg-emerald-600 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Owned Assets
              </button>
              <button
                type="button"
                onClick={() => setPortfolioScope('all')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                  portfolioScope === 'all'
                    ? 'bg-emerald-600 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Deals (Inc. Pipeline)
              </button>
            </div>
          </div>

          {/* Month Navigation (Billing Cycle) */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => changeMonth(-1)}
              className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-950 border border-slate-800 hover:border-slate-700 transition"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center px-3">
              <span className="block text-xs sm:text-sm font-extrabold text-white font-mono">
                {monthLabel}
              </span>
              <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
                Billing Cycle
              </span>
            </div>
            <button
              onClick={() => changeMonth(1)}
              className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-950 border border-slate-800 hover:border-slate-700 transition"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={resetCurrentMonth}
              className="text-[11px] text-slate-400 hover:text-white px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 transition font-semibold"
            >
              Today
            </button>
          </div>
        </div>

        {/* 4 High-Impact Institutional KPI Tiles (Matching operations.html) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* 1. Portfolio Monthly Rent */}
          <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-sm hover:border-emerald-700/50 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">Portfolio Monthly Rent</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50"></span>
            </div>
            <span className="text-xl sm:text-2xl font-black text-white mt-1.5 block font-mono">
              ${Math.round(kpis.monthlyRent).toLocaleString()}
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-800/80">
              <span>Run-Rate:</span>
              <span className="text-emerald-400 font-bold font-mono">
                ${Math.round(kpis.annualRunRate).toLocaleString()} / yr
              </span>
            </div>
          </div>

          {/* 2. Physical Occupancy % */}
          <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-sm hover:border-blue-700/50 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">Physical Occupancy</span>
              <span className="w-2 h-2 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50"></span>
            </div>
            <span className="text-xl sm:text-2xl font-black text-white mt-1.5 block font-mono">
              {kpis.occupancyRate}%
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-800/80">
              <span>Units Leased:</span>
              <span className="text-blue-400 font-bold font-mono">
                {kpis.occupiedUnits} / {kpis.totalUnits}
              </span>
            </div>
          </div>

          {/* 3. 30-Day Collections */}
          <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-sm hover:border-emerald-700/50 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">30-Day Collections</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50"></span>
            </div>
            <span className="text-xl sm:text-2xl font-black text-emerald-400 mt-1.5 block font-mono">
              {kpis.collectedPct}%
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-800/80">
              <span>Status:</span>
              <span className="text-slate-300 font-medium text-[10px]">
                {kpis.paidCount} Paid • {kpis.pendingCount} Pending
              </span>
            </div>
          </div>

          {/* 4. Upcoming Escalations */}
          <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-sm hover:border-amber-700/50 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">Upcoming Escalations</span>
              <span className={`w-2 h-2 rounded-full ${kpis.upcomingEscalationsCount > 0 ? 'bg-amber-400' : 'bg-slate-600'}`}></span>
            </div>
            <span className="text-xl sm:text-2xl font-black text-white mt-1.5 block font-mono">
              {kpis.upcomingEscalationsCount} Leases
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-800/80">
              <span>Next Scheduled:</span>
              <span className="text-slate-400 text-[10px] truncate max-w-[140px]">
                {kpis.upcomingEscalationsCount > 0 ? 'Review Due Soon' : 'All Up-to-Date'}
              </span>
            </div>
          </div>
        </div>

        {/* Section: Underwriting vs. Actuals Performance Tracking (Matching operations.html) */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center space-x-2">
                <span>⚖️ Underwriting vs. Actuals (Performance &amp; Model Accuracy)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Compare realized operational rent rolls against initial underwritten pro-forma baselines.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 bg-slate-950/50">
                  <th className="py-3 px-4">Property Asset</th>
                  <th className="py-3 px-4 text-right">Pro-Forma Rent (Proj)</th>
                  <th className="py-3 px-4 text-right">In-Place Rent (Actual)</th>
                  <th className="py-3 px-4 text-right">Monthly Variance ($)</th>
                  <th className="py-3 px-4 text-right">Variance (%)</th>
                  <th className="py-3 px-4 text-center">Forecast Accuracy</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {performanceRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500 font-semibold font-sans">
                      No property models loaded in this scope.
                    </td>
                  </tr>
                ) : (
                  performanceRows.map((r) => (
                    <tr key={r.deal.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-sans">
                        <div className="font-bold text-white">{r.deal.title}</div>
                        <div className="text-[11px] text-slate-400">{r.deal.location || 'Commercial'}</div>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        ${Math.round(r.projMonthly).toLocaleString()}/mo
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-400">
                        ${Math.round(r.actualMonthlyRent).toLocaleString()}/mo
                      </td>
                      <td className="py-3 px-4 text-right font-bold">
                        <span className={r.varianceUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {r.varianceUsd >= 0 ? '+' : ''}${Math.round(r.varianceUsd).toLocaleString()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold">
                        <span className={r.variancePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {r.variancePct >= 0 ? '+' : ''}{r.variancePct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            r.accuracyScore >= 95
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : r.accuracyScore >= 80
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          }`}
                        >
                          {r.accuracyScore}% Accuracy
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-sans">
                        <Link
                          to={`/project?id=${r.deal.id}`}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold transition inline-flex items-center space-x-1"
                        >
                          <span>Studio</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 1: Master Rent Roll & Lease Ledger */}
        <section>
          <MasterRentRoll
            items={scopedReconciliation}
            leases={rawLeases}
            isLoading={loading}
            onLogPayment={handleOpenPaymentModal}
            onRentIncrease={handleOpenRentIncreaseModal}
            onAddLease={() => setIsAddLeaseModalOpen(true)}
          />
        </section>

        {/* Section 2: Holding Entities & Ownership Architecture */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Holding Entities &amp; SPV Registrations ({entities.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-400">
              Tax ID &amp; Commercial Banking Segregation
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {entities.map((entity) => (
              <div
                key={entity.id}
                className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white truncate">{entity.name}</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold uppercase">
                    {entity.formation_state || 'WA'} SPV
                  </span>
                </div>

                <div className="text-[11px] text-slate-400 space-y-1 font-mono">
                  <div>
                    <span className="text-slate-500 font-sans">EIN: </span>
                    <span className="text-slate-300 font-semibold">{entity.ein || 'Pending'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans">Operating Acct: </span>
                    <span className="text-slate-300 font-semibold">{entity.bank_name || 'Standard Checking'}</span>
                  </div>
                  {entity.formation_date && (
                    <div>
                      <span className="text-slate-500 font-sans">Formed: </span>
                      <span className="text-slate-400">{entity.formation_date}</span>
                    </div>
                  )}
                </div>

                {entity.notes && (
                  <p className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-900">
                    {entity.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Modal for Logging / Updating Rent Payments */}
      <LogPaymentModal
        isOpen={isPaymentModalOpen}
        item={selectedItem}
        onClose={() => setIsPaymentModalOpen(false)}
        onSuccess={loadOperations}
      />

      {/* Modal for Creating New Property Lease */}
      <AddLeaseModal
        isOpen={isAddLeaseModalOpen}
        deals={deals}
        onClose={() => setIsAddLeaseModalOpen(false)}
        onSuccess={loadOperations}
      />

      {/* Modal for Recording Contractual Rent Escalation */}
      <RentIncreaseModal
        isOpen={isRentIncreaseModalOpen}
        item={selectedItem}
        onClose={() => setIsRentIncreaseModalOpen(false)}
        onSuccess={loadOperations}
      />
    </div>
  );
};
