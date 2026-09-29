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
  TrendingUp,
  DollarSign,
  Layers,
  ShieldCheck,
  RefreshCw,
  Landmark,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'owned' | 'prospect'>('owned');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<DealRecord | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<DealRecord | null>(null);

  const loadDeals = async () => {
    setLoading(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const user = sessionRes.data?.session?.user;

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
    loadDeals();
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

  // Filter deals
  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
      const matchesSearch =
        searchQuery === '' ||
        d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.location && d.location.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (d.address && d.address.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesStatus && matchesSearch;
    });
  }, [deals, statusFilter, searchQuery]);

  // Dynamic Month-by-Month Point-in-Time Metrics
  const portfolioKPIs = useMemo(() => {
    const today = new Date();
    let totalVal = 0;
    let totalDebt = 0;
    let totalEquity = 0;
    let totalCashflow = 0;
    let sumIrr = 0;
    let countWithIrr = 0;

    const targetDeals = statusFilter === 'all' ? deals : deals.filter((d) => d.status === statusFilter);

    targetDeals.forEach((d) => {
      const pit = resolvePointInTimeDealMetrics(d, today);
      totalVal += pit.currentVal;
      totalDebt += pit.currentDebt;
      totalEquity += pit.currentEquity;
      totalCashflow += pit.currentCashFlow;
      if (pit.irr > 0) {
        sumIrr += pit.irr;
        countWithIrr++;
      }
    });

    const avgIrr = countWithIrr > 0 ? sumIrr / countWithIrr : 0;
    const ltv = totalVal > 0 ? (totalDebt / totalVal) * 100 : 0;

    return {
      totalVal: Math.round(totalVal),
      totalDebt: Math.round(totalDebt),
      totalEquity: Math.round(totalEquity),
      totalCashflow: Math.round(totalCashflow),
      avgIrr,
      ltv: Math.round(ltv * 10) / 10,
      count: targetDeals.length,
    };
  }, [deals, statusFilter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3">
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
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 font-bold text-xs flex items-center space-x-1.5 transition shadow-sm border border-slate-700/80"
              title="Export Portfolio PDF Memorandum"
            >
              <FileDown className="w-3.5 h-3.5 text-slate-400" />
              <span>PDF Brief</span>
            </button>
            <button
              onClick={() => setIsWizardOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center space-x-1.5 transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Project</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Dynamic Point-in-Time KPI Scorecards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>{statusFilter === 'owned' ? 'Current Portfolio GAV' : 'Total Asset Value'}</span>
              <Building className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-white font-mono">
              ${portfolioKPIs.totalVal.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {portfolioKPIs.count} {statusFilter === 'owned' ? 'Operating Properties' : 'Assets'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Built Equity (Net Worth)</span>
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-emerald-300 font-mono">
              ${portfolioKPIs.totalEquity.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {portfolioKPIs.ltv > 0 ? `${portfolioKPIs.ltv}% Weighted LTV` : 'Asset-Backed'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Remaining Loan Balance</span>
              <Landmark className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-black text-white font-mono">
              ${portfolioKPIs.totalDebt.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Amortized Principal Balance
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Annual Net Cash Flow</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-emerald-400 font-mono">
              ${portfolioKPIs.totalCashflow.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              ${Math.round(portfolioKPIs.totalCashflow / 12).toLocaleString()} / month
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/80 border border-slate-800">
          {/* Status Pills */}
          <div className="flex items-center space-x-1.5 w-full sm:w-auto">
            <button
              onClick={() => setStatusFilter('owned')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                statusFilter === 'owned'
                  ? 'bg-emerald-600 text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Owned Assets ({deals.filter((d) => d.status === 'owned').length})
            </button>
            <button
              onClick={() => setStatusFilter('prospect')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                statusFilter === 'prospect'
                  ? 'bg-emerald-600 text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Pipeline & Prospects ({deals.filter((d) => d.status !== 'owned').length})
            </button>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                statusFilter === 'all'
                  ? 'bg-emerald-600 text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              All Assets ({deals.length})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by title or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Deals Grid */}
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
              No assets match your current search or filter criteria. Create a new underwriting project to get started.
            </p>
            <button
              onClick={() => setIsWizardOpen(true)}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-slate-950 text-xs font-black hover:bg-emerald-500 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Project</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredDeals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                onEdit={(d) => setEditingDeal(d)}
                onDelete={(d) => setDeletingDeal(d)}
                onToggleStatus={handleToggleStatus}
              />
            ))}
          </div>
        )}
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
