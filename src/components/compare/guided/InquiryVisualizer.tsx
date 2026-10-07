import React from 'react';
import { formatCurrency } from '../../../lib/format';
import type { InquiryExecutionResult } from '../../../lib/compare/inquiries';
import { ShieldCheck, Tag, Activity, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';

interface InquiryVisualizerProps {
  inquiryResult: InquiryExecutionResult;
}

export const InquiryVisualizer: React.FC<InquiryVisualizerProps> = ({ inquiryResult }) => {
  const { questionId, rawResult } = inquiryResult;

  if (questionId === 'bankability_down_payment') {
    const { rows = [], baselinePercent, debtServicePer5PctDown, goingInCapRate, loanConstant } = rawResult;
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">
              Down Payment vs. Lender DSCR Covenant Ladder
            </h3>
          </div>
          {debtServicePer5PctDown > 0 && (
            <span className="text-[11px] font-bold text-cyan-300 bg-cyan-950/60 border border-cyan-800/40 px-2.5 py-1 rounded-xl">
              Saves {formatCurrency(debtServicePer5PctDown)}/yr per 5% down
            </span>
          )}
        </div>

        {/* Down Payment Matrix Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400">
                <th className="py-2.5 px-3">Down Payment</th>
                <th className="py-2.5 px-3">Equity Required</th>
                <th className="py-2.5 px-3">Loan Amount</th>
                <th className="py-2.5 px-3">Annual Debt Service</th>
                <th className="py-2.5 px-3 text-center">DSCR Coverage</th>
                <th className="py-2.5 px-3 text-right">Cash-on-Cash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {rows.map((r: any, idx: number) => {
                const dscr = r.dscr ?? 0;
                const isBankable = dscr >= 1.25;
                const isTight = dscr >= 1.0 && dscr < 1.25;
                const isBase = r.isBaseline;

                return (
                  <tr
                    key={idx}
                    className={`transition ${
                      isBase
                        ? 'bg-slate-800/60 font-bold text-white'
                        : isBankable
                          ? 'hover:bg-emerald-950/20 text-slate-200'
                          : 'hover:bg-slate-800/30 text-slate-400'
                    }`}
                  >
                    <td className="py-3 px-3 flex items-center space-x-2">
                      <span>{r.downPaymentPercent}%</span>
                      {isBase && (
                        <span className="text-[9px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-sans uppercase">
                          Baseline
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-200">
                      {formatCurrency(r.downPaymentAmount)}
                    </td>
                    <td className="py-3 px-3 text-slate-300">{formatCurrency(r.loanAmount)}</td>
                    <td className="py-3 px-3 text-slate-300">{formatCurrency(r.annualDebtService)}</td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          isBankable
                            ? 'bg-emerald-950/80 border border-emerald-800/80 text-emerald-300'
                            : isTight
                              ? 'bg-amber-950/80 border border-amber-800/80 text-amber-300'
                              : 'bg-rose-950/80 border border-rose-800/80 text-rose-300'
                        }`}
                      >
                        {isBankable ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <XCircle className="w-3 h-3 text-rose-400" />
                        )}
                        <span>{dscr > 0 ? `${dscr.toFixed(2)}x` : 'N/A'}</span>
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-slate-200">
                      {r.cashOnCash ? `${r.cashOnCash.toFixed(1)}%` : '0.0%'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (questionId === 'expense_ratio_bankability' || rawResult?.points) {
    const { points = [], baselineValue, targetThreshold = 1.25 } = rawResult;
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">
              Operating Expense Ratio vs. Bankability Covenant
            </h3>
          </div>
          <span className="text-[11px] font-bold text-slate-300 bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-xl">
            Lender Covenant: &ge; {targetThreshold.toFixed(2)}x DSCR
          </span>
        </div>

        {/* Expense Sensitivity Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400">
                <th className="py-2.5 px-3">Expense Ratio</th>
                <th className="py-2.5 px-3">Annual Opex</th>
                <th className="py-2.5 px-3">Stabilized NOI</th>
                <th className="py-2.5 px-3 text-center">DSCR Coverage</th>
                <th className="py-2.5 px-3 text-right">Cash Flow</th>
                <th className="py-2.5 px-3 text-right">Cash-on-Cash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {points.map((p: any, idx: number) => {
                const isBase = p.isBaseline;
                const isBankable = p.status === 'bankable';
                const isTight = p.status === 'tight';

                return (
                  <tr
                    key={idx}
                    className={`transition ${
                      isBase
                        ? 'bg-slate-800/60 font-bold text-white'
                        : isBankable
                          ? 'hover:bg-emerald-950/20 text-slate-200'
                          : isTight
                            ? 'hover:bg-amber-950/20 text-slate-300'
                            : 'hover:bg-rose-950/20 text-slate-400'
                    }`}
                  >
                    <td className="py-3 px-3 flex items-center space-x-2">
                      <span>{p.testValue.toFixed(1)}%</span>
                      {isBase && (
                        <span className="text-[9px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-sans uppercase">
                          Baseline
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-300">{formatCurrency(p.operatingExpenses)}</td>
                    <td className="py-3 px-3 font-semibold text-slate-200">{formatCurrency(p.noi)}</td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          isBankable
                            ? 'bg-emerald-950/80 border border-emerald-800/80 text-emerald-300'
                            : isTight
                              ? 'bg-amber-950/80 border border-amber-800/80 text-amber-300'
                              : 'bg-rose-950/80 border border-rose-800/80 text-rose-300'
                        }`}
                      >
                        {isBankable ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <XCircle className="w-3 h-3 text-rose-400" />
                        )}
                        <span>{p.dscr !== null ? `${p.dscr.toFixed(2)}x` : 'N/A'}</span>
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300">
                      ${formatCurrency(p.cashFlow)}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-slate-200">
                      {p.cashOnCash ? `${p.cashOnCash.toFixed(1)}%` : '0.0%'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (questionId === 'max_offer_dscr' || questionId === 'max_offer_irr') {
    const { askingPrice, solvedPrice, priceDelta, targetType, targetVal, baselineSummary, solvedSummary } =
      rawResult;
    const isDiscount = priceDelta < 0;

    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 space-y-4 shadow-xl">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <Tag className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-black text-white uppercase tracking-wider">
            Acquisition Basis Strike Price Comparison
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Asking Price Card */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
              Asking Listing Price
            </span>
            <div className="text-2xl font-black text-white font-mono">
              {formatCurrency(askingPrice)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-300 border-t border-slate-800 pt-2">
              <div>
                <span className="text-[10px] text-slate-500 block">DSCR</span>
                <span className="font-bold">{baselineSummary?.dscr ? `${baselineSummary.dscr.toFixed(2)}x` : 'N/A'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Cash-on-Cash</span>
                <span className="font-bold">{baselineSummary?.cashOnCash ? `${baselineSummary.cashOnCash.toFixed(1)}%` : '0.0%'}</span>
              </div>
            </div>
          </div>

          {/* Solved Strike Basis Card */}
          <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase text-emerald-400 tracking-wider">
                Target Strike Basis ({targetType === 'dscr' ? `${targetVal}x DSCR` : `${targetVal}% IRR`})
              </span>
              {isDiscount && (
                <span className="text-[10px] font-bold text-rose-300 bg-rose-950/60 border border-rose-800/40 px-2 py-0.5 rounded-full">
                  -{formatCurrency(Math.abs(priceDelta))} Discount
                </span>
              )}
            </div>
            <div className="text-2xl font-black text-emerald-300 font-mono">
              {formatCurrency(solvedPrice)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-300 border-t border-emerald-900/40 pt-2">
              <div>
                <span className="text-[10px] text-slate-500 block">Solved DSCR</span>
                <span className="font-bold text-emerald-300">
                  {solvedSummary?.dscr ? `${solvedSummary.dscr.toFixed(2)}x` : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Solved Cash-on-Cash</span>
                <span className="font-bold text-emerald-300">
                  {solvedSummary?.cashOnCash ? `${solvedSummary.cashOnCash.toFixed(1)}%` : '0.0%'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (questionId === 'rate_and_vacancy_stress') {
    const { breakEvenOcc, rateShockBps, vacancyShockPct } = rawResult;
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 space-y-4 shadow-xl">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <Activity className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-black text-white uppercase tracking-wider">
            Downside Shock Stress Breakdown
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-1.5">
            <span className="text-[10px] font-extrabold uppercase text-slate-400">
              Break-Even Occupancy
            </span>
            <div className="text-xl font-black text-white font-mono">{breakEvenOcc}%</div>
            <p className="text-[10px] text-slate-400">
              Operating costs & debt service are met above {breakEvenOcc}% occupancy.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-1.5">
            <span className="text-[10px] font-extrabold uppercase text-slate-400">
              Rate Hike Test
            </span>
            <div className="text-xl font-black text-amber-300 font-mono">+{rateShockBps} bps</div>
            <p className="text-[10px] text-slate-400">
              Tests impact if interest rates rise by 1.00% prior to financing lock.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-1.5">
            <span className="text-[10px] font-extrabold uppercase text-slate-400">
              Vacancy Shock Test
            </span>
            <div className="text-xl font-black text-emerald-300 font-mono">+{vacancyShockPct}%</div>
            <p className="text-[10px] text-slate-400">
              Tests impact of unexpected tenant departure or leasing lag.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
