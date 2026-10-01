import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { DealRecord } from '../lib/math/types';
import { tryComputeDealMetrics } from '../lib/engine/compute';
import { openPortfolioBrief } from '../lib/export/pdfBrief';
import { computePortfolioKpis } from '../lib/portfolio/kpis';
import { loadPortfolioDeals } from '../lib/portfolio/loadDeals';
import { DealCard } from '../components/dashboard/DealCard';
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
  FileDown,
  Search,
  Filter,
  X,
  RefreshCw,
  Landmark,
  TrendingUp,
  Layers,
  ChevronDown,
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
      if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const user = parsed?.user;
          const metaName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.user_metadata?.first_name;
          if (metaName) {
            const first = metaName.trim().split(/\s+/)[0];
            if (first) return first;
          }
        }
      }
    }
  } catch { /* ignore */ }
  return 'Investor';
};

export const DashboardPage: React.FC = () => {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter States (Matching dashboard.html Amazon Shopping-Style Refine Sidebar)
  const [statusFilter, setStatusFilter] = useState<'owned' | 'prospect' | 'all'>('owned');
  const [assetFilter, setAssetFilter] = useState<'all' | 'single-family' | 'multi-unit' | 'commercial' | 'storage'>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [sharedOnly, setSharedOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'newest' | 'price-desc' | 'price-asc' | 'irr-desc' | 'coc-desc'>('newest');
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [sharingDeal, setSharingDeal] = useState<DealRecord | null>(null);
  const [greetingName, setGreetingName] = useState<string>(resolveInitialGreeting);

  // Modals state
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isSampleData, setIsSampleData] = useState(false);
  const [entitiesOpen, setEntitiesOpen] = useState(false);
  const isDemoSandbox = (() => { try { return !!localStorage.getItem('mathtree_demo_mode'); } catch { return false; } })();
  const exitDemoMode = () => {
    window.MathTreeSession.clearSessionStorage();
    try {
      localStorage.removeItem('mathtree_entities_cache');
      localStorage.removeItem('mathtree_selected_entity_id');
    } catch { /* ignore */ }
    window.location.replace(window.MathTreeSession.getLoginUrl());
  };
  const [editingDeal, setEditingDeal] = useState<DealRecord | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<DealRecord | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // Entities and deals load in parallel; the deal set itself comes from the shared loader (also used by the portfolio brief)
      const [entRes, loaded] = await Promise.all([
        supabase.from('entities').select('id, name'),
        loadPortfolioDeals(),
      ]);

      if (entRes.data && entRes.data.length > 0) {
        setEntities(entRes.data as LegalEntity[]);
      }

      const list = loaded.deals;
      setIsSampleData(loaded.isSample);
      setDeals(list);
    } catch (err) {
      console.error('Failed to load portfolio deals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Greeting uses user session metadata or direct profile table (avoids edge function cold start)
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user || !live) return;

        // 1. Instant check from user metadata / JWT
        const metaName = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.first_name;
        if (metaName) {
          const first = metaName.trim().split(/\s+/)[0];
          if (first && live) {
            setGreetingName(first);
            return;
          }
        }

        // 2. Fast direct Postgres query (bypasses cold edge function)
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

        // 3. Fallback to cached profile
        const p = getProfile(user);
        const first = (p.fullName || '').trim().split(/\s+/)[0];
        if (live && first && first !== 'Investor') setGreetingName(first);
      } catch { /* keep default greeting */ }
    })();
    return () => { live = false; };
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
      await supabase
        .from('deals')
        .update({ status: nextStatus })
        .eq('id', deal.id);

      setDeals((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, status: nextStatus } : d)),
      );
      // Freeze what we expected at acquisition the moment a deal becomes Owned
      if (nextStatus === 'owned') void ensureBaseline({ ...deal, status: 'owned' });
    } catch (err) {
      console.error('Failed to toggle deal status:', err);
    }
  }, []);

  /** Full Edit Project Inputs (same form as the Deal Studio): saves facts only and logs a scenario run. */
  const handleSaveEdit = async (inputsPatch: Record<string, any>, top: DealTopPatch): Promise<boolean> => {
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
    const merged = { ...target, ...top, purchase_price: payload.purchase_price, inputs } as DealRecord;
    setDeals((prev) => prev.map((d) => (d.id === target.id ? merged : d)));
    await recordScenarioRun(merged);
    if (merged.status === 'owned') void ensureBaseline(merged);
    return true;
  };

  const handleConfirmDelete = async (dealId: string) => {
    try {
      await supabase.from('deals').delete().eq('id', dealId);
      setDeals((prev) => prev.filter((d) => d.id !== dealId));
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
      if (entityFilter !== 'all' && d.entity_id !== entityFilter && d.inputs?.entity_id !== entityFilter) {
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
        const tenantMatch = Array.isArray(d.inputs?.leases) &&
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

  // Filtered & Sorted deals for the Grid
  const filteredDeals = useMemo(() => {
    let result = baseForCounts.filter((d) => {
      // Status filter
      if (statusFilter !== 'all' && (d.status || 'prospect') !== statusFilter) {
        return false;
      }
      // Asset filter
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

    // Sorting with precomputed keys (avoids O(N log N) redundant financial projections)
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
      result.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }

    return result;
  }, [baseForCounts, statusFilter, assetFilter, sortBy]);

  // 4 executive KPI tiles: the same function the portfolio brief uses
  const portfolioKPIs = useMemo(() => computePortfolioKpis(deals, new Date()), [deals]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <ConnectedHeader
        active="portfolio"
        deals={deals}
        onProfileSaved={(profile) => {
          const first = (profile.fullName || '').trim().split(/\s+/)[0];
          if (first) setGreetingName(first);
        }}
        onDealsChanged={() => { void loadData(); }}
      />

      {isDemoSandbox ? (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-300 flex items-center justify-between z-40">
          <div className="flex items-center space-x-2">
            <span className="text-sm">🧪</span>
            <span><strong>Interactive Demo Sandbox Active</strong> — You are viewing simulated institutional portfolio data. All underwriting adjustments persist in your browser session.</span>
          </div>
          <button onClick={exitDemoMode} className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[11px] font-bold transition">Exit Demo Mode</button>
        </div>
      ) : isSampleData ? (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-300 flex items-center justify-between z-40">
          <div className="flex items-center space-x-2">
            <span className="text-sm">🌱</span>
            <span><strong>Welcome to MathTree</strong> — You don't have any custom properties yet. You are viewing sample prospects backed by real Yakima County Assessor data. Click <strong>"+ New Project"</strong> above to analyze your first property.</span>
          </div>
          <button onClick={() => setIsWizardOpen(true)} className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition">+ New Project</button>
        </div>
      ) : null}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-6">
        {/* Greeting & New Project Hero Banner */}
        <div className="bg-gradient-to-r from-slate-900/80 via-slate-900/40 to-emerald-950/20 border border-slate-900 p-4 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sm:gap-6 backdrop-blur-sm">
          <div className="space-y-1 sm:space-y-1.5">
            <h2 className="text-xl sm:text-3xl font-black text-white tracking-tight">
              Hey, <span className="text-brand-400">{greetingName}</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
              Welcome to your Comprehensive Analysis and Administration Platform for Real Estate.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <button
              onClick={() => openPortfolioBrief()}
              className="px-3.5 sm:px-4 py-2 sm:py-3 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-bold text-slate-300 hover:text-white bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition flex items-center justify-center space-x-2 shadow-lg"
              title="Print Executive Portfolio & Pipeline Brief"
            >
              <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>Export Portfolio</span>
            </button>
            <button
              onClick={() => setIsWizardOpen(true)}
              className="px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-extrabold text-white bg-gradient-to-r from-brand-600 to-emerald-500 hover:from-brand-500 hover:to-emerald-400 shadow-xl shadow-emerald-500/20 hover:shadow-emerald-500/30 transition flex items-center justify-center space-x-2"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
              </svg>
              <span>Create New Project</span>
            </button>
          </div>
        </div>

        {/* 4 Executive KPI Tiles (Matching dashboard.html) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Tile 1: Gross Asset Value */}
          <div className="bg-slate-900/50 border border-slate-900 hover:border-emerald-900/40 p-3.5 sm:p-5 rounded-2xl transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider">Gross Asset Value</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-emerald-400 mt-1 sm:mt-2 block tabular-nums">
              {formatCurrency(portfolioKPIs.ownedVal)}
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-900">
              <span>Net Equity: <strong className="text-slate-200 font-bold">{formatCurrency(portfolioKPIs.ownedEquity)}</strong></span>
              <span className="text-slate-500 font-mono text-[9px] sm:text-[10px]">{portfolioKPIs.ownedLtv}% LTV • Debt: {formatCurrency(portfolioKPIs.ownedDebt)}</span>
            </div>
          </div>

          {/* Tile 2: Owned Annual Cash Flow */}
          <div className="bg-slate-900/50 border border-slate-900 hover:border-emerald-900/40 p-3.5 sm:p-5 rounded-2xl transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider">Owned Annual Cash Flow</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-white mt-1 sm:mt-2 block tabular-nums">
              {formatCurrency(portfolioKPIs.ownedCashflow)}/yr
            </span>
            <span className="text-[10px] sm:text-[11px] text-emerald-400 mt-0.5 block truncate">
              {portfolioKPIs.ownedEquity <= 0 && portfolioKPIs.ownedCashflow > 0
                ? 'N/M (100% Financed)'
                : `${portfolioKPIs.avgCoc.toFixed(1)}% Blended CoC Yield`}
            </span>
          </div>

          {/* Tile 3: Active Pipeline Volume */}
          <div className="bg-slate-900/50 border border-slate-900 hover:border-cyan-900/40 p-3.5 sm:p-5 rounded-2xl transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider">Pipeline Volume</span>
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-cyan-400 mt-1 sm:mt-2 block tabular-nums">
              {formatCurrency(portfolioKPIs.pipelineVal)}
            </span>
            <span className="text-[11px] text-slate-400 mt-0.5 block truncate">
              {portfolioKPIs.pipelineCount} active prospective {portfolioKPIs.pipelineCount === 1 ? 'deal' : 'deals'}
            </span>
          </div>

          {/* Tile 4: Pipeline Target IRR */}
          <div className="bg-slate-900/50 border border-slate-900 hover:border-cyan-900/40 p-3.5 sm:p-5 rounded-2xl transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider">Pipeline Target IRR</span>
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-white mt-1 sm:mt-2 block tabular-nums">
              {portfolioKPIs.blendedIrr.toFixed(1)}%
            </span>
            <span className="text-[11px] text-cyan-400 mt-0.5 block truncate">
              Blended target return
            </span>
          </div>
        </div>

        {/* Main Explorer Section: Amazon-Style Refine Sidebar + Cards Grid */}
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
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold">
                  Active
                </span>
              )}
            </button>
            <span className="text-xs font-semibold text-slate-400">
              {filteredDeals.length} {filteredDeals.length === 1 ? 'deal' : 'deals'}
            </span>
          </div>

          {/* Left Sidebar: Amazon Shopping-Style Refine Panel */}
          <aside className={`w-full lg:w-72 shrink-0 space-y-4 ${isMobileFilterOpen ? 'block' : 'hidden lg:block'}`}>
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 sm:p-5 backdrop-blur-sm space-y-5 shadow-xl">
              {/* Header & Reset Button */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center space-x-2">
                  <Filter className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-200">Refine Deals</h3>
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

              {/* 1. Search Box */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Search Portfolio
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search address, name, city..."
                    className="w-full bg-slate-950/80 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2 pl-8 pr-7 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition"
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

              {/* 2. Portfolio Status (Owned is default resting state) */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Deal Status
                </label>
                <div className="space-y-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('owned')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition text-left shadow-sm ${
                      statusFilter === 'owned'
                        ? 'bg-brand-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span>Owned Portfolio</span>
                    </div>
                    <span className="text-[11px] opacity-90">{counts.owned}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStatusFilter('prospect')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      statusFilter === 'prospect'
                        ? 'bg-brand-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                      <span>Pipeline / Prospects</span>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">{counts.prospect}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      statusFilter === 'all'
                        ? 'bg-brand-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-white"></span>
                      <span>All Deals</span>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">{counts.all}</span>
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
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition text-left ${
                      assetFilter === 'all'
                        ? 'bg-brand-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <span>All Property Types</span>
                    <span className="text-[11px] opacity-90">{counts.all}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('single-family')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      assetFilter === 'single-family'
                        ? 'bg-brand-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>🏡</span>
                      <span className="truncate">Single Family (SFR)</span>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">{counts.sfr}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('multi-unit')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      assetFilter === 'multi-unit'
                        ? 'bg-brand-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>🏢</span>
                      <span className="truncate">Multi-Unit / Apartments</span>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">{counts.multi}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('commercial')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      assetFilter === 'commercial'
                        ? 'bg-brand-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>🏬</span>
                      <span className="truncate">Commercial / Retail</span>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">{counts.commercial}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('storage')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      assetFilter === 'storage'
                        ? 'bg-brand-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>📦</span>
                      <span className="truncate">Self-Storage</span>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">{counts.storage}</span>
                  </button>
                </div>
              </div>

              {/* 4. Holding Entity (LLC) Dropdown */}
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

          {/* Right Column: Results Bar & Deal Cards Grid */}
          <div className="flex-grow w-full min-w-0 space-y-4">
            {/* Results Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/40 border border-slate-900 rounded-2xl px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-300">
                  Showing <span className="text-emerald-400 font-black">{filteredDeals.length}</span> of{' '}
                  <span className="text-slate-400">{deals.length}</span> deals
                </span>

                {/* Active Filter Pills */}
                <div className="flex flex-wrap items-center gap-1.5 sm:ml-2">
                  {statusFilter !== 'owned' && (
                    <button
                      type="button"
                      onClick={() => setStatusFilter('owned')}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[10px] font-semibold border border-slate-700"
                    >
                      <span>Status: {statusFilter === 'all' ? 'All Deals' : 'Pipeline Only'}</span>
                      <X className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                  {assetFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setAssetFilter('all')}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[10px] font-semibold border border-slate-700"
                    >
                      <span>Type: {assetFilter}</span>
                      <X className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                  {entityFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setEntityFilter('all')}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[10px] font-semibold border border-slate-700"
                    >
                      <span>LLC: {entities.find((e) => e.id === entityFilter)?.name || 'Entity'}</span>
                      <X className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                  {sharedOnly && (
                    <button
                      type="button"
                      onClick={() => setSharedOnly(false)}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[10px] font-semibold border border-slate-700"
                    >
                      <span>Shared only</span>
                      <X className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[10px] font-semibold border border-slate-700"
                    >
                      <span>"{searchQuery}"</span>
                      <X className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Sort Selector */}
              <div className="flex items-center space-x-2 shrink-0 self-end sm:self-auto">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-sm"
                >
                  <option value="newest">Newest First</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="irr-desc">Target IRR: High to Low</option>
                  <option value="coc-desc">CoC Yield: High to Low</option>
                </select>
              </div>
            </div>

            {/* Projects Cards Grid */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin mb-3" />
                <p className="text-xs font-bold text-slate-300">Loading portfolio and loan schedules...</p>
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
                    className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-slate-950 text-xs font-black hover:bg-emerald-500 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Project</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                {filteredDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    entities={entities}
                    onEdit={handleEditDeal}
                    onDelete={handleDeleteDeal}
                    onToggleStatus={handleToggleStatus}
                    onShare={deal.is_shared ? undefined : handleShareDeal}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Creation Wizard Modal */}
      <ShareDealModal deal={sharingDeal} onClose={() => setSharingDeal(null)} onChanged={() => { void loadData(); }} />

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

      <EntityManagerModal isOpen={entitiesOpen} onClose={() => setEntitiesOpen(false)} onChanged={() => { void loadData(); }} />

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
