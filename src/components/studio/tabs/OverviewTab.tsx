import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import {
  TrendingUp,
  DollarSign,
  Percent,
  ShieldCheck,
  Building2,
  MapPin,
  ChevronDown,
  Info,
  ArrowRight,
  ExternalLink,
  Layers,
} from 'lucide-react';

interface OverviewTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  onSelectTab: (tab: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ deal, metrics, onSelectTab }) => {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const isOwned = deal.status === 'owned';
  const p0 = metrics.projections[0] || {};
  const monthlyCashflow = Math.round(metrics.year1Cashflow / 12);
  const monthlyDebtService = Math.round((p0.debtService || 0) / 12);

  // Calculate Break-Even Year
  const breakEvenYear = useMemo(() => {
    let cumulative = -metrics.initialEquity;
    for (const p of metrics.projections) {
      cumulative += p.netCashFlow;
      if (cumulative >= 0) {
        return `Year ${p.year}`;
      }
    }
    return '10+ Years';
  }, [metrics]);

  const assessor = deal.inputs?.assessorData || {};
  const totalAssessed = assessor.totalAssessedValue || assessor.assessedValue || 0;
  const isMultiParcel = (deal.inputs?.parcels?.length ?? 0) > 1;

  // Selected milestones: Year 1, 3, 5, 7, 10
  const milestoneYears = [1, 3, 5, 7, 10];
  const milestoneProjections = metrics.projections.filter((p) => milestoneYears.includes(p.year));

  return (
    <div className="space-y-6">
      {/* 4 Primary Top KPI Cards (Matching project.html) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* NOI Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] sm:text-xs font-semibold tracking-wider uppercase">
              Net Operating Income
            </span>
            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider bg-slate-950 px-1.5 py-0.5 border border-slate-800 rounded">
              Year 1
            </span>
          </div>
          <div className="mt-1 sm:mt-2">
            <span className="text-xl sm:text-2xl font-black text-white tracking-tight font-mono">
              ${Math.round(metrics.noi).toLocaleString()}
            </span>
          </div>
          <div className="mt-2 text-[10px] sm:text-xs text-slate-400">
            <span>Revenue minus OpEx</span>
          </div>
        </div>

        {/* Cap Rate Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] sm:text-xs font-semibold tracking-wider uppercase">
              Cap Rate Yield
            </span>
            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider bg-slate-950 px-1.5 py-0.5 border border-slate-800 rounded">
              Year 1
            </span>
          </div>
          <div className="mt-1 sm:mt-2">
            <span className="text-xl sm:text-2xl font-black text-cyan-400 tracking-tight font-mono">
              {metrics.capRate.toFixed(2)}%
            </span>
          </div>
          <div className="mt-2 text-[10px] sm:text-xs text-slate-400">
            <span>Annual NOI / Purchase Price</span>
          </div>
        </div>

        {/* Net Cash Flow Card */}
        <div className="bg-gradient-to-br from-slate-900/80 via-slate-900/40 to-emerald-950/20 border border-emerald-950/80 hover:border-emerald-800/60 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden transition shadow-lg shadow-emerald-950/20">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-[10px] sm:text-xs font-semibold tracking-wider uppercase">
              Net Cash Flow
            </span>
            <span className="text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Take-Home
            </span>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black text-emerald-400 tracking-tight font-mono">
              ${Math.round(metrics.year1Cashflow).toLocaleString()}/yr
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] sm:text-xs text-slate-400">
            <span>After debt service</span>
            <span className="font-mono text-emerald-300 font-bold">
              {monthlyCashflow >= 0 ? `+$${monthlyCashflow.toLocaleString()}` : `-$${Math.abs(monthlyCashflow).toLocaleString()}`}/mo
            </span>
          </div>
        </div>

        {/* Cash-on-Cash Return Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] sm:text-xs font-semibold tracking-wider uppercase">
              Cash-on-Cash
            </span>
            {metrics.initialEquity <= 0 ? (
              <span className="text-[8px] sm:text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                100% Financed
              </span>
            ) : (
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider bg-slate-950 px-1.5 py-0.5 border border-slate-800 rounded">
                Year 1
              </span>
            )}
          </div>
          <div className="mt-1 sm:mt-2">
            <span className="text-xl sm:text-2xl font-black text-white tracking-tight font-mono">
              {metrics.cashOnCash.toFixed(2)}%
            </span>
          </div>
          <div className="mt-2 text-[10px] sm:text-xs text-slate-400">
            <span>Cash flow / initial equity</span>
          </div>
        </div>
      </div>

      {/* Advanced Analytics Metrics Grid (Matching project.html) */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl relative overflow-hidden space-y-4">
        <div className="border-b border-slate-800/80 pb-3 flex items-center justify-between">
          <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight flex items-center space-x-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-400"></span>
            <span>Advanced Analytics</span>
          </h3>
          <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-slate-950 px-2 py-0.5 border border-slate-800 rounded">
            Exit: Year {deal.inputs?.holdingPeriod || 10}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {/* NPV */}
          <div className="bg-slate-950/60 p-3.5 sm:p-4 rounded-xl border border-slate-800 relative group">
            <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase flex items-center justify-between">
              <span>NPV</span>
              <span className="text-slate-500 cursor-help" title="Net Present Value: Discounted cash flows + exit equity minus initial investment.">ⓘ</span>
            </p>
            <div className="mt-1">
              <span className="text-lg sm:text-xl font-black text-white tracking-tight font-mono">
                ${Math.round(metrics.npv).toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Today's cash value minus investment</p>
          </div>

          {/* IRR */}
          <div className="bg-slate-950/60 p-3.5 sm:p-4 rounded-xl border border-slate-800 relative group">
            <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase flex items-center justify-between">
              <span>IRR</span>
              <span className="text-slate-500 cursor-help" title="Internal Rate of Return: Annualized rate of return of the investment.">ⓘ</span>
            </p>
            <div className="mt-1">
              <span className="text-lg sm:text-xl font-black text-violet-400 tracking-tight font-mono">
                {metrics.irr.toFixed(2)}%
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Annualized rate of return</p>
          </div>

          {/* Equity Multiplier */}
          <div className="bg-slate-950/60 p-3.5 sm:p-4 rounded-xl border border-slate-800 relative group">
            <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase flex items-center justify-between">
              <span>Equity Multiplier</span>
              <span className="text-slate-500 cursor-help" title="Equity Multiplier: Total returns divided by initial cash invested (also known as MOIC).">ⓘ</span>
            </p>
            <div className="mt-1">
              <span className="text-lg sm:text-xl font-black text-cyan-400 tracking-tight font-mono">
                {metrics.equityMultiplier.toFixed(2)}x
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Total returns / Initial cash</p>
          </div>

          {/* Break-Even Year */}
          <div className="bg-slate-950/60 p-3.5 sm:p-4 rounded-xl border border-slate-800 relative group">
            <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase flex items-center justify-between">
              <span>Break-Even</span>
              <span className="text-slate-500 cursor-help" title="Break-Even Year: The year when cumulative cash flow becomes positive.">ⓘ</span>
            </p>
            <div className="mt-1">
              <span className="text-lg sm:text-xl font-black text-emerald-400 tracking-tight font-mono">
                {breakEvenYear}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Cumulative cash turns positive</p>
          </div>
        </div>
      </div>

      {/* Collapsible Glossary & Understanding Deal Metrics */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5 rounded-2xl shadow-sm overflow-hidden">
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setGlossaryOpen(!glossaryOpen)}
        >
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <span>Glossary: Understanding Your Deal Metrics</span>
          </h3>
          <button type="button" className="text-slate-400 hover:text-white transition">
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${glossaryOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {glossaryOpen && (
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-4 text-xs leading-relaxed text-slate-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <p className="font-semibold text-violet-400 flex items-center gap-1.5">
                  <span>⚡</span>
                  <span>Internal Rate of Return (IRR)</span>
                </p>
                <p className="text-slate-400 text-[11px]">
                  The annualized rate of return that equates the present value of all cash flows (including net sale equity at exit) to your initial investment. Think of it as the speed at which your capital compounds.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-white flex items-center gap-1.5">
                  <span>💸</span>
                  <span>Net Present Value (NPV)</span>
                </p>
                <p className="text-slate-400 text-[11px]">
                  The current value of all future cash flows discounted back to today using a target discount rate (hurdle rate), minus your initial cash investment.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-cyan-400 flex items-center gap-1.5">
                  <span>📈</span>
                  <span>Equity Multiplier (MOIC)</span>
                </p>
                <p className="text-slate-400 text-[11px]">
                  How many times your cash investment is returned over the hold period. Calculated as Total Cash Returned / Total Cash Invested.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Two-Column Executive Deal Synopsis (Matching project.html) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left: Property & Site Details */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Property &amp; Site Details
            </h3>
            {isMultiParcel && (
              <span className="text-[9px] font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-1.5 py-0.5 rounded">
                Assemblage ({deal.inputs?.parcels?.length} APNs)
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Property Address</span>
              <span className="text-xs font-bold text-slate-200 mt-1 block truncate">
                {deal.location || `${deal.city || 'Union Gap'}, ${deal.state || 'WA'}`}
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">APN & County</span>
              <span className="text-xs font-bold text-emerald-400 mt-1 block truncate font-mono">
                {deal.inputs?.primaryApn || assessor.apn || 'Yakima County'}
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Class & Asset Type</span>
              <span className="text-xs font-bold text-slate-200 mt-1 block truncate capitalize">
                {deal.asset_class} • {deal.inputs?.propertyClass || 'Class B'}
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">County Assessed Value</span>
              <span className="text-xs font-bold text-emerald-400 mt-1 block truncate font-mono">
                {totalAssessed > 0 ? `$${Math.round(totalAssessed).toLocaleString()}` : '--'}
              </span>
            </div>
          </div>

          {/* Tenancy & Rent Roll Summary Banner */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs flex items-center justify-between shadow-inner">
            <div className="min-w-0">
              <span className="font-bold text-white text-[11px] block truncate">
                {deal.inputs?.leases?.length ? `${deal.inputs.leases.length} Active Leases` : 'Operating Asset'}
              </span>
              <span className="text-[10px] text-slate-400 block truncate">
                {deal.inputs?.leases?.[0]?.tenantName || '100% Occupied'}
              </span>
            </div>
            <Link
              to="/operations"
              className="shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-[10px] font-bold text-emerald-400 border border-slate-800 hover:border-emerald-500/40 transition flex items-center space-x-1"
            >
              <span>Rent Roll</span>
              <span>➔</span>
            </Link>
          </div>

          <button
            type="button"
            onClick={() => onSelectTab('property')}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center space-x-2 transition shadow-sm group"
          >
            <span>View Property Records &amp; Details</span>
            <span className="text-emerald-400 group-hover:translate-x-1 transition-transform">➔</span>
          </button>
        </div>

        {/* Right: Financing & Debt Structure Snapshot Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Financing &amp; Debt Structure
            </h3>
            <span className="text-[10px] font-bold text-slate-400">
              {metrics.ltv}% Loan-to-Value
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Loan Amount</span>
              <span className="text-xs font-bold text-white mt-1 block truncate font-mono">
                ${Math.round(metrics.loanAmount).toLocaleString()}
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Interest Rate</span>
              <span className="text-xs font-bold text-slate-200 mt-1 block truncate font-mono">
                {deal.inputs?.interestRate || 6.5}% Fixed
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Debt Service (P&I)</span>
              <span className="text-xs font-bold text-amber-400 mt-1 block truncate font-mono">
                ${monthlyDebtService.toLocaleString()}/mo
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Coverage (DSCR)</span>
              <span className="text-xs font-bold text-emerald-400 mt-1 block truncate font-mono">
                {typeof metrics.dscr === 'number' ? metrics.dscr.toFixed(2) : metrics.dscr}x
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs flex items-center justify-between shadow-inner">
            <div className="min-w-0">
              <span className="font-bold text-white text-[11px] block truncate">
                {deal.inputs?.amortizationYears || deal.inputs?.loanTermYears || 30}-Year Amortization
              </span>
              <span className="text-[10px] text-slate-400 block truncate">
                Initial Down Payment: ${Math.round(metrics.initialEquity).toLocaleString()}
              </span>
            </div>
            <span className="text-[10px] font-bold text-slate-400 font-mono">
              ${Math.round(p0.debtService || 0).toLocaleString()}/yr
            </span>
          </div>

          <button
            type="button"
            onClick={() => onSelectTab('debt')}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center space-x-2 transition shadow-sm group"
          >
            <span>View Debt Structure &amp; Full Amortization Schedule</span>
            <span className="text-cyan-400 group-hover:translate-x-1 transition-transform">➔</span>
          </button>
        </div>
      </div>

      {/* 5-Year Milestone Capital Trajectory Preview (Matching project.html) */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              5-Year Milestone Capital Trajectory
            </h3>
            <p className="text-[11px] text-slate-400">
              Key performance milestones across Year 1, Year 3, Year 5, Year 7, and Year 10
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelectTab('proforma')}
            className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center space-x-1 transition self-start sm:self-auto"
          >
            <span>View All 10 Years &amp; Monthly Schedule ➔</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                <th className="py-2.5 px-3">Milestone</th>
                <th className="py-2.5 px-3">Property Value</th>
                <th className="py-2.5 px-3">Debt Balance</th>
                <th className="py-2.5 px-3">Net Equity</th>
                <th className="py-2.5 px-3">Effective Rev</th>
                <th className="py-2.5 px-3">NOI</th>
                <th className="py-2.5 px-3">Debt Service</th>
                <th className="py-2.5 px-3">Net Cash Flow</th>
                <th className="py-2.5 px-3 text-right">Cash-on-Cash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {milestoneProjections.map((p) => {
                const loanBal = p.endingLoanBalance || 0;
                const eq = Math.max(0, p.propertyValue - loanBal);
                return (
                  <tr key={p.year} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3 font-bold text-white font-sans">
                      Year {p.year} ({p.calendarYear})
                    </td>
                    <td className="py-2.5 px-3 text-white">
                      ${Math.round(p.propertyValue).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">
                      ${Math.round(loanBal).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-cyan-400 font-bold">
                      ${Math.round(eq).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3">
                      ${Math.round(p.effectiveGrossIncome || p.grossPotentialRent || 0).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-emerald-400">
                      ${Math.round(p.netOperatingIncome).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-amber-400">
                      ${Math.round(p.debtService).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-white">
                      ${Math.round(p.netCashFlow).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-400">
                      {(p.cashOnCash || 0).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
