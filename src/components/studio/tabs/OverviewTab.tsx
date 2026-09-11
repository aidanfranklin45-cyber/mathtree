import React from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import { TrendingUp, DollarSign, Percent, ShieldCheck, Building2, MapPin } from 'lucide-react';

interface OverviewTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  onSelectTab: (tab: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ deal, metrics, onSelectTab }) => {
  const p0 = metrics.projections[0] || {};
  const isOwned = deal.status === 'owned';

  return (
    <div className="space-y-6">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Purchase Price</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-white tracking-tight">
            ${metrics.purchasePrice.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5">
            Initial Equity: ${metrics.initialEquity.toLocaleString()} ({100 - metrics.ltv}%)
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Forecast IRR</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-400 tracking-tight">
            {metrics.irr.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5">
            Equity Multiple: {metrics.equityMultiplier.toFixed(2)}x
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Year 1 Cash-on-Cash</span>
            <Percent className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {metrics.cashOnCash.toFixed(2)}%
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5">
            Annual Cash Flow: ${metrics.year1Cashflow.toLocaleString()}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Cap Rate / DSCR</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {metrics.capRate.toFixed(2)}%
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5">
            DSCR: {typeof metrics.dscr === 'number' ? metrics.dscr.toFixed(2) : metrics.dscr}x Coverage
          </div>
        </div>
      </div>

      {/* Main Grid: Executive Summary & Pro-Forma Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Financial Projections Summary */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                10-Year Pro-Forma Cash Flow Horizon
              </h3>
              <p className="text-xs text-slate-400">Underwritten with dynamic revenue and debt amortization schedules</p>
            </div>
            <button
              onClick={() => onSelectTab('proforma')}
              className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
            >
              View Full Pro-Forma →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                  <th className="py-2.5">Year</th>
                  <th className="py-2.5">Effective Revenue</th>
                  <th className="py-2.5">OpEx</th>
                  <th className="py-2.5">NOI</th>
                  <th className="py-2.5">Debt Service</th>
                  <th className="py-2.5">Net Cash Flow</th>
                  <th className="py-2.5 text-right">CoC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {metrics.projections.slice(0, 5).map((p) => (
                  <tr key={p.year} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 font-bold text-white">Y{p.year} ({p.calendarYear})</td>
                    <td className="py-2.5">${p.effectiveGrossIncome.toLocaleString()}</td>
                    <td className="py-2.5 text-rose-400/90">${p.operatingExpenses.toLocaleString()}</td>
                    <td className="py-2.5 font-bold text-emerald-400">${p.netOperatingIncome.toLocaleString()}</td>
                    <td className="py-2.5 text-amber-400/90">${p.debtService.toLocaleString()}</td>
                    <td className="py-2.5 font-bold text-white">${p.netCashFlow.toLocaleString()}</td>
                    <td className="py-2.5 text-right font-bold text-emerald-400">{p.cashOnCash.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 1 Col: Asset Profile & Quick Links */}
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Asset Dossier Snapshot</span>
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Asset Class</span>
                <span className="font-bold text-white capitalize">{deal.asset_class}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Total Area</span>
                <span className="font-bold text-white">
                  {deal.inputs.squareFeet ? `${deal.inputs.squareFeet.toLocaleString()} SF` : 'Commercial Parcel'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">County APN</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {deal.inputs.primaryApn || 'GIS Linked'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Lease Structure</span>
                <span className="font-bold text-white">
                  {deal.inputs.leases?.[0]?.leaseType || 'Triple-Net (NNN)'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Exit Horizon</span>
                <span className="font-bold text-white">{deal.inputs.holdingPeriod || 10} Years</span>
              </div>
            </div>

            <button
              onClick={() => onSelectTab('property')}
              className="w-full mt-2 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold transition flex items-center justify-center gap-1.5"
            >
              <MapPin className="w-3 h-3 text-emerald-400" />
              <span>Inspect County GIS Dossier</span>
            </button>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/40 to-slate-900 border border-emerald-500/20 space-y-2">
            <h4 className="text-xs font-black text-emerald-400 uppercase tracking-wider">
              {isOwned ? 'Asset Management Action' : 'Investment Memo Ready'}
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              All financial statements, debt schedules, and county GIS boundaries are synchronized with PostgreSQL.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
