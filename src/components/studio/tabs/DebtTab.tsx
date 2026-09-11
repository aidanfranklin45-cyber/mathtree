import React from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import { CreditCard, Landmark, Percent, Calendar } from 'lucide-react';

interface DebtTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
}

export const DebtTab: React.FC<DebtTabProps> = ({ deal, metrics }) => {
  const p0 = metrics.projections[0] || {};
  const loanAmt = metrics.loanAmount;
  const intRate = deal.inputs.interestRate || 6.5;
  const termYears = deal.inputs.amortizationYears || deal.inputs.loanTermYears || 30;
  const annualPayment = p0.debtService || 0;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-white tracking-tight">Debt Structure & Amortization Schedule</h2>
          <p className="text-xs text-slate-400">
            {deal.inputs.financingType || 'Conventional Commercial Mortgage'} • {termYears}-Year Amortization
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">Loan-to-Value (LTV)</div>
            <div className="font-bold text-white">{metrics.ltv}%</div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">Monthly Payment</div>
            <div className="font-bold text-amber-400">${Math.round(annualPayment / 12).toLocaleString()}</div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">Initial DSCR</div>
            <div className="font-bold text-emerald-400">{typeof metrics.dscr === 'number' ? metrics.dscr.toFixed(2) : metrics.dscr}x</div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Principal Amount</span>
            <Landmark className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-white">${loanAmt.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">75.0% Debt Financing</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Interest Rate</span>
            <Percent className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-400">{intRate.toFixed(2)}%</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Fixed Commercial Note</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Annual Debt Service</span>
            <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-white">${annualPayment.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">${Math.round(annualPayment / 12).toLocaleString()} / month</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Amortization Term</span>
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-white">{termYears} Years</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{termYears * 12} Total Payments</div>
        </div>
      </div>

      {/* Amortization Schedule Table */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 overflow-x-auto shadow-sm">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">
          Annual Loan Amortization Schedule (Hold Period)
        </h3>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
              <th className="py-2.5 px-2">Year</th>
              <th className="py-2.5 px-2">Beginning Balance</th>
              <th className="py-2.5 px-2">Annual Payment</th>
              <th className="py-2.5 px-2">Principal Paid</th>
              <th className="py-2.5 px-2">Interest Paid</th>
              <th className="py-2.5 px-2">Ending Balance</th>
              <th className="py-2.5 px-2 text-right">Cum. Principal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
            {metrics.amortizationSchedule.map((entry) => (
              <tr key={entry.year} className="hover:bg-slate-800/40 transition">
                <td className="py-2.5 px-2 font-sans font-bold text-white">Year {entry.year}</td>
                <td className="py-2.5 px-2">${entry.beginningBalance.toLocaleString()}</td>
                <td className="py-2.5 px-2 font-bold text-white">${entry.totalPayment.toLocaleString()}</td>
                <td className="py-2.5 px-2 text-emerald-400">${entry.principalPaid.toLocaleString()}</td>
                <td className="py-2.5 px-2 text-rose-400/90">${entry.interestPaid.toLocaleString()}</td>
                <td className="py-2.5 px-2">${entry.endingBalance.toLocaleString()}</td>
                <td className="py-2.5 px-2 text-right font-bold text-emerald-400">
                  ${entry.cumulativePrincipalPaid.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
