import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DealRecord, DealMetrics, DealInputs } from '../../../lib/math/types';
import { supabase } from '../../../lib/supabase/client';
import { calculateMonthlyProjections } from '../../../lib/engine';
import { prepareEngineInputs } from '../../../lib/engine/compute';
import { formatCurrency } from '../../../lib/format';
import { getProjectionStartYear } from '../../../lib/studio/projectionYear';

interface ProFormaTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  onUpdateInputs?: (patch: Partial<DealInputs>) => void;
  /** Reload the deal after a pro-forma sync rewrote its inputs. */
  onReloadDeal?: () => void;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PRESETS: Array<[number, string]> = [[12, '1 Yr (12m)'], [24, '2 Yrs (24m)'], [36, '3 Yrs (36m)'], [60, '5 Yrs (60m)'], [120, '10 Yrs (120m)'], [180, '15 Yrs (180m)'], [360, '30 Yrs (360m)']];
const presetOn = 'btn-monthly-preset px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 transition shadow-sm';
const presetOff = 'btn-monthly-preset px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition';

const signed = (v: number) => `${v < 0 ? '-' : ''}${formatCurrency(Math.abs(v))}`;

export const ProFormaTab: React.FC<ProFormaTabProps> = ({ deal, metrics, onUpdateInputs, onReloadDeal }) => {
  const inputs: Record<string, any> = deal.inputs || {};
  const projections = (metrics.projections ?? []) as Array<Record<string, any>>;
  const startYr = getProjectionStartYear(deal);

  const [view, setView] = useState<'annual' | 'monthly'>('annual');
  const [months, setMonths] = useState<number>(parseInt(String(inputs.monthlyTotalMonths || 24), 10) || 24);
  const [endDate, setEndDate] = useState<string | null>(inputs.monthlyEndDate || null);
  const [showVarianceDetails, setShowVarianceDetails] = useState(false);
  const [actualMonthly, setActualMonthly] = useState<number | null>(null);

  // ---- Property Management vs Pro-Forma variance (live rent roll) ----
  useEffect(() => {
    let live = true;
    if (!deal.id) return;
    supabase.from('leases').select('monthly_rent').eq('deal_id', deal.id).eq('is_active', true).then(({ data }) => {
      if (!live) return;
      setActualMonthly(data && data.length > 0 ? data.reduce((s, l: any) => s + (parseFloat(l.monthly_rent) || 0), 0) : null);
    });
    return () => { live = false; };
  }, [deal.id, deal.updated_at]);

  const projAnnual = parseFloat(inputs.grossRentAnnual) || 0;
  const projMonthly = projAnnual > 0 ? projAnnual / 12 : (parseFloat(inputs.grossRentPerMonth) || parseFloat(inputs.monthlyRent) || 0);
  const actual = actualMonthly ?? 0;
  const varUsd = actual - projMonthly;
  const varPct = projMonthly > 0 ? (varUsd / projMonthly) * 100 : 0;
  const absPct = Math.abs(varPct);
  const accuracy = Math.max(0, Math.min(100, Math.round(100 - absPct)));
  const showVariance = actualMonthly !== null && !(projMonthly <= 0 && actual <= 0) && !(absPct < 5.0 || Math.abs(varUsd) < 100);

  // ---- Stub-year proration label ----
  const closing = String(inputs.closingDate || inputs.loiDate || '');
  const closingMonth = /(\d{4})-(\d{2})/.test(closing) ? parseInt(closing.split('-')[1], 10) : 10;
  const stubMonths = Math.max(1, 12 - closingMonth + 1);
  const prorateOn = !!inputs.prorateFirstYear;

  const toggleProrate = (checked: boolean) => {
    onUpdateInputs?.({ prorateFirstYear: checked, firstYearMonths: checked ? stubMonths : 12 } as Partial<DealInputs>);
  };

  // ---- Monthly schedule (engine) ----
  const monthly = useMemo(() => {
    if (view !== 'monthly') return null;
    try {
      const opts: Record<string, any> = { startDate: inputs.closingDate || '2026-10-01', totalMonths: months };
      if (endDate) opts.endDate = endDate;
      return calculateMonthlyProjections(String(deal.asset_class), prepareEngineInputs(deal), opts);
    } catch (e) {
      console.warn('[ProForma] monthly projection failed', e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, months, endDate, deal.inputs, deal.asset_class]);

  const setHorizon = (m: number) => { setMonths(Math.max(1, Math.min(360, m || 24))); setEndDate(null); };
  const effectiveMonths: number = monthly?.totalMonths ?? months;

  const exportCsv = () => {
    if (!monthly?.monthlyProjections?.length) return;
    const headers = ['Month #', 'Period', 'Operating Year', 'Gross Potential Rent', 'Vacancy Loss', 'Operating Expenses', 'Net Operating Income (NOI)', 'Debt Service Payment', 'Principal Paid', 'Interest Paid', 'Remaining Loan Balance', 'Net Cash Flow', 'Cumulative Cash Flow'];
    const rows = (monthly.monthlyProjections as any[]).map((r) => [r.monthNumber, `"${r.label}"`, r.operatingYear, r.grossIncome, r.vacancyLoss, r.operatingExpenses, r.netOperatingIncome, r.debtService, r.principalPaid, r.interestPaid, r.remainingLoanBalance, r.netCashFlow, r.cumulativeCashFlow].join(','));
    const blob = new Blob([[headers.join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(deal.title || 'deal').replace(/[^a-z0-9_-]/gi, '_')}_Monthly_CashFlow_Schedule_${monthly.startDateISO}_to_${monthly.endDateISO}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const parcelCount = Array.isArray(inputs.parcels) ? inputs.parcels.filter((p: any) => p.included).length : 1;
  const parcelSuffix = parcelCount > 1 ? ` (${parcelCount} Parcels Combined)` : '';

  return (
    <div className="space-y-6">
      {/* Property Management vs Pro-Forma variance */}
      {showVariance && (
        <div className="rounded-2xl bg-emerald-950/20 border border-emerald-800/40 p-3.5 sm:p-4 transition backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center space-x-2.5 min-w-0">
              <span className="text-base shrink-0">🍀</span>
              <div className="min-w-0">
                <span className="block text-xs font-bold text-white tracking-tight">Property Management vs. Underwritten Pro-Forma Variance</span>
                <span className="block text-[11px] text-emerald-300 font-mono mt-0.5 truncate">
                  In-Place Rent: <strong className="text-white font-mono">${Math.round(actual).toLocaleString()}/mo</strong> vs Pro-Forma: <strong className="text-white font-mono">${Math.round(projMonthly).toLocaleString()}/mo</strong>
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <Link to="/operations" className="px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-400 bg-emerald-950/70 border border-emerald-800 hover:bg-emerald-900 transition">Property Management →</Link>
              <button type="button" onClick={() => setShowVarianceDetails((v) => !v)} className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-300 bg-slate-900 border border-slate-800 hover:text-white transition">
                <span>{showVarianceDetails ? 'Hide Details ▴' : 'View Details ▾'}</span>
              </button>
            </div>
          </div>
          {showVarianceDetails && (
            <div className="mt-3 pt-3 border-t border-emerald-900/40 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-900">
                <span className="text-[10px] uppercase text-slate-400 font-sans font-bold block">In-Place Rent Roll</span>
                <span className="text-emerald-400 font-bold text-sm block mt-0.5">${Math.round(actual).toLocaleString()}/mo</span>
                <span className="text-[10px] text-slate-400 block">${Math.round(actual * 12).toLocaleString()}/yr</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-900">
                <span className="text-[10px] uppercase text-slate-400 font-sans font-bold block">Modeled Year 1 Pro-Forma</span>
                <span className="text-slate-200 font-bold text-sm block mt-0.5">${Math.round(projMonthly).toLocaleString()}/mo</span>
                <span className="text-[10px] text-slate-400 block">${Math.round(projMonthly * 12).toLocaleString()}/yr</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-900">
                <span className="text-[10px] uppercase text-slate-400 font-sans font-bold block">Revenue Variance</span>
                <span className={`font-bold text-sm block mt-0.5 ${absPct <= 2 ? 'text-emerald-400' : varUsd > 0 ? 'text-teal-400' : 'text-amber-400'}`}>{varUsd >= 0 ? '+' : ''}${Math.round(varUsd).toLocaleString()}/mo</span>
                <span className="text-[10px] block">{varPct >= 0 ? '+' : ''}{varPct.toFixed(1)}% spread • {accuracy}% Model Accuracy</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Forecast table */}
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl overflow-hidden">
        <div className="pb-4 border-b border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              {view === 'monthly' ? 'Granular Month-by-Month Schedule (Post-Closing)' : `Detailed ${projections.length}-Year Forecast Table`}
            </h3>
            <p className="text-xs text-slate-400">
              {view === 'monthly'
                ? 'Exact monthly debt service, principal paydown, and net cash distributions starting post-closing'
                : <>Granular breakdowns of financials, equity accumulation, and returns{projections.length > 0 && <> • Starting Basis: <span className="text-emerald-400 font-bold">{formatCurrency(projections[0].propertyValue)}</span>{parcelSuffix}</>}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center space-x-2 text-xs font-semibold text-slate-300 cursor-pointer bg-slate-950/70 px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 transition" title="Prorate Year 1 for the post-closing stub period">
              <input type="checkbox" checked={prorateOn} onChange={(e) => toggleProrate(e.target.checked)} className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-emerald-500 w-3.5 h-3.5" />
              <span className="text-[11px]">Prorate {startYr} ({MONTH_NAMES[closingMonth - 1]}–Dec Stub: {stubMonths} Mo)</span>
            </label>
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button type="button" onClick={() => setView('annual')}
                className={view === 'annual' ? 'px-3 py-1 text-xs font-bold rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 transition' : 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-slate-200 transition'}>📅 Annual Pro-Forma</button>
              <button type="button" onClick={() => setView('monthly')}
                className={view === 'monthly' ? 'px-3 py-1 text-xs font-bold rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 transition' : 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-slate-200 transition'}>📆 Monthly Schedule (Post-Closing)</button>
            </div>
          </div>
        </div>

        {view === 'annual' ? (
          <div className="overflow-x-auto -mx-5 mt-4">
            <table className="w-full text-left border-collapse text-[11px] tabular-nums whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-900 text-slate-400 font-semibold bg-slate-950/60">
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-3 sticky left-0 bg-slate-950 z-20 border-r border-slate-800/80 shadow-md">Date / Period</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Property Value</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Gross Income</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Vacancy Loss</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Expenses</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">NOI</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Debt Service</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Cash Flow</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Cash-on-Cash</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Cap Rate</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2">Loan Balance</th>
                  <th className="whitespace-normal leading-tight align-bottom py-3 px-2 pr-3">Equity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/60">
                {projections.map((p) => {
                  const stub = p.operatingMonths && p.operatingMonths < 12;
                  return (
                    <tr key={p.year} className="border-b border-slate-900/40 hover:bg-slate-900/20 text-slate-300 font-medium transition">
                      <td className="py-3 px-3">
                        <div className="text-white font-bold text-xs flex items-center">
                          {startYr + p.year - 1}
                          {stub && <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded ml-1">Stub: {p.operatingMonths} Mo</span>}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">Year {p.year}{stub ? ` (${p.operatingMonths} operating months)` : ''}</div>
                      </td>
                      <td className="py-3.5 px-2">{formatCurrency(p.propertyValue)}</td>
                      <td className="py-3.5 px-2">{formatCurrency(p.grossPotentialIncome)}</td>
                      <td className="py-3.5 px-2 text-rose-400/85">{formatCurrency(p.vacancyLoss)}</td>
                      <td className="py-3.5 px-2 text-slate-400">{formatCurrency(p.operatingExpenses)}</td>
                      <td className="py-3.5 px-2 text-white font-semibold">{formatCurrency(p.netOperatingIncome)}</td>
                      <td className="py-3.5 px-2 text-slate-500">{formatCurrency(p.debtService)}</td>
                      <td className={`py-3.5 px-2 font-bold ${p.cashFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(p.cashFlow)}</td>
                      <td className="py-3.5 px-2">
                        {p.isCoCNotMeaningful
                          ? <span className="text-slate-400 font-bold" title="100% Debt Financed - Zero Initial Outlay">N/M</span>
                          : `${(Number(p.cashOnCash) || 0).toFixed(1)}%`}
                      </td>
                      <td className="py-3.5 px-2">{(Number(p.capRate) || 0).toFixed(1)}%</td>
                      <td className="py-3.5 px-2 text-slate-500">{formatCurrency(p.loanBalanceRemaining ?? p.endingLoanBalance)}</td>
                      <td className="py-3.5 px-2 pr-3 text-brand-400 font-bold">{formatCurrency(p.equity)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 space-y-3.5 shadow-lg">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold text-sm">📆</div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="text-xs font-black uppercase tracking-wider text-white">Monthly Cash Flow Projection Horizon</h4>
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{effectiveMonths} Months ({(effectiveMonths / 12).toFixed(1)} Yrs)</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {monthly ? `${monthly.startMonthName} ${monthly.startYear} ➔ ${monthly.endMonthName} ${monthly.endYear} (${effectiveMonths} Consecutive Months)` : 'Stretch projections across any custom month & year date range'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="flex items-center space-x-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-500">From (Closing):</span>
                    <span className="font-mono font-bold text-slate-300 text-xs">{monthly ? `${monthly.startMonthName} ${monthly.startYear}` : '—'}</span>
                  </div>
                  <div className="flex items-center space-x-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-emerald-500/30">
                    <label htmlFor="pf-end-date" className="text-[10px] uppercase font-bold text-emerald-400">Stretch To Date:</label>
                    <input type="month" id="pf-end-date" value={monthly?.endDateISO || endDate || ''} onChange={(e) => e.target.value && setEndDate(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-emerald-500" />
                  </div>
                  <button type="button" onClick={exportCsv} className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex items-center space-x-1">
                    <span>📥</span><span>Export CSV</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-slate-900 text-xs">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="text-[10px] uppercase font-bold text-slate-500 mr-1">Quick Presets:</span>
                  {PRESETS.map(([m, label]) => (
                    <button key={m} type="button" onClick={() => setHorizon(m)} className={effectiveMonths === m ? presetOn : presetOff}>{label}</button>
                  ))}
                  <button type="button" onClick={() => setHorizon(parseInt(String(inputs.holdingPeriod ?? inputs.exitYear), 10) * 12)}
                    className="btn-monthly-preset px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-800 text-emerald-300 transition" title="Match underwriting exit hold period">🎯 Match Exit Hold</button>
                </div>
                <div className="flex items-center space-x-2 w-full sm:w-64">
                  <span className="text-[10px] font-mono text-slate-500">1m</span>
                  <input type="range" min={1} max={360} value={effectiveMonths} onChange={(e) => setHorizon(parseInt(e.target.value, 10))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-900 rounded-lg cursor-pointer" />
                  <span className="text-[10px] font-mono text-slate-500">360m</span>
                </div>
              </div>

              {monthly?.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-2 border-t border-slate-900 text-center">
                  {[
                    ['Total Gross Rent', formatCurrency(monthly.summary.totalGrossIncome), 'text-white'],
                    ['Total NOI', formatCurrency(monthly.summary.totalNOI), 'text-emerald-400'],
                    ['Total Debt Service', formatCurrency(monthly.summary.totalDebtService), 'text-slate-300'],
                    ['Principal Paydown', formatCurrency(monthly.summary.totalPrincipalPaid), 'text-cyan-400'],
                    ['Cumulative Net Cash', signed(monthly.summary.netCumulativeCashFlow), monthly.summary.netCumulativeCashFlow < 0 ? 'text-rose-400' : 'text-emerald-400'],
                    ['Ending Loan Balance', formatCurrency(monthly.summary.endingLoanBalance), 'text-slate-300'],
                  ].map(([label, value, color]) => (
                    <div key={label} className="bg-slate-900/60 p-2 rounded-xl border border-slate-900">
                      <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
                      <div className={`text-xs font-black ${color}`}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="overflow-x-auto max-h-[600px] overflow-y-auto -mx-5 rounded-b-xl">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-950">
                    <th className="py-3 px-5 sticky left-0 bg-slate-950 z-20 border-r border-slate-800/80 shadow-md">Month / Date</th>
                    <th className="py-3 px-4">Operating Yr</th>
                    <th className="py-3 px-4">Gross Income</th>
                    <th className="py-3 px-4">Vacancy Loss</th>
                    <th className="py-3 px-4">OpEx</th>
                    <th className="py-3 px-4">NOI</th>
                    <th className="py-3 px-4">Debt Payment</th>
                    <th className="py-3 px-4">Principal</th>
                    <th className="py-3 px-4">Interest</th>
                    <th className="py-3 px-4">Loan Balance</th>
                    <th className="py-3 px-4">Monthly Net Cash</th>
                    <th className="py-3 px-4 pr-5">Cumulative Cash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/60">
                  {((monthly?.monthlyProjections as any[]) || []).map((m) => (
                    <tr key={m.monthNumber} className="border-b border-slate-900/40 hover:bg-slate-900/30 text-slate-300 font-medium transition">
                      <td className="py-3 px-5">
                        <div className="text-white font-bold text-xs">{m.label}</div>
                        <div className="text-[10px] text-slate-500 font-mono">Month {m.monthNumber}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 font-mono">Yr {m.operatingYear}</td>
                      <td className="py-3.5 px-4">{formatCurrency(m.grossIncome)}</td>
                      <td className="py-3.5 px-4 text-rose-400/85">{formatCurrency(m.vacancyLoss)}</td>
                      <td className="py-3.5 px-4 text-slate-400">{formatCurrency(m.operatingExpenses)}</td>
                      <td className="py-3.5 px-4 text-white font-semibold">{formatCurrency(m.netOperatingIncome)}</td>
                      <td className="py-3.5 px-4 text-slate-400">{formatCurrency(m.debtService)}</td>
                      <td className="py-3.5 px-4 text-cyan-400 font-medium">{formatCurrency(m.principalPaid)}</td>
                      <td className="py-3.5 px-4 text-slate-500">{formatCurrency(m.interestPaid)}</td>
                      <td className="py-3.5 px-4 text-slate-400 font-mono">{formatCurrency(m.remainingLoanBalance)}</td>
                      <td className={`py-3.5 px-4 font-bold ${m.netCashFlow < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{signed(m.netCashFlow)}</td>
                      <td className={`py-3.5 px-4 pr-5 font-bold ${m.cumulativeCashFlow < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{signed(m.cumulativeCashFlow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
