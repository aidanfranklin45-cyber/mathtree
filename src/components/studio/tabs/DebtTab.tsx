import React, { useState } from 'react';
import { DealRecord, DealMetrics, DealInputs } from '../../../lib/math/types';
import { formatCurrency } from '../../../lib/format';
import { getProjectionStartYear } from '../../../lib/studio/projectionYear';
import { firstFullYear } from '../../../lib/engine';
import { DownPaymentSensitivityCard } from '../DownPaymentSensitivityCard';

interface DebtTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  onUpdateInputs?: (patch: Partial<DealInputs>) => void;
}

const tile = 'bg-slate-950/60 p-3 rounded-xl border border-slate-900';
const tileLabel = 'text-[10px] font-bold tracking-wider text-slate-500 uppercase';

export const DebtTab: React.FC<DebtTabProps> = ({ deal, metrics, onUpdateInputs }) => {
  const [open, setOpen] = useState(true);
  const projections = (metrics.projections ?? []) as Array<Record<string, any>>;
  const schedule = (metrics.amortizationSchedule ?? []) as Array<Record<string, any>>;
  const startYr = getProjectionStartYear(deal);
  const isStub = Boolean(projections[0] && Number(projections[0].operatingMonths) < 12);
  const y1 = firstFullYear(projections) || projections[0];

  const dscr = y1 && y1.dscr !== null && y1.dscr !== undefined && !isNaN(Number(y1.dscr)) ? `${Number(y1.dscr).toFixed(2)}x` : 'N/A';
  const debtYield = y1 && y1.debtYield !== null && y1.debtYield !== undefined && !isNaN(Number(y1.debtYield)) ? `${Number(y1.debtYield).toFixed(2)}%` : 'N/A';

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl overflow-hidden">
        <div className="pb-4 border-b border-slate-900 flex justify-between items-center cursor-pointer" onClick={() => setOpen((o) => !o)}>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-cyan" />
              <span>Debt Structure &amp; Amortization Schedule</span>
            </h3>
            <p className="text-xs text-slate-400">Underwriting metrics, debt coverage, and loan paydown forecast</p>
          </div>
          <button type="button" className="text-slate-400 hover:text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transform transition-transform duration-200 ${open ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </button>
        </div>

        {open && (
          <div className="transition-all duration-300 overflow-hidden mt-4 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className={tile}><p className={tileLabel}>Loan Amount</p><p className="text-sm font-bold text-white mt-1">{formatCurrency(metrics.loanAmount)}</p></div>
              <div className={tile}><p className={tileLabel}>Loan-to-Value (LTV)</p><p className="text-sm font-bold text-white mt-1">{(Number(metrics.ltv) || 0).toFixed(1)}%</p></div>
              <div className={tile}><p className={tileLabel}>Monthly Payment</p><p className="text-sm font-bold text-white mt-1">{formatCurrency(Number(metrics.monthlyMortgagePayment) || 0)}/mo</p></div>
              <div className={tile}>
                <p className={tileLabel}>{isStub ? 'Stabilized DSCR' : 'Year 1 DSCR'}</p>
                <p className="text-sm font-bold text-white mt-1">{dscr}</p>
                {isStub && <span className="text-[9px] font-semibold text-cyan-400">Yr 2 Run Rate</span>}
              </div>
              <div className={tile}>
                <p className={tileLabel}>{isStub ? 'Stabilized Debt Yield' : 'Year 1 Debt Yield'}</p>
                <p className="text-sm font-bold text-white mt-1">{debtYield}</p>
                {isStub && <span className="text-[9px] font-semibold text-cyan-400">Yr 2 Run Rate</span>}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">{schedule.length}-Year Amortization Schedule</h4>
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-slate-900 text-slate-400 font-semibold bg-slate-950/60">
                      <th className="py-2.5 px-5 sticky left-0 bg-slate-950 z-20 border-r border-slate-800/80 shadow-md">Date / Period</th>
                      <th className="py-2.5 px-4">Rate (%)</th>
                      <th className="py-2.5 px-4">Beginning Balance</th>
                      <th className="py-2.5 px-4">Annual Payment</th>
                      <th className="py-2.5 px-4 text-accent-emerald">Principal Paid</th>
                      <th className="py-2.5 px-4 text-accent-rose">Interest Paid</th>
                      <th className="py-2.5 px-4">Ending Balance</th>
                      <th className="py-2.5 px-4 text-emerald-400">Cumulative Paydown</th>
                      <th className="py-2.5 px-4 pr-5 text-slate-400">LTV (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/60">
                    {schedule.map((row, idx) => {
                      const proj = projections[idx];
                      const rateTag = row.isInterestOnly
                        ? <span className="text-amber-400 font-bold">{row.appliedRate}% [I/O]</span>
                        : row.isArmAdjusted
                          ? <span className="text-cyan-400 font-bold">{row.appliedRate}% [ARM]</span>
                          : <span>{row.appliedRate}%</span>;
                      const cumPaydown = row.cumulativePrincipalPaid !== undefined ? row.cumulativePrincipalPaid : (proj?.cumulativePrincipalPaid || 0);
                      return (
                        <tr key={row.year} className="border-b border-slate-900/40 hover:bg-slate-900/20 text-slate-300 font-medium transition">
                          <td className="py-2.5 px-5">
                            <div className="text-slate-100 font-bold text-xs">{startYr + row.year - 1}</div>
                            <div className="text-[10px] text-slate-500 font-medium">Year {row.year}</div>
                          </td>
                          <td className="py-2.5 px-4 font-mono">{rateTag}</td>
                          <td className="py-2.5 px-4">{formatCurrency(row.beginningBalance)}</td>
                          <td className="py-2.5 px-4 font-bold text-white">{formatCurrency(row.totalPayment)}</td>
                          <td className="py-2.5 px-4 text-accent-emerald font-bold">
                            {row.isInterestOnly ? <span className="text-slate-500 font-normal">$0 (I/O)</span> : formatCurrency(row.principalPaid)}
                          </td>
                          <td className="py-2.5 px-4 text-accent-rose font-semibold">{formatCurrency(row.interestPaid)}</td>
                          <td className="py-2.5 px-4">{formatCurrency(row.endingBalance)}</td>
                          <td className="py-2.5 px-4 text-emerald-400 font-bold">{formatCurrency(cumPaydown)}</td>
                          <td className="py-2.5 px-4 pr-5 text-slate-400 font-bold">{proj ? (Number(proj.ltv) || 0).toFixed(1) : '0.0'}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <DownPaymentSensitivityCard deal={deal} metrics={metrics} onUpdateInputs={onUpdateInputs} />
    </div>
  );
};

