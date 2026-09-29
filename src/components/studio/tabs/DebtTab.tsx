import React, { useState, useMemo } from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import {
  resolvePointInTimeDealMetrics,
  generateMonthlyAmortizationSchedule,
} from '../../../lib/math/pointInTime';
import { CreditCard, Landmark, Percent, Calendar, CheckCircle2, TrendingUp, Layers } from 'lucide-react';

interface DebtTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
}

export const DebtTab: React.FC<DebtTabProps> = ({ deal, metrics }) => {
  const [scheduleView, setScheduleView] = useState<'annual' | 'monthly'>('annual');
  const [selectedYearFilter, setSelectedYearFilter] = useState<number | 'all'>('all');

  const p0 = metrics.projections[0] || {};
  const loanAmt = metrics.loanAmount;
  const intRate = deal.inputs.interestRate || 6.5;
  const termYears = deal.inputs.amortizationYears || deal.inputs.loanTermYears || 30;
  const annualPayment = p0.debtService || 0;
  const isOwned = deal.status === 'owned';

  // Continuous month-by-month calculation
  const pit = useMemo(() => resolvePointInTimeDealMetrics(deal, new Date()), [deal]);
  const monthlySchedule = useMemo(() => generateMonthlyAmortizationSchedule(deal, termYears * 12), [deal, termYears]);

  const filteredMonthlySchedule = useMemo(() => {
    if (selectedYearFilter === 'all') return monthlySchedule;
    const startMonth = (selectedYearFilter - 1) * 12 + 1;
    const endMonth = selectedYearFilter * 12;
    return monthlySchedule.filter((r) => r.month >= startMonth && r.month <= endMonth);
  }, [monthlySchedule, selectedYearFilter]);

  return (
    <div className="space-y-6">
      {/* Dynamic Point-in-Time Operating Loan Banner */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span
              className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full border ${
                isOwned
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
              }`}
            >
              {isOwned ? `Active Hold • Month ${pit.monthsElapsed}` : 'Acquisition Basis'}
            </span>
            <span className="text-xs text-slate-400 font-bold">
              {deal.inputs.financingType || 'Conventional Commercial Mortgage'}
            </span>
          </div>
          <h2 className="text-base font-black text-white tracking-tight">Debt Structure & Amortization Schedule</h2>
          <p className="text-xs text-slate-400">
            {termYears}-Year Amortization Schedule • Continuous monthly principal paydown tracking
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">Current LTV</div>
            <div className="font-bold text-white text-sm">{pit.ltv}%</div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">Monthly Payment</div>
            <div className="font-bold text-amber-400 text-sm">
              ${Math.round(pit.monthlyPayment || annualPayment / 12).toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-[10px] uppercase font-sans">Initial DSCR</div>
            <div className="font-bold text-emerald-400 text-sm">
              {typeof metrics.dscr === 'number' ? metrics.dscr.toFixed(2) : metrics.dscr}x
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>{isOwned ? 'Remaining Debt' : 'Initial Loan Amount'}</span>
            <Landmark className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-white font-mono">
            ${Math.round(isOwned ? pit.currentDebt : loanAmt).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {isOwned ? `$${Math.round(pit.accumulatedPrincipal).toLocaleString()} principal amortized` : `${metrics.ltv}% Debt Financing`}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Fixed Note Rate</span>
            <Percent className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-400 font-mono">{intRate.toFixed(2)}%</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {termYears * 12} Total Payments
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Annual Debt Service</span>
            <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-white font-mono">${Math.round(annualPayment).toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            ${Math.round(annualPayment / 12).toLocaleString()} / month
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
            <span>Built Equity Position</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-300 font-mono">
            ${Math.round(pit.currentEquity).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Current Value ${Math.round(pit.currentVal).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Schedule Table Container */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm space-y-4">
        {/* Table View Toggle Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setScheduleView('annual')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                scheduleView === 'annual'
                  ? 'bg-emerald-600 text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Annual Hold Projection (10-Year)
            </button>
            <button
              onClick={() => setScheduleView('monthly')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                scheduleView === 'monthly'
                  ? 'bg-emerald-600 text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Continuous Monthly Schedule ({termYears * 12} Months)
            </button>
          </div>

          {scheduleView === 'monthly' && (
            <div className="flex items-center space-x-2">
              <label className="text-xs text-slate-400 font-bold">Filter Year:</label>
              <select
                value={selectedYearFilter}
                onChange={(e) =>
                  setSelectedYearFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))
                }
                className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
              >
                <option value="all">All Years (1–{termYears})</option>
                {Array.from({ length: Math.min(termYears, 30) }, (_, i) => i + 1).map((y) => (
                  <option key={y} value={y}>
                    Year {y} (Months {(y - 1) * 12 + 1}–{y * 12})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ANNUAL VIEW */}
        {scheduleView === 'annual' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                  <th className="py-2.5 px-2">Year</th>
                  <th className="py-2.5 px-2">Beginning Balance</th>
                  <th className="py-2.5 px-2">Annual Debt Service</th>
                  <th className="py-2.5 px-2">Principal Paid</th>
                  <th className="py-2.5 px-2">Interest Paid</th>
                  <th className="py-2.5 px-2">Ending Balance</th>
                  <th className="py-2.5 px-2 text-right">Cum. Principal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {metrics.amortizationSchedule.map((entry) => {
                  const isCurrentYear = isOwned && pit.holdYear === entry.year;
                  return (
                    <tr
                      key={entry.year}
                      className={`transition ${
                        isCurrentYear ? 'bg-emerald-500/10 text-white font-bold' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2.5 px-2 font-sans font-bold text-white flex items-center gap-1.5">
                        <span>Year {entry.year}</span>
                        {isCurrentYear && (
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2">${Math.round(entry.beginningBalance).toLocaleString()}</td>
                      <td className="py-2.5 px-2 font-bold text-white">
                        ${Math.round(entry.totalPayment).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-emerald-400">
                        ${Math.round(entry.principalPaid).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-rose-400/90">
                        ${Math.round(entry.interestPaid).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2">${Math.round(entry.endingBalance).toLocaleString()}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-emerald-400">
                        ${Math.round(entry.cumulativePrincipalPaid).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* MONTHLY VIEW */}
        {scheduleView === 'monthly' && (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px] z-10">
                <tr>
                  <th className="py-2 px-2">Month</th>
                  <th className="py-2 px-2">Date</th>
                  <th className="py-2 px-2">Beg. Debt</th>
                  <th className="py-2 px-2">Payment</th>
                  <th className="py-2 px-2">Principal</th>
                  <th className="py-2 px-2">Interest</th>
                  <th className="py-2 px-2">End. Debt</th>
                  <th className="py-2 px-2">Est. Value</th>
                  <th className="py-2 px-2">Built Equity</th>
                  <th className="py-2 px-2 text-right">LTV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {filteredMonthlySchedule.map((row) => {
                  const isCurrentMonth = isOwned && pit.monthsElapsed === row.month;
                  return (
                    <tr
                      key={row.month}
                      className={`transition ${
                        isCurrentMonth
                          ? 'bg-emerald-500/15 text-white font-bold ring-1 ring-emerald-500/40'
                          : 'hover:bg-slate-800/30'
                      }`}
                    >
                      <td className="py-2 px-2 font-sans font-bold flex items-center gap-1">
                        <span>Mo {row.month}</span>
                        {isCurrentMonth && (
                          <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-emerald-500/30 text-emerald-300">
                            Current
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-slate-400 font-sans">{row.calendarDate}</td>
                      <td className="py-2 px-2">${Math.round(row.beginningBalance).toLocaleString()}</td>
                      <td className="py-2 px-2 text-white font-bold">${Math.round(row.payment).toLocaleString()}</td>
                      <td className="py-2 px-2 text-emerald-400">${Math.round(row.principal).toLocaleString()}</td>
                      <td className="py-2 px-2 text-rose-400/90">${Math.round(row.interest).toLocaleString()}</td>
                      <td className="py-2 px-2 text-white">${Math.round(row.endingBalance).toLocaleString()}</td>
                      <td className="py-2 px-2 text-slate-300">${Math.round(row.estimatedValue).toLocaleString()}</td>
                      <td className="py-2 px-2 font-bold text-emerald-300">
                        ${Math.round(row.estimatedEquity).toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-400">{row.ltv}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
