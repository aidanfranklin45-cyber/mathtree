import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase, BENCHMARK_DEAL } from '../lib/supabase/client';
import { mapSupabaseDeal } from '../stores/useDealStore';
import { DealRecord } from '../lib/math/types';
import { resolvePointInTimeDealMetrics } from '../lib/math/pointInTime';
import { exportPortfolioBriefPDF } from '../lib/export/pdfBrief';
import { DealCard } from '../components/dashboard/DealCard';
import { ProjectWizardModal } from '../components/dashboard/ProjectWizardModal';
import { EditDealModal, DeleteConfirmModal } from '../components/dashboard/DealActionsModal';
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

  // Modals state
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<DealRecord | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<DealRecord | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const user = sessionRes.data?.session?.user;

      // 1. Fetch Entities
      const { data: entData } = await supabase.from('entities').select('id, name');
      if (entData && entData.length > 0) {
        setEntities(entData as LegalEntity[]);
      }

      // 2. Fetch Deals
      let list: DealRecord[] = [];
      if (user) {
        const { data, error } = await supabase
          .from('deals')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
          list = data.map(mapSupabaseDeal);
        }
      }

      // If user has no personal deals, check for shared deals or demo benchmark
      if (list.length === 0) {
        const { data, error } = await supabase
          .from('deals')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
          list = data.map(mapSupabaseDeal);
        } else {
          list = [mapSupabaseDeal(BENCHMARK_DEAL)];
        }
      }

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

  const handleToggleStatus = async (deal: DealRecord) => {
    const nextStatus = deal.status === 'owned' ? 'prospect' : 'owned';
    try {
      await supabase
        .from('deals')
        .update({ status: nextStatus })
        .eq('id', deal.id);

      setDeals((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, status: nextStatus } : d)),
      );
    } catch (err) {
      console.error('Failed to toggle deal status:', err);
    }
  };

  const handleSaveEdit = async (updated: { id: string; title: string; location: string }) => {
    try {
      await supabase
        .from('deals')
        .update({ title: updated.title, location: updated.location })
        .eq('id', updated.id);

      setDeals((prev) =>
        prev.map((d) =>
          d.id === updated.id ? { ...d, title: updated.title, location: updated.location } : d,
        ),
      );
    } catch (err) {
      console.error('Failed to save deal edits:', err);
    }
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

    // Sorting
    if (sortBy === 'price-desc') {
      result.sort((a, b) => (Number(b.purchase_price) || 0) - (Number(a.purchase_price) || 0));
    } else if (sortBy === 'price-asc') {
      result.sort((a, b) => (Number(a.purchase_price) || 0) - (Number(b.purchase_price) || 0));
    } else if (sortBy === 'irr-desc') {
      result.sort((a, b) => (Number(b.irr) || 0) - (Number(a.irr) || 0));
    } else if (sortBy === 'coc-desc') {
      result.sort((a, b) => (Number(b.cash_on_cash) || 0) - (Number(a.cash_on_cash) || 0));
    } else {
      result.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }

    return result;
  }, [baseForCounts, statusFilter, assetFilter, sortBy]);

  // 4 Executive KPI Tiles (Matching dashboard.html)
  const portfolioKPIs = useMemo(() => {
    const today = new Date();

    // 1. Owned Portfolio Metrics
    const ownedDeals = deals.filter((d) => d.status === 'owned');
    let ownedVal = 0;
    let ownedDebt = 0;
    let ownedEquity = 0;
    let ownedCashflow = 0;
    let weightedCocSum = 0;

    ownedDeals.forEach((d) => {
      const pit = resolvePointInTimeDealMetrics(d, today);
      ownedVal += pit.currentVal;
      ownedDebt += pit.currentDebt;
      ownedEquity += pit.currentEquity;
      ownedCashflow += pit.currentCashFlow;
      if (pit.currentEquity > 0) {
        weightedCocSum += (pit.currentCashFlow / pit.currentEquity) * pit.currentEquity;
      }
    });

    const ownedLtv = ownedVal > 0 ? (ownedDebt / ownedVal) * 100 : 0;
    const avgCoc = ownedEquity > 0 ? (weightedCocSum / ownedEquity) * 100 : 0;

    // 2. Pipeline Metrics
    const pipelineDeals = deals.filter((d) => d.status !== 'owned');
    let pipelineVal = 0;
    let sumIrr = 0;
    let countIrr = 0;

    pipelineDeals.forEach((d) => {
      const price = Number(d.purchase_price) || Number(d.inputs?.purchasePrice || 0);
      pipelineVal += price;
      const irr = Number(d.irr) || Number(d.metrics?.irr || 0);
      if (irr > 0) {
        sumIrr += irr;
        countIrr++;
      }
    });

    const blendedIrr = countIrr > 0 ? sumIrr / countIrr : 0;

    return {
      ownedVal: Math.round(ownedVal),
      ownedDebt: Math.round(ownedDebt),
      ownedEquity: Math.round(ownedEquity),
      ownedCashflow: Math.round(ownedCashflow),
      ownedLtv: Math.round(ownedLtv * 10) / 10,
      avgCoc: Math.round(avgCoc * 10) / 10,
      pipelineVal: Math.round(pipelineVal),
      pipelineCount: pipelineDeals.length,
      blendedIrr: Math.round(blendedIrr * 10) / 10,
    };
  }, [deals]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-900 bg-slate-950/90 backdrop-blur-md sticky top-0 z-30 px-3 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center font-black text-slate-950 shadow-md">
              🌿
            </div>
            <div>
              <h1 className="text-base font-black text-white tracking-tight">MathTree Command Center</h1>
              <p className="text-[11px] text-slate-400">Institutional Portfolio & Pipeline Underwriting</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Link
              to="/operations"
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-300 transition hidden sm:inline-flex"
            >
              Property Management
            </Link>
            <button
              onClick={() => exportPortfolioBriefPDF()}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold text-xs flex items-center space-x-1.5 transition shadow-sm border border-slate-800"
              title="Export Portfolio PDF Memorandum"
            >
              <FileDown className="w-3.5 h-3.5 text-rose-400" />
              <span>Export Portfolio</span>
            </button>
            <button
              onClick={() => setIsWizardOpen(true)}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center space-x-1.5 transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Project</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-6">
        {/* Greeting Hero Banner */}
        <div className="bg-gradient-to-r from-slate-900/80 via-slate-900/40 to-emerald-950/20 border border-slate-900 p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Institutional Portfolio Engine • Yakima Basin & Inland Northwest</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Executive Real Estate Portfolio
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
              Defensible commercial underwriting, continuous debt schedules, and in-place lease synchronization.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsWizardOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black transition flex items-center space-x-1.5 shadow-lg shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" />
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
            <span className="text-lg sm:text-2xl font-black text-emerald-400 mt-1 sm:mt-2 block font-mono">
              ${portfolioKPIs.ownedVal.toLocaleString()}
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1.5 border-t border-slate-900">
              <span>Net Equity: <strong className="text-slate-200 font-bold font-mono">${portfolioKPIs.ownedEquity.toLocaleString()}</strong></span>
              <span className="text-slate-500 font-mono text-[10px]">{portfolioKPIs.ownedLtv}% LTV</span>
            </div>
          </div>

          {/* Tile 2: Owned Annual Cash Flow */}
          <div className="bg-slate-900/50 border border-slate-900 hover:border-emerald-900/40 p-3.5 sm:p-5 rounded-2xl transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider">Owned Annual Cash Flow</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-white mt-1 sm:mt-2 block font-mono">
              ${portfolioKPIs.ownedCashflow.toLocaleString()}/yr
            </span>
            <span className="text-[11px] text-emerald-400 mt-0.5 block truncate font-mono">
              {portfolioKPIs.avgCoc}% Avg Cash-on-Cash
            </span>
          </div>

          {/* Tile 3: Active Pipeline Volume */}
          <div className="bg-slate-900/50 border border-slate-900 hover:border-cyan-900/40 p-3.5 sm:p-5 rounded-2xl transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider">Pipeline Volume</span>
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-cyan-400 mt-1 sm:mt-2 block font-mono">
              ${portfolioKPIs.pipelineVal.toLocaleString()}
            </span>
            <span className="text-[11px] text-slate-400 mt-0.5 block truncate">
              {portfolioKPIs.pipelineCount} prospective {portfolioKPIs.pipelineCount === 1 ? 'deal' : 'deals'}
            </span>
          </div>

          {/* Tile 4: Pipeline Target IRR */}
          <div className="bg-slate-900/50 border border-slate-900 hover:border-cyan-900/40 p-3.5 sm:p-5 rounded-2xl transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider">Pipeline Target IRR</span>
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-white mt-1 sm:mt-2 block font-mono">
              {portfolioKPIs.blendedIrr > 0 ? `${portfolioKPIs.blendedIrr}%` : 'N/A'}
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
                        ? 'bg-emerald-600 text-slate-950 font-black'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span>Owned Portfolio</span>
                    </div>
                    <span className="text-[11px] opacity-90 font-mono">{counts.owned}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStatusFilter('prospect')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      statusFilter === 'prospect'
                        ? 'bg-emerald-600 text-slate-950 font-black'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                      <span>Pipeline / Prospects</span>
                    </div>
                    <span className="text-[11px] font-mono">{counts.prospect}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      statusFilter === 'all'
                        ? 'bg-emerald-600 text-slate-950 font-black'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-white"></span>
                      <span>All Deals</span>
                    </div>
                    <span className="text-[11px] font-mono">{counts.all}</span>
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
                        ? 'bg-slate-800 text-white font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <span>All Property Types</span>
                    <span className="text-[11px] opacity-90 font-mono">{counts.all}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('commercial')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      assetFilter === 'commercial'
                        ? 'bg-slate-800 text-white font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>🏬</span>
                      <span className="truncate">Commercial / Retail</span>
                    </div>
                    <span className="text-[11px] font-mono">{counts.commercial}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('multi-unit')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      assetFilter === 'multi-unit'
                        ? 'bg-slate-800 text-white font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>🏢</span>
                      <span className="truncate">Multi-Unit / Apartments</span>
                    </div>
                    <span className="text-[11px] font-mono">{counts.multi}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('single-family')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      assetFilter === 'single-family'
                        ? 'bg-slate-800 text-white font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>🏡</span>
                      <span className="truncate">Single Family (SFR)</span>
                    </div>
                    <span className="text-[11px] font-mono">{counts.sfr}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAssetFilter('storage')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                      assetFilter === 'storage'
                        ? 'bg-slate-800 text-white font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>📦</span>
                      <span className="truncate">Self-Storage</span>
                    </div>
                    <span className="text-[11px] font-mono">{counts.storage}</span>
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
                    onEdit={(d) => setEditingDeal(d)}
                    onDelete={(d) => setDeletingDeal(d)}
                    onToggleStatus={handleToggleStatus}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Creation Wizard Modal */}
      <ProjectWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onProjectCreated={(newProject) => {
          setDeals((prev) => [newProject, ...prev]);
        }}
      />

      {/* Edit Deal Modal */}
      <EditDealModal
        isOpen={!!editingDeal}
        deal={editingDeal}
        onClose={() => setEditingDeal(null)}
        onSave={handleSaveEdit}
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
