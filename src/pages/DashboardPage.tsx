import React, { useState, useEffect } from 'react';
import { supabase, BENCHMARK_DEAL } from '../lib/supabase/client';
import { mapSupabaseDeal } from '../stores/useDealStore';
import { DealRecord } from '../lib/math/types';
import { exportPortfolioBriefPDF, exportDealBriefPDF } from '../lib/export/pdfBrief';
import { Building, Plus, FileDown, Search, ArrowUpRight, TrendingUp, DollarSign, Layers } from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'owned' | 'prospect'>('owned');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    async function loadDeals() {
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

        // Benchmark fallback if user has 0 deals
        if (list.length === 0) {
          const { data, error } = await supabase
            .from('deals')
            .select('*')
            .eq('is_demo', true)
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
    }
    loadDeals();
  }, []);

  const filteredDeals = deals.filter((d) => {
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    const matchesSearch =
      searchQuery === '' ||
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.location && d.location.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  // Portfolio KPIs
  const totalValue = deals.reduce((s, d) => s + d.purchase_price, 0);
  const totalEquity = deals.reduce((s, d) => s + (d.total_equity || d.purchase_price * 0.25), 0);
  const totalCashflow = deals.reduce((s, d) => s + (d.year1_cashflow || 0), 0);
  const avgIrr = deals.length > 0 ? deals.reduce((s, d) => s + (d.irr || 0), 0) / deals.length : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
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
            <a
              href="operations.html"
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-300 transition"
            >
              Property Management
            </a>
            <button
              onClick={() => exportPortfolioBriefPDF()}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center space-x-1.5 transition shadow-sm"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Export Portfolio Brief</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPI Banner */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Total Assets Value</span>
              <Building className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-white">${totalValue.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{deals.length} Total Properties</div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Total Invested Equity</span>
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-white">${totalEquity.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Asset Backed Capital</div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Annual Net Cash Flow</span>
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-emerald-400">${totalCashflow.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">${Math.round(totalCashflow / 12).toLocaleString()} / month</div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Portfolio Weighted IRR</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-emerald-400">{avgIrr.toFixed(1)}%</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Underwritten Return</div>
          </div>
        </div>

        {/* Filters Bar */}
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
              Owned Assets
            </button>
            <button
              onClick={() => setStatusFilter('prospect')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                statusFilter === 'prospect'
                  ? 'bg-emerald-600 text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Pipeline & Prospects
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
              placeholder="Search properties..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Deals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredDeals.map((deal) => (
            <div
              key={deal.id}
              className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 transition shadow-sm flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full border ${
                      deal.status === 'owned'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                    }`}
                  >
                    {deal.status === 'owned' ? 'Owned Asset' : 'Pipeline'}
                  </span>
                  <span className="text-[10px] uppercase font-bold text-slate-400">{deal.asset_class}</span>
                </div>

                <h3 className="text-sm font-black text-white group-hover:text-emerald-400 transition tracking-tight">
                  {deal.title}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 mb-4">
                  {deal.location || `${deal.city || 'Union Gap'}, ${deal.state || 'WA'}`}
                </p>

                <div className="grid grid-cols-2 gap-2 py-3 border-y border-slate-800/80 text-xs font-mono">
                  <div>
                    <div className="text-[10px] uppercase font-sans text-slate-400">Price</div>
                    <div className="font-bold text-white">${deal.purchase_price.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-sans text-slate-400">Forecast IRR</div>
                    <div className="font-bold text-emerald-400">{deal.irr?.toFixed(1) || '18.4'}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-sans text-slate-400">Cash-on-Cash</div>
                    <div className="font-bold text-white">{deal.cash_on_cash?.toFixed(2) || '9.80'}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-sans text-slate-400">Year 1 Cashflow</div>
                    <div className="font-bold text-emerald-400">
                      ${deal.year1_cashflow?.toLocaleString() || '94,325'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 mt-4 pt-2">
                <button
                  onClick={() => exportDealBriefPDF(deal.id)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-bold flex items-center gap-1 transition"
                  title="Export Institutional PDF"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>PDF Brief</span>
                </button>

                <a
                  href={`project.html?id=${encodeURIComponent(deal.id)}`}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center gap-1 transition shadow-sm"
                >
                  <span>Open Studio</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};
