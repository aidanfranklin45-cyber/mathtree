import React, { useMemo, useState } from 'react';
import type { DealMetrics, DealRecord, TaxMetrics } from '../../../lib/math/types';
import { calculateHoldingPeriodWealth, calculateRefinanceEvent, calculateTaxAndDepreciation } from '../../../lib/engine';
import { prepareEngineInputs } from '../../../lib/engine/compute';
import { getProjectionStartYear } from '../../../lib/studio/projectionYear';
import { formatCurrency } from '../../../lib/format';

interface TaxTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  tax?: TaxMetrics;
}

/** Everything on this tab is derived on demand from the deal's inputs; nothing is stored. */
export const TaxTab: React.FC<TaxTabProps> = ({ deal, metrics }) => {
  const asset = String(deal.asset_class ?? 'commercial');
  const startYr = getProjectionStartYear(deal);
  const maxYear = metrics.projections.length;

  const [costSeg, setCostSeg] = useState<boolean>(
    (deal.inputs as any)?.enableCostSeg === true || (deal.inputs as any)?.enableCostSeg === 'true',
  );
  const [holdYearSel, setHoldYearSel] = useState<number>(maxYear);
  const [refiYear, setRefiYear] = useState('5');
  const [refiLtv, setRefiLtv] = useState('75');
  const [refiRate, setRefiRate] = useState('6.5');
  const [refiApplied, setRefiApplied] = useState({ year: 5, ltv: 75, rate: 6.5 });

  const inputs = useMemo(() => prepareEngineInputs(deal), [deal]);

  const milestones = useMemo(() => {
    const m = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30].filter((y) => y <= maxYear);
    if (!m.includes(maxYear)) m.push(maxYear);
    return m.sort((a, b) => a - b);
  }, [maxYear]);
  const holdYear = milestones.includes(holdYearSel) ? holdYearSel : maxYear;

  const taxRes = useMemo(
    () => calculateTaxAndDepreciation(asset, { ...inputs, enableCostSeg: costSeg }, metrics),
    [asset, inputs, costSeg, metrics],
  );
  const wealth = useMemo(
    () => calculateHoldingPeriodWealth(inputs, metrics.projections, (metrics as any).amortizationSchedule, holdYear),
    [inputs, metrics, holdYear],
  );
  const refiRes = useMemo(
    () => calculateRefinanceEvent(asset, inputs, refiApplied.year, refiApplied.ltv, refiApplied.rate, 30),
    [asset, inputs, refiApplied],
  );

  const isDeficit = !!wealth && (wealth.isDeficit || wealth.cumulativeCashFlow < 0);

  return (
    <div className="space-y-6">
      {wealth && (
        <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl overflow-hidden space-y-4">
          <div className="pb-3 border-b border-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center space-x-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                <span>Amortization Wealth & Equity Realization</span>
              </h3>
              <p className="text-xs text-slate-400">Track realized equity from tenant debt paydown, market appreciation, and cumulative cash flow</p>
            </div>
            <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
              <label htmlFor="input-wealth-hold-year" className="text-[11px] font-bold text-slate-400">Hold Period:</label>
              <select
                id="input-wealth-hold-year"
                value={holdYear}
                onChange={(e) => setHoldYearSel(parseInt(e.target.value, 10))}
                className="bg-slate-900 border border-slate-700 text-xs font-bold text-white rounded-lg px-2 py-1 focus:outline-none focus:border-brand-500"
              >
                {milestones.map((y) => (
                  <option key={y} value={y}>{startYr + y - 1} (Year {y}{y === maxYear ? ' - Full Hold' : ''})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Tenant Debt Paydown</span>
              <span className="text-base font-black text-emerald-400 mt-1 block">{formatCurrency(wealth.principalPaydownEquity)}</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Forced equity savings</span>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Appreciation Gain</span>
              <span className="text-base font-black text-cyan-400 mt-1 block">{formatCurrency(wealth.appreciationEquity)}</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Asset value growth</span>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Cumulative Cash Flow</span>
              <span className={`text-base font-black mt-1 block ${isDeficit ? 'text-rose-400' : 'text-emerald-400'}`}>
                {isDeficit ? `-${formatCurrency(Math.abs(wealth.cumulativeCashFlow))}` : formatCurrency(wealth.cumulativeCashFlow)}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">{isDeficit ? 'Deficit funded out-of-pocket' : 'Cash pocketed to date'}</span>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Net Owned Equity (NAV)</span>
              <span className="text-base font-black text-brand-400 mt-1 block">{formatCurrency(wealth.totalNetEquity)}</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                {formatCurrency(wealth.propertyValue)} val - {formatCurrency(wealth.remainingLoanBalance)} debt
              </span>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-emerald-900/60 bg-emerald-950/10">
              <span className="text-[10px] uppercase font-bold text-emerald-400 block">Total Net Wealth</span>
              <span className="text-base font-black text-emerald-400 mt-1 block">{formatCurrency(wealth.totalNetBenefit)}</span>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                {wealth.initialCashInvested > 0
                  ? `NAV + Cash (${wealth.netProfit >= 0 ? '+' : ''}${formatCurrency(wealth.netProfit)} profit)`
                  : 'NAV + Cash (100% Financed)'}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-400 bg-slate-950/40 p-2.5 rounded-xl border border-slate-900 gap-2">
            <span>
              By {startYr + holdYear - 1} (Year {holdYear}), tenant mortgage payments pay down{' '}
              <strong className="text-emerald-400">{formatCurrency(wealth.principalPaydownEquity)}</strong> of principal while property value reaches{' '}
              <strong className="text-white">{formatCurrency(wealth.propertyValue)}</strong>, accumulating{' '}
              <strong className="text-emerald-400">{formatCurrency(wealth.totalNetBenefit)}</strong> in total net wealth ({formatCurrency(wealth.totalNetEquity)} owned equity{' '}
              {isDeficit ? (
                <>minus <strong className="text-rose-400">{formatCurrency(wealth.cashDeficit || Math.abs(wealth.cumulativeCashFlow))}</strong> cumulative operating deficit funded out-of-pocket</>
              ) : (
                <>+ {formatCurrency(wealth.cumulativeCashFlow)} cash pocketed</>
              )}
              {wealth.initialCashInvested > 0 && (
                <>; <strong className="text-emerald-400">{wealth.netProfit >= 0 ? '+' : ''}{formatCurrency(wealth.netProfit)}</strong> net profit over {formatCurrency(wealth.initialCashInvested)} outlay</>
              )}).
            </span>
            <span className="text-slate-400 font-mono text-[10px] shrink-0">Hold NPV: <strong className="text-white">{formatCurrency(wealth.holdNpv)}</strong></span>
          </div>
        </div>
      )}

      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-900 pb-3 gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-emerald"></span>
              <span>Tax Depreciation (MACRS) & After-Tax ROI</span>
            </h3>
            <p className="text-xs text-slate-400">Straight-line depreciation, Cost Segregation, tax shields, and exit tax liabilities</p>
          </div>
          <div className="flex items-center space-x-3 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-900">
            <label className="text-xs font-bold text-slate-300 flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                aria-label="Enable Cost Segregation (80% Bonus Yr 1)"
                checked={costSeg}
                onChange={(e) => setCostSeg(e.target.checked)}
                className="rounded bg-slate-900 border-slate-800 text-brand-500 focus:ring-brand-500"
              />
              <span>Enable Cost Segregation (80% Bonus Yr 1)</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Depreciable Basis</p>
            <p className="text-base font-extrabold text-white mt-1">{formatCurrency(taxRes.depreciableBasis)}</p>
          </div>
          <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Annual Depreciation</p>
            <p className="text-base font-extrabold text-accent-emerald mt-1">{formatCurrency(taxRes.annualDepreciation)}/yr</p>
          </div>
          <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
            <p className="text-[10px] font-bold text-slate-500 uppercase">After-Tax IRR</p>
            <p className="text-base font-extrabold text-accent-violet mt-1">{taxRes.afterTaxIrr.toFixed(2)}%</p>
          </div>
          <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Exit Tax Liability</p>
            <p className="text-base font-extrabold text-accent-rose mt-1">{formatCurrency(taxRes.totalExitTax)}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-900 text-slate-400 font-semibold bg-slate-950/80">
                <th className="py-2.5 px-4 sticky left-0 bg-slate-950 z-20 border-r border-slate-800/80 shadow-md">Date / Period</th>
                <th className="py-2.5 px-4">NOI</th>
                <th className="py-2.5 px-4">Interest Expense</th>
                <th className="py-2.5 px-4 text-accent-emerald">Depreciation</th>
                <th className="py-2.5 px-4">Taxable Income</th>
                <th className="py-2.5 px-4">Tax Liability / Shield</th>
                <th className="py-2.5 px-4 text-white font-bold">After-Tax Cash Flow</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/60">
              {taxRes.yearlyTaxDetails.map((row: any) => (
                <tr key={row.year} className="hover:bg-slate-900/30 transition">
                  <td className="py-2.5 px-4 font-bold text-white">
                    <div>{startYr + row.year - 1}</div>
                    <div className="text-[10px] text-slate-500 font-medium">Year {row.year}</div>
                  </td>
                  <td className="py-2.5 px-4">{formatCurrency(row.noi)}</td>
                  <td className="py-2.5 px-4">{formatCurrency(row.interestExpense)}</td>
                  <td className="py-2.5 px-4 text-accent-emerald font-semibold">{formatCurrency(row.depreciation)}</td>
                  <td className="py-2.5 px-4">{formatCurrency(row.taxableIncome)}</td>
                  <td className={`py-2.5 px-4 ${row.taxLiability > 0 ? 'text-amber-400' : 'text-brand-400 font-bold'}`}>
                    {row.taxLiability > 0 ? formatCurrency(row.taxLiability) : `${formatCurrency(Math.abs(row.taxLiability))} (Shield)`}
                  </td>
                  <td className="py-2.5 px-4 text-white font-bold">{formatCurrency(row.afterTaxCashFlow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
        <div className="flex justify-between items-center border-b border-slate-900 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-cyan"></span>
              <span>Mid-Hold Refinance & BRRRR Strategy Simulation</span>
            </h3>
            <p className="text-xs text-slate-400">Model cash-out refinance events to retrieve invested equity mid-hold</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-900">
          <div>
            <label htmlFor="refi-input-year" className="text-xs font-semibold text-slate-400">Refinance Year</label>
            <select id="refi-input-year" value={refiYear} onChange={(e) => setRefiYear(e.target.value)} className="w-full mt-1 bg-slate-900 border border-slate-800 text-xs text-white rounded-lg p-2">
              <option value="3">Year 3</option>
              <option value="5">Year 5</option>
              <option value="7">Year 7</option>
            </select>
          </div>
          <div>
            <label htmlFor="refi-input-ltv" className="text-xs font-semibold text-slate-400">New Refi LTV (%)</label>
            <input type="number" id="refi-input-ltv" value={refiLtv} onChange={(e) => setRefiLtv(e.target.value)} className="w-full mt-1 bg-slate-900 border border-slate-800 text-xs text-white rounded-lg p-2" />
          </div>
          <div>
            <label htmlFor="refi-input-rate" className="text-xs font-semibold text-slate-400">New Interest Rate (%)</label>
            <input type="number" step="any" id="refi-input-rate" value={refiRate} onChange={(e) => setRefiRate(e.target.value)} className="w-full mt-1 bg-slate-900 border border-slate-800 text-xs text-white rounded-lg p-2" />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() =>
                setRefiApplied({
                  year: parseInt(refiYear, 10) || 5,
                  ltv: parseFloat(refiLtv) || 75,
                  rate: parseFloat(refiRate) || 6.5,
                })
              }
              className="w-full py-2 bg-brand-600 hover:bg-brand-500 text-xs font-bold text-white rounded-lg transition"
            >
              Simulate Cash-Out
            </button>
          </div>
        </div>

        {refiRes.refiYear !== undefined && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">{startYr + refiRes.refiYear - 1} (Year {refiRes.refiYear}) Refi Value</p>
              <p className="text-base font-extrabold text-white mt-1">{formatCurrency(refiRes.refiValue)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Net Cash-Out Proceeds</p>
              <p className="text-base font-extrabold text-brand-400 mt-1">{formatCurrency(refiRes.netCashOut)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Post-Refi Annual Debt</p>
              <p className="text-base font-extrabold text-accent-rose mt-1">{formatCurrency(refiRes.newAnnualDebtService)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">BRRRR Accelerated IRR</p>
              <p className="text-base font-extrabold text-accent-violet mt-1">{refiRes.refiIrr.toFixed(2)}%</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
