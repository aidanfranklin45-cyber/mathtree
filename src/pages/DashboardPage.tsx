import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { DealRecord } from '../lib/math/types';
import { tryComputeDealMetrics } from '../lib/engine/compute';
import { computePortfolioKpis } from '../lib/portfolio/kpis';
import { loadPortfolioDeals } from '../lib/portfolio/loadDeals';
import { resolvePointInTimeDealMetrics } from '../lib/math/pointInTime';
import { DealCard } from '../components/dashboard/DealCard';
import { DealTableView, SortField } from '../components/dashboard/DealTableView';
import { DealSidePreview } from '../components/dashboard/DealSidePreview';
import { BulkActionsBar } from '../components/dashboard/BulkActionsBar';
import { PortfolioEquityChart } from '../components/dashboard/PortfolioEquityChart';
import { ConnectedHeader } from '../components/layout/ConnectedHeader';
import { ShareDealModal } from '../components/collaboration/ShareDealModal';
import { fetchProfile, getProfile } from '../lib/profile';
import { formatCurrency } from '../lib/format';
import { ProjectWizardModal } from '../components/dashboard/ProjectWizardModal';
import { DeleteConfirmModal } from '../components/dashboard/DealActionsModal';
import { EntityManagerModal } from '../components/layout/EntityManagerModal';
import { EditInputsModal } from '../components/studio/modals/EditInputsModal';
import type { DealTopPatch } from '../stores/useDealStore';
import { recordScenarioRun } from '../lib/scenarios';
import { ensureBaseline } from '../lib/baselines/db';
import {
  Building,
  Plus,
  Search,
  Filter,
  X,
  RefreshCw,
  ChevronDown,
  LayoutGrid,
  List,
} from 'lucide-react';

interface LegalEntity {
  id: string;
  name: string;
  entity_type?: string;
}

/** Synchronously extracts the investor's first name from cached session auth token if present */
const resolveInitialGreeting = (): string => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const user = parsed?.user;
          const metaName =
            user?.user_metadata?.full_name ||
            user?.user_metadata?.name ||
            user?.user_metadata?.first_name;
          if (metaName) {
            const first = metaName.trim().split(/\s+/)[0];
            if (first) return first;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return 'Investor';
};

export const DashboardPage: React.FC = () => {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectedMonthlyMap, setCollectedMonthlyMap] = useState<Map<string, number>>(new Map());

  // View Mode: Cards Grid vs Table View
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    try {
      const stored = localStorage.getItem('mathtree_dashboard_view_mode');
      return stored === 'table' ? 'table' : 'grid';
    } catch {
      return 'grid';
    }
  });

  const handleSetViewMode = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    try {
      localStorage.setItem('mathtree_dashboard_view_mode', mode);
    } catch {
      /* ignore */
    }
  };

  // Table Sort State
  const [tableSortField, setTableSortField] = useState<SortField>('value');
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('desc');

  // Multi-Select State
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set());

  // Side-Panel Preview State
  const [previewDeal, setPreviewDeal] = useState<DealRecord | null>(null);

  // Search input ref for keyboard focus
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter States
  const [statusFilter, setStatusFilter] = useState<'owned' | 'prospect' | 'all'>('owned');
  const [assetFilter, setAssetFilter] = useState<
    'all' | 'single-family' | 'multi-unit' | 'commercial' | 'storage'
  >('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [sharedOnly, setSharedOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<
    'newest' | 'price-desc' | 'price-asc' | 'irr-desc' | 'coc-desc'
  >('newest');
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [sharingDeal, setSharingDeal] = useState<DealRecord | null>(null);
  const [greetingName, setGreetingName] = useState<string>(resolveInitialGreeting);

  // Modals state
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [entitiesOpen, setEntitiesOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<DealRecord | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<DealRecord | null>(null);

  // Keyboard shortcut listener: press "/" or "Cmd+K" / "Ctrl+K" to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' ||
        ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'))
      ) {
        const active = document.activeElement;
        const isInputField =
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.tagName === 'SELECT');
        if (!isInputField) {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;

      const [entRes, loaded] = await Promise.all([
        supabase.from('entities').select('id, name'),
        loadPortfolioDeals(),
      ]);

      if (entRes.data && entRes.data.length > 0) {
        setEntities(entRes.data as LegalEntity[]);
      }

      // Read live data only: exclude demo or unowned rows
      const liveDeals = (loaded.deals || []).filter((d) => {
        if (d.is_demo) return false;
        if (!user) return false;
        return d.user_id === user.id || d.is_shared === true;
      });

      setDeals(liveDeals);

      // Load paid payments for owned deals to distinguish Collected vs Estimated
      const ownedIds = liveDeals.filter((d) => d.status === 'owned').map((d) => d.id);
      if (ownedIds.length > 0) {
        try {
          const { data: payData } = await supabase
            .from('rent_payments')
            .select('deal_id, amount_paid, period_month, status')
            .in('deal_id', ownedIds)
            .eq('status', 'paid');

          if (payData && payData.length > 0) {
            const dealPeriods = new Map<string, { latestPeriod: string; amount: number }>();
            payData.forEach((p: any) => {
              const cur = dealPeriods.get(p.deal_id);
              const amt = Number(p.amount_paid) || 0;
              const period = String(p.period_month || '');
              if (!cur || period > cur.latestPeriod) {
                dealPeriods.set(p.deal_id, { latestPeriod: period, amount: amt });
              } else if (period === cur.latestPeriod) {
                cur.amount += amt;
              }
            });

            const pMap = new Map<string, number>();
            dealPeriods.forEach((val, dId) => {
              if (val.amount > 0) pMap.set(dId, val.amount);
            });
            setCollectedMonthlyMap(pMap);
          }
        } catch (e) {
          console.warn('[dashboard] could not fetch payments:', e);
        }
      }
    } catch (err) {
      console.error('Failed to load portfolio deals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Greeting resolution
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user || !live) return;

        const metaName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.user_metadata?.first_name;
        if (metaName) {
          const first = metaName.trim().split(/\s+/)[0];
          if (first && live) {
            setGreetingName(first);
            return;
          }
        }

        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle();

        if (live && prof?.full_name) {
          const first = prof.full_name.trim().split(/\s+/)[0];
          if (first) {
            setGreetingName(first);
            return;
          }
        }

        const p = getProfile(user);
        const first = (p.fullName || '').trim().split(/\s+/)[0];
        if (live && first && first !== 'Investor') setGreetingName(first);
      } catch {
        /* keep default greeting */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const handleEditDeal = useCallback((deal: DealRecord) => {
    setEditingDeal(deal);
  }, []);

  const handleDeleteDeal = useCallback((deal: DealRecord) => {
    setDeletingDeal(deal);
  }, []);

  const handleShareDeal = useCallback((deal: DealRecord) => {
    setSharingDeal(deal);
  }, []);

  const handleToggleStatus = useCallback(async (deal: DealRecord) => {
    const nextStatus = deal.status === 'owned' ? 'prospect' : 'owned';
    try {
      await supabase.from('deals').update({ status: nextStatus }).eq('id', deal.id);

      setDeals((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, status: nextStatus } : d)),
      );
      if (nextStatus === 'owned') void ensureBaseline({ ...deal, status: 'owned' });
    } catch (err) {
      console.error('Failed to toggle deal status:', err);
    }
  }, []);

  const handleSaveEdit = async (
    inputsPatch: Record<string, any>,
    top: DealTopPatch,
  ): Promise<boolean> => {
    const target = editingDeal;
    if (!target) return false;
    const inputs = { ...target.inputs, ...inputsPatch };
    const payload: Record<string, any> = { inputs, updated_at: new Date().toISOString() };
    if (top.title !== undefined) payload.title = top.title;
    if (top.location !== undefined) payload.location = top.location;
    if (top.status !== undefined) payload.status = top.status;
    if (top.entity_id !== undefined) payload.entity_id = top.entity_id;
    payload.purchase_price = top.purchase_price ?? inputs.purchasePrice;
    const { error } = await supabase.from('deals').update(payload as any).eq('id', target.id);
    if (error) {
      console.error('Failed to save deal edits:', error);
      return false;
    }
    const merged = {
      ...target,
      ...top,
      purchase_price: payload.purchase_price,
      inputs,
    } as DealRecord;
    setDeals((prev) => prev.map((d) => (d.id === target.id ? merged : d)));
    await recordScenarioRun(merged);
    if (merged.status === 'owned') void ensureBaseline(merged);
    return true;
  };

  const handleConfirmDelete = async (dealId: string) => {
    try {
      await supabase.from('deals').delete().eq('id', dealId);
      setDeals((prev) => prev.filter((d) => d.id !== dealId));
      setSelectedDealIds((prev) => {
        const next = new Set(prev);
        next.delete(dealId);
        return next;
      });
      if (previewDeal?.id === dealId) setPreviewDeal(null);
    } catch (err) {
      console.error('Failed to delete deal:', err);
    }
  };

  const resetFilters = () => {
    setStatusFilter('owned');
    setAssetFilter('all');
    setEntityFilter('all');
    setSharedOnly(false);
    setSearchQuery('');
    setSortBy('newest');
  };

  const isAnyFilterActive =
    statusFilter !== 'owned' ||
    assetFilter !== 'all' ||
    entityFilter !== 'all' ||
    sharedOnly ||
    searchQuery !== '' ||
    sortBy !== 'newest';

  // Base list for dynamic counter badges
  const baseForCounts = useMemo(() => {
    return deals.filter((d) => {
      if (
        entityFilter !== 'all' &&
        d.entity_id !== entityFilter &&
        d.inputs?.entity_id !== entityFilter
      ) {
        return false;
      }
      if (sharedOnly && !d.is_shared) {
        return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const titleMatch = d.title.toLowerCase().includes(q);
        const locMatch = (d.location || '').toLowerCase().includes(q);
        const cityMatch = (d.city || '').toLowerCase().includes(q);
        const apnMatch = (d.primary_apn || d.inputs?.apn || '').toLowerCase().includes(q);
        const tenantMatch =
          Array.isArray(d.inputs?.leases) &&
          d.inputs.leases.some((l: any) => (l.tenantName || '').toLowerCase().includes(q));
        if (!titleMatch && !locMatch && !cityMatch && !apnMatch && !tenantMatch) {
          return false;
        }
      }
      return true;
    });
  }, [deals, entityFilter, sharedOnly, searchQuery]);

  // Counts for status & asset class
  const counts = useMemo(() => {
    const owned = baseForCounts.filter((d) => d.status === 'owned').length;
    const prospect = baseForCounts.filter((d) => d.status !== 'owned').length;
    const all = baseForCounts.length;

    const sfr = baseForCounts.filter((d) => {
      const ac = String(d.asset_class || d.assetType || '').toLowerCase();
      return ac === 'single-family' || ac === 'residential';
    }).length;
    const multi = baseForCounts.filter((d) => {
      const ac = String(d.asset_class || d.assetType || '').toLowerCase();
      return ac === 'multi-unit' || ac === 'multi_family';
    }).length;
    const commercial = baseForCounts.filter((d) => {
      const ac = String(d.asset_class || d.assetType || '').toLowerCase();
      return ac === 'commercial';
    }).length;
    const storage = baseForCounts.filter((d) => {
      const ac = String(d.asset_class || d.assetType || '').toLowerCase();
      return ac === 'storage';
    }).length;

    return { owned, prospect, all, sfr, multi, commercial, storage };
  }, [baseForCounts]);

  // Filtered deals
  const filteredDeals = useMemo(() => {
    let result = baseForCounts.filter((d) => {
      if (statusFilter !== 'all' && (d.status || 'prospect') !== statusFilter) {
        return false;
      }
      if (assetFilter !== 'all') {
        const ac = String(d.asset_class || d.assetType || '').toLowerCase();
        if (assetFilter === 'multi-unit') {
          if (ac !== 'multi-unit' && ac !== 'multi_family') return false;
        } else if (assetFilter === 'single-family') {
          if (ac !== 'single-family' && ac !== 'residential') return false;
        } else if (ac !== assetFilter) {
          return false;
        }
      }
      return true;
    });

    // If in table mode, sort by table sort field
    if (viewMode === 'table') {
      result.sort((a, b) => {
        const pitA = resolvePointInTimeDealMetrics(a, new Date());
        const pitB = resolvePointInTimeDealMetrics(b, new Date());
        const engA = tryComputeDealMetrics(a);
        const engB = tryComputeDealMetrics(b);

        let valA = 0;
        let valB = 0;

        switch (tableSortField) {
          case 'title':
            return tableSortDirection === 'asc'
              ? a.title.localeCompare(b.title)
              : b.title.localeCompare(a.title);
          case 'asset_class':
            return tableSortDirection === 'asc'
              ? (a.asset_class || '').localeCompare(b.asset_class || '')
              : (b.asset_class || '').localeCompare(a.asset_class || '');
          case 'status':
            return tableSortDirection === 'asc'
              ? (a.status || '').localeCompare(b.status || '')
              : (b.status || '').localeCompare(a.status || '');
          case 'value':
            valA = pitA.currentVal || 0;
            valB = pitB.currentVal || 0;
            break;
          case 'debt':
            valA = pitA.currentDebt || 0;
            valB = pitB.currentDebt || 0;
            break;
          case 'equity':
            valA = pitA.currentEquity || 0;
            valB = pitB.currentEquity || 0;
            break;
          case 'cashflow':
            valA = collectedMonthlyMap.get(a.id) || (pitA.currentCashFlow ? pitA.currentCashFlow / 12 : 0);
            valB = collectedMonthlyMap.get(b.id) || (pitB.currentCashFlow ? pitB.currentCashFlow / 12 : 0);
            break;
          case 'dscr':
            valA = Number(engA?.dscr) || 0;
            valB = Number(engB?.dscr) || 0;
            break;
          case 'return':
            valA = Number(engA?.irr || pitA.irr || engA?.cashOnCash || 0);
            valB = Number(engB?.irr || pitB.irr || engB?.cashOnCash || 0);
            break;
          default:
            valA = new Date(a.created_at || 0).getTime();
            valB = new Date(b.created_at || 0).getTime();
        }

        return tableSortDirection === 'asc' ? valA - valB : valB - valA;
      });
    } else {
      // Standard grid sorting
      if (sortBy === 'price-desc') {
        result.sort((a, b) => (Number(b.purchase_price) || 0) - (Number(a.purchase_price) || 0));
      } else if (sortBy === 'price-asc') {
        result.sort((a, b) => (Number(a.purchase_price) || 0) - (Number(b.purchase_price) || 0));
      } else if (sortBy === 'irr-desc') {
        const irrMap = new Map<string, number>();
        result.forEach((d) => irrMap.set(d.id, tryComputeDealMetrics(d)?.irr || 0));
        result.sort((a, b) => (irrMap.get(b.id) || 0) - (irrMap.get(a.id) || 0));
      } else if (sortBy === 'coc-desc') {
        const cocMap = new Map<string, number>();
        result.forEach((d) => cocMap.set(d.id, tryComputeDealMetrics(d)?.cashOnCash || 0));
        result.sort((a, b) => (cocMap.get(b.id) || 0) - (cocMap.get(a.id) || 0));
      } else {
        result.sort(
          (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
        );
      }
    }

    return result;
  }, [
    baseForCounts,
    statusFilter,
    assetFilter,
    sortBy,
    viewMode,
    tableSortField,
    tableSortDirection,
    collectedMonthlyMap,
  ]);

  // Executive KPI tiles
  const portfolioKPIs = useMemo(() => computePortfolioKpis(deals, new Date()), [deals]);

  // Contractual monthly principal paydown across owned portfolio
  const monthlyPaydownVelocity = useMemo(() => {
    const owned = deals.filter((d) => d.status === 'owned');
    const today = new Date();
    let annualPaydown = 0;
    owned.forEach((d) => {
      const eng = tryComputeDealMetrics(d);
      const p1 = eng?.projections?.[0];
      const p2 = eng?.projections?.[1];
      if (p1 && p2) {
        const bal1 = Number(p1.endingLoanBalance ?? p1.loanBalanceRemaining) || 0;
        const bal2 = Number(p2.endingLoanBalance ?? p2.loanBalanceRemaining) || 0;
        annualPaydown += Math.max(0, bal1 - bal2);
      } else {
        const pit = resolvePointInTimeDealMetrics(d, today);
        if (pit.baseLoanAmount > 0) annualPaydown += pit.baseLoanAmount * 0.02;
      }
    });
    return Math.round(annualPaydown / 12);
  }, [deals]);

  // Multi-select handlers
  const handleToggleSelect = useCallback((dealId: string) => {
    setSelectedDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedDealIds.size === filteredDeals.length) {
      setSelectedDealIds(new Set());
    } else {
      setSelectedDealIds(new Set(filteredDeals.map((d) => d.id)));
    }
  }, [selectedDealIds.size, filteredDeals]);

  const handleClearSelection = useCallback(() => {
    setSelectedDealIds(new Set());
  }, []);

  const handleBulkMarkOwned = async () => {
    const ids = Array.from(selectedDealIds);
    try {
      await supabase.from('deals').update({ status: 'owned' }).in('id', ids);
      setDeals((prev) =>
        prev.map((d) => (selectedDealIds.has(d.id) ? { ...d, status: 'owned' } : d)),
      );
      setSelectedDealIds(new Set());
    } catch (e) {
      console.error('Bulk mark owned failed:', e);
    }
  };

  const handleBulkMovePipeline = async () => {
    const ids = Array.from(selectedDealIds);
    try {
      await supabase.from('deals').update({ status: 'prospect' }).in('id', ids);
      setDeals((prev) =>
        prev.map((d) => (selectedDealIds.has(d.id) ? { ...d, status: 'prospect' } : d)),
      );
      setSelectedDealIds(new Set());
    } catch (e) {
      console.error('Bulk move pipeline failed:', e);
    }
  };

  const handleBulkExportCsv = () => {
    const targetDeals = deals.filter((d) => selectedDealIds.has(d.id));
    if (targetDeals.length === 0) return;

    const rows = targetDeals.map((d) => {
      const pit = resolvePointInTimeDealMetrics(d, new Date());
      const eng = tryComputeDealMetrics(d);
      const isOwned = d.status === 'owned';
      const colMonthly = collectedMonthlyMap.get(d.id);
      const hasColl = isOwned && colMonthly !== undefined && colMonthly > 0;
      const mCf = hasColl
        ? colMonthly
        : pit.currentCashFlow
        ? pit.currentCashFlow / 12
        : Number(eng?.year1Cashflow)
        ? Number(eng?.year1Cashflow) / 12
        : 0;

      return {
        Title: d.title,
        Location: d.location || d.address || '',
        AssetClass: d.asset_class || d.assetType || '',
        Status: d.status || 'prospect',
        CurrentValue: Math.round(pit.currentVal || 0),
        Debt: Math.round(pit.currentDebt || 0),
        Equity: Math.round(pit.currentEquity || 0),
        MonthlyCashFlow: Math.round(mCf),
        CashFlowBasis: hasColl ? 'Collected' : 'Estimated',
        DSCR: eng?.dscr || '',
        IRR: eng?.irr || '',
        CashOnCash: eng?.cashOnCash || '',
      };
    });

    const headers = Object.keys(rows[0]).join(',');
    const csvContent = [
      headers,
      ...rows.map((r) =>
        Object.values(r)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mathtree_portfolio_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleTableSort = (field: SortField) => {
    if (tableSortField === field) {
      setTableSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortField(field);
      setTableSortDirection('desc');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <ConnectedHeader
        active="portfolio"
        deals={deals}
        onProfileSaved={(profile) => {
          const first = (profile.fullName || '').trim().split(/\s+/)[0];
          if (first) setGreetingName(first);
        }}
        onDealsChanged={() => {
          void loadData();
        }}
      />

      {/* Main Content Area - Full Desktop Width */}
      <main className="flex-1 w-full mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12 py-5 sm:py-6 space-y-5">
        {/* Minimalist Greeting & Action Bar */}
        <div className="flex items-center justify-between pb-1">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">
            Hey, <span className="text-emerald-400">{greetingName}</span>
          </h2>

          <button
            onClick={() => setIsWizardOpen(true)}
            className="px-4 py-2 rounded-xl text-xs font-black text-slate-950 bg-emerald-400 hover:bg-emerald-300 shadow-md shadow-emerald-500/20 transition flex items-center space-x-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Create Project</span>
          </button>
        </div>

        {/* Master Portfolio Overview: Forward Trajectory Chart on Left, Vanguard-Style Metrics on Right */}
        <div className="bg-slate-900/80 border border-slate-800/90 hover:border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-sm relative overflow-hidden transition">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent pointer-events-none" />
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
            {/* Left side: Trajectory Chart (Embedded, non-stretched) */}
            <div className="xl:col-span-7 flex flex-col justify-between min-h-[220px]">
              <PortfolioEquityChart deals={deals} embedded />
            </div>

            {/* Right side: Key Wealth Metrics */}
            <div className="xl:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Double-Wide Hero: Total Net Equity with Integrated Balance Sheet Story */}
              <div className="sm:col-span-2 bg-slate-950/70 border border-slate-800/80 hover:border-slate-700/90 p-4 sm:p-5 rounded-xl transition flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block">
                      Total Net Equity
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      Gross Value: <strong className="text-slate-200 font-bold">{portfolioKPIs.ownedVal > 0 ? formatCurrency(portfolioKPIs.ownedVal) : '—'}</strong>
                    </span>
                  </div>
                  <span className="text-3xl sm:text-4xl 2xl:text-5xl font-black text-emerald-400 mt-2 block tabular-nums font-mono tracking-tight">
                    {portfolioKPIs.ownedEquity > 0 ? formatCurrency(portfolioKPIs.ownedEquity) : '—'}
                  </span>
                </div>

                <div className="text-xs text-slate-400 mt-3 pt-2.5 border-t border-slate-800/70 flex flex-wrap items-center gap-1.5 font-sans">
                  {counts.owned > 0 ? (
                    <>
                      <span className="font-semibold text-slate-200">{portfolioKPIs.ownedLtv}% loan-to-value</span>
                      <span className="text-slate-500">with</span>
                      <strong className="text-slate-200 font-mono font-bold">{formatCurrency(portfolioKPIs.ownedDebt)}</strong>
                      <span className="text-slate-500">in debt across</span>
                      <span className="font-semibold text-slate-200">{counts.owned} {counts.owned === 1 ? 'property' : 'properties'}</span>
                    </>
                  ) : (
                    <span>No owned properties in active portfolio</span>
                  )}
                </div>
              </div>

              {/* Tile 3: Owned Annual Cash Flow */}
              <div className="bg-slate-950/70 border border-slate-800/80 hover:border-slate-700/90 p-4 rounded-xl transition flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Annual Cash Flow</span>
                  <span className={`text-2xl sm:text-3xl font-black mt-1.5 block tabular-nums font-mono tracking-tight ${
                    portfolioKPIs.ownedCashflow < 0 ? 'text-red-400' : portfolioKPIs.ownedCashflow > 0 ? 'text-emerald-400' : 'text-white'
                  }`}>
                    {portfolioKPIs.ownedCashflow !== 0 ? formatCurrency(portfolioKPIs.ownedCashflow) : '—'}<span className="text-slate-400 font-sans text-xs">/yr</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/70">
                  <span className={`text-[11px] font-semibold truncate ${
                    portfolioKPIs.avgCoc < 0 ? 'text-red-400' : portfolioKPIs.avgCoc > 0 ? 'text-emerald-400' : 'text-slate-400'
                  }`}>
                    {portfolioKPIs.ownedEquity <= 0 && portfolioKPIs.ownedCashflow > 0
                      ? '100% Financed'
                      : `${portfolioKPIs.avgCoc.toFixed(1)}% CoC Yield`}
                  </span>
                </div>
              </div>

              {/* Tile 4: Principal Paydown Velocity */}
              <div className="bg-slate-950/70 border border-slate-800/80 hover:border-slate-700/90 p-4 rounded-xl transition flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Paydown Velocity</span>
                  <span className={`text-2xl sm:text-3xl font-black mt-1.5 block tabular-nums font-mono tracking-tight ${
                    monthlyPaydownVelocity > 0 ? 'text-emerald-400' : 'text-white'
                  }`}>
                    {monthlyPaydownVelocity > 0 ? `+${formatCurrency(monthlyPaydownVelocity)}/mo` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/70">
                  <span className="text-[11px] text-slate-400 font-medium">Debt Amortization</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Section: Pinned Refine Sidebar + Results Grid/Table */}
        <div className="flex flex-col lg:flex-row items-start gap-6 pt-1">
          {/* Mobile Refine Drawer Toggle */}
          <div className="lg:hidden w-full flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-2xl px-4 py-3 shadow-md">
            <button
              type="button"
              onClick={() => setIsMobileFilterOpen(!isMobileFilterOpen)}
              className="flex items-center space-x-2 text-xs font-bold text-slate-200 hover:text-white"
            >
              <Filter className="w-4 h-4 text-emerald-400" />
              <span>Refine & Filter Deals</span>
              {isAnyFilterActive && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold">
                  Active
                </span>
              )}
            </button>
            <span className="text-xs font-semibold text-slate-400">
              {filteredDeals.length} {filteredDeals.length === 1 ? 'deal' : 'deals'}
            </span>
          </div>

          {/* Left Sidebar: Pinned on Desktop (sticky top-20) */}
          <aside
            className={`w-full lg:w-72 xl:w-80 shrink-0 space-y-4 lg:sticky lg:top-20 z-20 ${
              isMobileFilterOpen ? 'block' : 'hidden lg:block'
            }`}
          >
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 sm:p-5 backdrop-blur-sm space-y-5 shadow-xl">
              {/* Header & Reset Button */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center space-x-2">
                  <Filter className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
                    Refine Deals
                  </h3>
                </div>
                {isAnyFilterActive && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 transition underline underline-offset-2"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* 1. Search Box with Keyboard Focus Hint */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                    Search Portfolio
                  </label>
                  <kbd className="hidden sm:inline-block text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700 font-mono">
                    /
                  </kbd>
                </div>
                <div className="relative">
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search address, title, tenant..."
                    className="w-full bg-slate-950/80 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 rounded-xl px-3 py-2 pl-8 pr-7 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition font-sans"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* 2. Portfolio Status */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Deal Status
                </label>
                <div className="space-y-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('owned')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      statusFilter === 'owned'
                        ? 'bg-emerald-500/10 text-emerald-300 font-semibold border border-emerald-500/30 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <span>Owned Portfolio</span>
                    <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                      statusFilter === 'owned'
                        ? 'bg-emerald-950/80 border-emerald-800 text-emerald-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}>
                      {counts.owned}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStatusFilter('prospect')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      statusFilter === 'prospect'
                        ? 'bg-blue-500/10 text-blue-300 font-semibold border border-blue-500/30 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <span>Pipeline / Prospects</span>
                    <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                      statusFilter === 'prospect'
                        ? 'bg-blue-950/80 border-blue-800 text-blue-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}>
                      {counts.prospect}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      statusFilter === 'all'
                        ? 'bg-slate-800 text-white font-semibold border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <span>All Deals</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">{counts.all}</span>
                  </button>
                </div>
              </div>

              {/* 3. Property Type Categories */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Property Type
                </label>
                <div className="space-y-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setAssetFilter('all')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      assetFilter === 'all'
                        ? 'bg-slate-800 text-white font-semibold border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <span>All Property Types</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">{counts.all}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('single-family')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      assetFilter === 'single-family'
                        ? 'bg-slate-800 text-white font-semibold border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <span>Single Family (SFR)</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">{counts.sfr}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('multi-unit')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      assetFilter === 'multi-unit'
                        ? 'bg-slate-800 text-white font-semibold border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <span>Multi-Unit / Residential</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">{counts.multi}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('commercial')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      assetFilter === 'commercial'
                        ? 'bg-slate-800 text-white font-semibold border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <span>Commercial / Retail</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">{counts.commercial}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('storage')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                      assetFilter === 'storage'
                        ? 'bg-slate-800 text-white font-semibold border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <span>Self-Storage</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">{counts.storage}</span>
                  </button>
                </div>
              </div>

              {/* 4. Holding Entity Dropdown */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Holding Entity (LLC)
                </label>
                <div className="relative">
                  <select
                    value={entityFilter}
                    onChange={(e) => setEntityFilter(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-emerald-400 focus:outline-none focus:border-emerald-500 pr-8 appearance-none cursor-pointer shadow-sm"
                  >
                    <option value="all">All Entities (Consolidated)</option>
                    {entities.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.name}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute right-2.5 top-2.5 text-slate-400">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>

              {/* 5. Shared with me only */}
              <div className="pt-3 border-t border-slate-800/80">
                <label className="flex items-center space-x-2.5 cursor-pointer py-1 text-xs text-slate-300 hover:text-white select-none">
                  <input
                    type="checkbox"
                    checked={sharedOnly}
                    onChange={(e) => setSharedOnly(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-950 border border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="font-semibold text-slate-200">Shared with me only</span>
                </label>
              </div>
            </div>
          </aside>

          {/* Right Column: Results Bar & Deal Cards / Table */}
          <div className="flex-1 w-full min-w-0 space-y-4">
            {/* Results Bar with View Toggle & Sort */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-300">
                  Showing <span className="text-emerald-400 font-mono font-black">{filteredDeals.length}</span> of{' '}
                  <span className="text-slate-400 font-mono">{deals.length}</span> deals
                </span>

                {/* Active Filter Pills */}
                <div className="flex flex-wrap items-center gap-1.5 sm:ml-2">
                  {statusFilter !== 'owned' && (
                    <button
                      type="button"
                      onClick={() => setStatusFilter('owned')}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-300 hover:text-white text-[10px] font-semibold border border-emerald-500/30"
                    >
                      <span>Status: {statusFilter === 'all' ? 'All' : 'Pipeline'}</span>
                      <X className="w-3 h-3 text-emerald-400" />
                    </button>
                  )}
                  {assetFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setAssetFilter('all')}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-300 hover:text-white text-[10px] font-semibold border border-emerald-500/30"
                    >
                      <span>Type: {assetFilter}</span>
                      <X className="w-3 h-3 text-emerald-400" />
                    </button>
                  )}
                  {entityFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setEntityFilter('all')}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-300 hover:text-white text-[10px] font-semibold border border-emerald-500/30"
                    >
                      <span>LLC: {entities.find((e) => e.id === entityFilter)?.name || 'Entity'}</span>
                      <X className="w-3 h-3 text-emerald-400" />
                    </button>
                  )}
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-300 hover:text-white text-[10px] font-semibold border border-emerald-500/30"
                    >
                      <span>"{searchQuery}"</span>
                      <X className="w-3 h-3 text-emerald-400" />
                    </button>
                  )}
                </div>
              </div>

              {/* View Toggle & Sort Controls */}
              <div className="flex items-center space-x-3 shrink-0 self-end sm:self-auto">
                {/* View Mode Toggle: Grid Cards vs Dense Table */}
                <div className="inline-flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleSetViewMode('grid')}
                    className={`p-1.5 rounded-lg transition ${
                      viewMode === 'grid'
                        ? 'bg-slate-800 text-emerald-400 shadow-sm'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title="Grid Cards View"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetViewMode('table')}
                    className={`p-1.5 rounded-lg transition ${
                      viewMode === 'table'
                        ? 'bg-slate-800 text-emerald-400 shadow-sm'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title="Dense Table View"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Quick Sort Selector (Grid view) */}
                {viewMode === 'grid' && (
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Sort:
                    </span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-sm"
                    >
                      <option value="newest">Newest First</option>
                      <option value="price-desc">Price: High to Low</option>
                      <option value="price-asc">Price: Low to High</option>
                      <option value="irr-desc">Target IRR: High to Low</option>
                      <option value="coc-desc">CoC Yield: High to Low</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Results Area */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin mb-3" />
                <p className="text-xs font-bold text-slate-300">Loading portfolio assets...</p>
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-800 text-slate-400 mx-auto flex items-center justify-center font-bold text-lg">
                  🏢
                </div>
                <h3 className="text-sm font-black text-white">No properties found</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  No assets match your current search or filter criteria. Reset filters or create a new underwriting project.
                </p>
                <div className="flex items-center justify-center gap-2 pt-1">
                  {isAnyFilterActive && (
                    <button
                      onClick={resetFilters}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
                    >
                      Reset All Filters
                    </button>
                  )}
                  <button
                    onClick={() => setIsWizardOpen(true)}
                    className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black hover:bg-emerald-400 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Project</span>
                  </button>
                </div>
              </div>
            ) : viewMode === 'table' ? (
              <DealTableView
                deals={filteredDeals}
                selectedDealIds={selectedDealIds}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                allSelected={
                  filteredDeals.length > 0 && selectedDealIds.size === filteredDeals.length
                }
                onEdit={handleEditDeal}
                onDelete={handleDeleteDeal}
                onToggleStatus={handleToggleStatus}
                onPreview={(deal) => setPreviewDeal(deal)}
                onShare={handleShareDeal}
                entities={entities}
                collectedMonthlyMap={collectedMonthlyMap}
                sortField={tableSortField}
                sortDirection={tableSortDirection}
                onSort={handleTableSort}
                hideStatusColumn={statusFilter === 'owned'}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 sm:gap-5">
                {filteredDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    entities={entities}
                    onEdit={handleEditDeal}
                    onDelete={handleDeleteDeal}
                    onToggleStatus={handleToggleStatus}
                    onShare={deal.is_shared ? undefined : handleShareDeal}
                    onPreview={(d) => setPreviewDeal(d)}
                    isSelected={selectedDealIds.has(deal.id)}
                    onToggleSelect={handleToggleSelect}
                    collectedMonthly={collectedMonthlyMap.get(deal.id)}
                    hideStatusBadge={statusFilter === 'owned'}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Bulk Actions Floating Bar */}
      <BulkActionsBar
        selectedCount={selectedDealIds.size}
        totalFilteredCount={filteredDeals.length}
        onSelectAllFiltered={() => setSelectedDealIds(new Set(filteredDeals.map((d) => d.id)))}
        onClearSelection={handleClearSelection}
        onBulkMarkOwned={handleBulkMarkOwned}
        onBulkMovePipeline={handleBulkMovePipeline}
        onBulkExportCsv={handleBulkExportCsv}
      />

      {/* Side-Panel Deal Inspection Drawer */}
      {previewDeal && (
        <DealSidePreview
          deal={previewDeal}
          onClose={() => setPreviewDeal(null)}
          onEdit={handleEditDeal}
          onToggleStatus={handleToggleStatus}
          collectedMonthly={collectedMonthlyMap.get(previewDeal.id)}
        />
      )}

      {/* Creation Wizard Modal */}
      <ShareDealModal
        deal={sharingDeal}
        onClose={() => setSharingDeal(null)}
        onChanged={() => {
          void loadData();
        }}
      />

      {isWizardOpen && (
        <ProjectWizardModal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onManageEntities={() => setEntitiesOpen(true)}
          onProjectCreated={(newProject) => {
            setDeals((prev) => [newProject, ...prev]);
          }}
        />
      )}

      {/* Edit Deal Modal */}
      {editingDeal && (
        <EditInputsModal
          isOpen
          deal={editingDeal}
          onClose={() => setEditingDeal(null)}
          onSave={handleSaveEdit}
        />
      )}

      <EntityManagerModal
        isOpen={entitiesOpen}
        onClose={() => setEntitiesOpen(false)}
        onChanged={() => {
          void loadData();
        }}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={!!deletingDeal}
        deal={deletingDeal}
        onClose={() => setDeletingDeal(null)}
        onConfirmDelete={handleConfirmDelete}
      />
    </div>
  );
};
