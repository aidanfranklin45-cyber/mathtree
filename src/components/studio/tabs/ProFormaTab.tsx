import React from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';

interface ProFormaTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
}

export const ProFormaTab: React.FC<ProFormaTabProps> = ({ deal, metrics }) => {
  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-white tracking-tight">10-Year Pro-Forma Schedule & Cash Flows</h2>
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
              {metrics.projections.map((p) => (
                <th key={p.year} className="py-3 px-2 text-right">
                  Y{p.year} <span className="text-slate-600 font-normal">({p.calendarYear})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
            {/* Gross Potential Rent */}
            <tr className="hover:bg-slate-800/40 transition">
              <td className="py-2.5 px-2 font-sans font-medium text-slate-300">Gross Potential Rent</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  ${p.grossPotentialRent.toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Vacancy & Credit Loss */}
            <tr className="hover:bg-slate-800/40 transition text-rose-400/80">
              <td className="py-2.5 px-2 font-sans font-medium">Vacancy Loss ({deal.inputs.vacancyRatePercent || 5}%)</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  -${p.vacancyLoss.toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Effective Gross Income */}
            <tr className="hover:bg-slate-800/40 transition font-bold bg-slate-950/40 text-white">
              <td className="py-2.5 px-2 font-sans">Effective Gross Income (EGI)</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  ${p.effectiveGrossIncome.toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Operating Expenses */}
            <tr className="hover:bg-slate-800/40 transition text-rose-400/90">
              <td className="py-2.5 px-2 font-sans font-medium">Total Operating Expenses (OpEx)</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  -${p.operatingExpenses.toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Net Operating Income (NOI) */}
            <tr className="hover:bg-slate-800/40 transition font-black bg-emerald-950/20 text-emerald-400 border-y border-emerald-500/20">
              <td className="py-3 px-2 font-sans">Net Operating Income (NOI)</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-3 px-2 text-right text-sm">
                  ${p.netOperatingIncome.toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Annual Debt Service */}
            <tr className="hover:bg-slate-800/40 transition text-amber-400/90">
              <td className="py-2.5 px-2 font-sans font-medium">Annual Debt Service (P&I)</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  -${p.debtService.toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Net Cash Flow (Before Tax) */}
            <tr className="hover:bg-slate-800/40 transition font-black bg-slate-950/60 text-white border-b border-slate-700">
              <td className="py-3 px-2 font-sans">Net Cash Flow (After Debt)</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-3 px-2 text-right text-sm">
                  ${p.netCashFlow.toLocaleString()}
                </td>
              ))}
            </tr>

            {/* Cash on Cash Return */}
            <tr className="hover:bg-slate-800/40 transition font-bold text-emerald-400">
              <td className="py-2.5 px-2 font-sans">Cash-on-Cash Yield</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  {p.cashOnCash.toFixed(2)}%
                </td>
              ))}
            </tr>

            {/* DSCR Coverage */}
            <tr className="hover:bg-slate-800/40 transition text-slate-400 text-[11px]">
              <td className="py-2.5 px-2 font-sans">Debt Service Coverage (DSCR)</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  {typeof p.dscr === 'number' ? `${p.dscr.toFixed(2)}x` : p.dscr}
                </td>
              ))}
            </tr>

            {/* Ending Loan Balance */}
            <tr className="hover:bg-slate-800/40 transition text-slate-400 text-[11px]">
              <td className="py-2.5 px-2 font-sans">Ending Loan Balance</td>
              {metrics.projections.map((p) => (
                <td key={p.year} className="py-2.5 px-2 text-right">
                  ${p.endingLoanBalance.toLocaleString()}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
