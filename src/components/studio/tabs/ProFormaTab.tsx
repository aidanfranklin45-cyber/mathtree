import React, { useState, useMemo } from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import { resolveCalendarProjections } from '../../../lib/math/pointInTime';
import { FileText, Calendar, ChevronDown, ChevronUp, Info, CheckCircle2 } from 'lucide-react';

interface ProFormaTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
}

export const ProFormaTab: React.FC<ProFormaTabProps> = ({ deal, metrics }) => {
  const [showMonthlyReceipts, setShowMonthlyReceipts] = useState(false);

  // Compute multi-timeline calendar projections with exact contractual lease escalations
  const calProj = useMemo(() => {
    return resolveCalendarProjections(deal, metrics.projections?.length || 10);
  }, [deal, metrics]);

  // Use calendar projections if leases or closing date are defined, falling back to metrics.projections
  const activeProjections = calProj.length > 0 ? calProj : metrics.projections;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              Calendar Pro-Forma
            </span>
            <span className="text-xs text-slate-400 font-medium">
              Contractual Lease &amp; Amortization Synchronization
            </span>
          </div>
          <h2 className="text-base font-black text-white tracking-tight">10-Year Pro-Forma Schedule &amp; Cash Flows</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Compound annual growth rates: {deal.inputs.rentGrowthPercent || 3.0}% rent growth, {deal.inputs.expenseGrowthPercent || 2.5}% expense inflation
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">Exit Cap Rate</div>
            <div className="font-bold text-white">{deal.inputs.exitCapRatePercent || 6.5}%</div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">10-Yr IRR</div>
            <div className="font-bold text-emerald-400">{metrics.irr.toFixed(1)}%</div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">Equity Multiple</div>
            <div className="font-bold text-emerald-400">{metrics.equityMultiplier.toFixed(2)}x</div>
          </div>
        </div>
      </div>

      {/* Pro-Forma Table */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 overflow-x-auto shadow-sm">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
              <th className="py-3 px-2">Line Item</th>
              {activeProjections.map((p) => (
                <th key={p.year} className="py-3 px-2 text-right">
                  Y{p.year} <span className="text-slate-500 font-normal">({p.calendarYear})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
            {/* Gross Potential Rent */}
            <tr className="hover:bg-slate-800/40 transition">
              <td className="py-2.5 px-2 font-sans font-medium text-slate-300">Gross Potential Rent</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  ${Math.round(p.grossPotentialRent).toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Vacancy & Credit Loss */}
            <tr className="hover:bg-slate-800/40 transition text-rose-400/80">
              <td className="py-2.5 px-2 font-sans font-medium">Vacancy Loss ({deal.inputs.vacancyRatePercent || 5}%)</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  -${Math.round(p.vacancyLoss).toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Effective Gross Income */}
            <tr className="hover:bg-slate-800/40 transition font-bold bg-slate-950/40 text-white">
              <td className="py-2.5 px-2 font-sans">Effective Gross Income (EGI)</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  ${Math.round(p.effectiveGrossIncome).toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Operating Expenses */}
            <tr className="hover:bg-slate-800/40 transition text-rose-400/90">
              <td className="py-2.5 px-2 font-sans font-medium">Total Operating Expenses (OpEx)</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  -${Math.round(p.operatingExpenses).toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Net Operating Income (NOI) */}
            <tr className="hover:bg-slate-800/40 transition font-black bg-emerald-950/20 text-emerald-400 border-y border-emerald-500/20">
              <td className="py-3 px-2 font-sans">Net Operating Income (NOI)</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-3 px-2 text-right text-sm">
                  ${Math.round(p.netOperatingIncome).toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Annual Debt Service */}
            <tr className="hover:bg-slate-800/40 transition text-amber-400/90">
              <td className="py-2.5 px-2 font-sans font-medium">Annual Debt Service (P&amp;I)</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  -${Math.round(p.debtService).toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Net Cash Flow (Before Tax) */}
            <tr className="hover:bg-slate-800/40 transition font-black bg-slate-950/60 text-white border-b border-slate-700">
              <td className="py-3 px-2 font-sans">Net Cash Flow (After Debt)</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-3 px-2 text-right text-sm">
                  ${Math.round(p.netCashFlow).toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Cash on Cash Return */}
            <tr className="hover:bg-slate-800/40 transition font-bold text-emerald-400">
              <td className="py-2.5 px-2 font-sans">Cash-on-Cash Yield</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  {p.cashOnCash.toFixed(2)}%
                </td>
              ))}
            </tr>

            {/* DSCR Coverage */}
            <tr className="hover:bg-slate-800/40 transition text-slate-400 text-[11px]">
              <td className="py-2.5 px-2 font-sans">Debt Service Coverage (DSCR)</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  {typeof p.dscr === 'number' ? `${p.dscr.toFixed(2)}x` : p.dscr}
                </td>
              ))}
            </tr>

            {/* Ending Loan Balance */}
            <tr className="hover:bg-slate-800/40 transition text-slate-400 text-[11px]">
              <td className="py-2.5 px-2 font-sans">Ending Loan Balance</td>
              {activeProjections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  ${Math.round(p.endingLoanBalance).toLocaleString()}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Audited Methodology Footnotes Card */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white tracking-tight">
              Institutional Defensibility &amp; Methodology Footnotes
            </h3>
          </div>
          <button
            onClick={() => setShowMonthlyReceipts(!showMonthlyReceipts)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
          >
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            <span>{showMonthlyReceipts ? 'Hide Monthly Receipts' : 'View Granular Monthly Receipts'}</span>
            {showMonthlyReceipts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {activeProjections
            .filter((p) => p.methodologyFootnote)
            .map((p) => (
              <div key={p.year} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-white">Year {p.year} ({p.calendarYear})</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                    ${Math.round(p.grossPotentialRent).toLocaleString()} Total Gross
                  </span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  {p.methodologyFootnote}
                </p>
              </div>
            ))}
        </div>

        {/* Collapsible Month-by-Month Receipts */}
        {showMonthlyReceipts && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-3">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Audited Month-by-Month Rental Receipts Log
            </div>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/80 p-2 divide-y divide-slate-800/60 text-xs font-mono">
              {activeProjections.flatMap((p) => p.monthlyReceipts || []).map((r, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-2 hover:bg-slate-900/50">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 w-24 font-bold">{r.month}</span>
                    <span className="text-slate-300 text-[11px] font-sans">{r.status}</span>
                  </div>
                  <div className={`font-bold ${r.rent > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                    ${r.rent.toLocaleString()}/mo
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

