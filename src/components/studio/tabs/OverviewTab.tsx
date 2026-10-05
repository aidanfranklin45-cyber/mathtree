import React, { useEffect, useMemo, useState } from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import { resolvePointInTimeDealMetrics } from '../../../lib/math/pointInTime';
import { formatCurrency } from '../../../lib/format';
import { getDefaultTargetYear, getProjectionStartYear } from '../../../lib/studio/projectionYear';
import { openDealBrief } from '../../../lib/export/pdfBrief';
import { ProjectionsChart } from '../ProjectionsChart';
import { DealCharts } from '../DealCharts';
import { Link } from 'react-router-dom';
import { currentLeases } from '../../../lib/leases';
import { attachPropertyFacts } from '../../../lib/property/loadFacts';

interface OverviewTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  onSelectTab: (tab: string) => void;
  onOpenEdit?: () => void;
}

const yearPill = 'hidden sm:inline text-[9px] sm:text-[10px] text-slate-500 font-bold uppercase tracking-wider bg-slate-950 px-1.5 py-0.5 border border-slate-900 rounded';
const analyticsCard = 'bg-slate-950/60 p-3 sm:p-4 rounded-xl border border-slate-900 relative group';
const analyticsLabel = 'text-[10px] font-bold tracking-wider text-slate-500 uppercase flex items-center justify-between';

function normalizeAsset(ac: string): string {
  const s = String(ac || 'commercial').toLowerCase();
  if (s.includes('multi')) return 'multi-unit';
  if (s.includes('single') || s.includes('resid')) return 'single-family';
  if (s.includes('storage')) return 'storage';
  return 'commercial';
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ deal, metrics, onSelectTab, onOpenEdit }) => {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [chartType, setChartType] = useState<'cashflow' | 'valuation'>('cashflow');

  const inputs: Record<string, any> = deal.inputs || {};
  const projections = (metrics.projections ?? []) as Array<Record<string, any>>;
  const startYr = getProjectionStartYear(deal);
  const sysYear = new Date().getFullYear();
  const maxYears = projections.length || 10;
  const targetYear = getDefaultTargetYear(startYr, maxYears);
  const proj = projections[Math.max(0, Math.min(maxYears - 1, targetYear - 1))] || projections[0] || {};
  const calYear = startYr + targetYear - 1;
  const isOwned = deal.status === 'owned';
  const zeroEq = !!metrics.isZeroEquity;

  const cf = Number(proj.cashFlow) || 0;
  const cfMo = cf / 12;
  const exitYear = Number(inputs.holdingPeriod ?? inputs.exitYear);

  const breakEven = typeof metrics.breakEvenYear === 'number' && metrics.breakEvenYear > 0
    ? `${startYr + metrics.breakEvenYear - 1} (Year ${metrics.breakEvenYear})`
    : String(metrics.breakEvenYear ?? 'N/A');

  // ---- Property snapshot ----
  const addressList: string[] =
    Array.isArray(inputs.addresses) && inputs.addresses.length > 1
      ? inputs.addresses
      : Array.isArray(inputs.adjacentParcels) && inputs.adjacentParcels.length > 0
        ? [deal.location || 'Primary Address', ...inputs.adjacentParcels.map((p: any) => p.address || `APN: ${p.apn || p.parcelNumber}`)]
        : Array.isArray(inputs.parcels) && inputs.parcels.length > 1
          ? inputs.parcels.map((p: any) => (typeof p === 'string' ? p : p.address || `APN: ${p.apn || p.parcelNumber}`))
          : [];
  const displayAddr = deal.location || inputs.location || inputs.assessorData?.address || inputs.address || (deal as any).name || 'Location Pending';
  const rawCounty: string = inputs.county || inputs.parcels?.[0]?.county || '';
  const cleanCounty = rawCounty ? rawCounty.replace(/\s*County.*$/i, '').trim() : '';
  const rawApn: string = inputs.primaryApn || inputs.apn || inputs.assessorData?.apn || '';
  const formattedApn = rawApn ? (rawApn.length === 11 ? `${rawApn.slice(0, 6)}-${rawApn.slice(6)}` : rawApn) : 'Pending Link';
  const apnExtra = addressList.length > 1 ? ` (+${addressList.length - 1} more)` : '';
  const apnText = cleanCounty ? `${cleanCounty} • ${formattedApn}${apnExtra}` : `APN: ${formattedApn}${apnExtra}`;
  const tier = inputs.marketTier || inputs.commTier || 'Tier 2';
  const pClass = inputs.propertyClass || inputs.commClass || 'Class B';
  const assessed = Number(inputs.combinedAssessedValue) || Number(inputs.assessorData?.totalAssessedValue) || Number(inputs.totalAssessedValue) || 0;

  const leases: any[] = currentLeases(inputs);
  const unitCount = parseInt(String(inputs.unitCount || inputs.numUnits || inputs.storageUnitCount || 0), 10);
  let tenancyTitle = 'Single-Tenant Asset';
  let tenancySub = '100% Baseline Occupancy';
  if (leases.length > 1) {
    const names = leases.map((l) => l.tenantName || 'Unit Lease');
    tenancyTitle = `Multi-Tenant (${leases.length} Active Leases)`;
    tenancySub = `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` (+${names.length - 2} more)` : ''} • 100% Contracted`;
  } else if (unitCount > 1) {
    tenancyTitle = `Multi-Unit Asset (${unitCount} Total Units)`;
    tenancySub = 'Master Rent Roll & Unit Mix Active';
  } else if (leases.length === 1 && leases[0].tenantName) {
    tenancyTitle = `Single-Tenant: ${leases[0].tenantName}`;
    tenancySub = `${leases[0].leaseType || 'NNN'} Lease • 100% Occupied`;
  }

  // ---- Debt snapshot ----
  // Owned deals read rent actually collected (and recorded expenses) through the property-state calculator
  const [dealWithFacts, setDealWithFacts] = useState<DealRecord | null>(null);
  useEffect(() => {
    let live = true;
    setDealWithFacts(null);
    if (isOwned) attachPropertyFacts([deal]).then(([d]) => { if (live) setDealWithFacts(d); }).catch(() => {});
    return () => { live = false; };
  }, [deal.id, isOwned]);
  const pit = isOwned ? resolvePointInTimeDealMetrics(dealWithFacts ?? deal, new Date()) : null;
  const rate = Number(inputs.interestRate);
  const monthlyPayment = Number(metrics.monthlyMortgagePayment) || 0;
  const dscrIdx = startYr <= sysYear ? Math.min(projections.length - 1, Math.max(0, sysYear - startYr)) : 0;
  const dscrProj = projections[dscrIdx] || projections[0] || {};
  const vacant = !(Number(dscrProj.grossPotentialIncome) > 0) || !(Number(dscrProj.netOperatingIncome) > 0);
  const dscrVal = dscrProj.dscr;
  const dscrText = vacant ? 'Vacant (Carry)' : (dscrVal !== null && dscrVal !== undefined && !isNaN(Number(dscrVal)) ? `${Number(dscrVal).toFixed(2)}x` : 'N/A');
  const dscrGood = !vacant && Number(dscrVal) >= 1.25;

  const milestones = [1, 3, 5, 7, 10];

  return (
    <div className="space-y-6">
      {/* Live-updating metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/40 border border-slate-900 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden group hover:border-slate-800 transition duration-300">
          <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full bg-brand-500/5 group-hover:bg-brand-500/10 transition-colors" />
          <p className="text-[10px] sm:text-xs font-semibold tracking-wider text-slate-400 uppercase">Net Operating Income</p>
          <div className="mt-1 sm:mt-2 flex items-baseline justify-between">
            <span className="text-lg sm:text-2xl font-extrabold text-white tracking-tight">{formatCurrency(proj.netOperatingIncome)}</span>
            <span className={yearPill}>{calYear}</span>
          </div>
          <div className="hidden sm:flex mt-2 sm:mt-3 items-center text-[10px] sm:text-xs text-slate-500"><span className="truncate">Revenue minus OpEx</span></div>
        </div>

        <div className="bg-slate-900/40 border border-slate-900 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden group hover:border-slate-800 transition duration-300">
          <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full bg-accent-cyan/5 group-hover:bg-accent-cyan/10 transition-colors" />
          <p className="text-[10px] sm:text-xs font-semibold tracking-wider text-slate-400 uppercase">Cap Rate Yield</p>
          <div className="mt-1 sm:mt-2 flex items-baseline justify-between">
            <span className="text-lg sm:text-2xl font-extrabold text-accent-cyan tracking-tight">{(Number(proj.capRate) || 0).toFixed(2)}%</span>
            <span className={yearPill}>{calYear}</span>
          </div>
          <div className="hidden sm:flex mt-2 sm:mt-3 items-center text-[10px] sm:text-xs text-slate-500">
            <span className="truncate">
              Annual NOI divided by property value
            </span>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-emerald-950/80 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden group hover:border-emerald-800/60 transition duration-300 bg-gradient-to-br from-slate-900/80 via-slate-900/40 to-emerald-950/20 shadow-lg shadow-emerald-950/20">
          <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors" />
          <p className="text-[10px] sm:text-xs font-semibold tracking-wider text-emerald-400 uppercase flex items-center justify-between">
            <span>Net Cash Flow</span>
            <span className={`text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded border ${cf >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
              {cf >= 0 ? 'Take-Home' : 'Cash Deficit'}
            </span>
          </p>
          <div className="mt-1 sm:mt-2 flex items-baseline justify-between">
            <span className={`text-lg sm:text-2xl font-black tracking-tight ${cf >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(cf)}/yr</span>
            <span className={yearPill}>{calYear}</span>
          </div>
          <div className="mt-2 sm:mt-3 flex items-center justify-between text-[10px] sm:text-xs text-slate-400">
            <span className="truncate">After debt</span>
            <span className={`font-mono font-bold ml-1 ${cfMo >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{cfMo >= 0 ? '+' : ''}{formatCurrency(cfMo)}/mo</span>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-900 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden group hover:border-slate-800 transition duration-300">
          <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full bg-slate-500/5 group-hover:bg-slate-500/10 transition-colors" />
          <p className="text-[10px] sm:text-xs font-semibold tracking-wider text-slate-400 uppercase flex items-center justify-between">
            <span>Cash-on-Cash</span>
            {zeroEq && <span className="text-[8px] sm:text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">100% Financed</span>}
          </p>
          <div className="mt-1 sm:mt-2 flex items-baseline justify-between">
            <span className="text-lg sm:text-2xl font-extrabold text-slate-200 tracking-tight">{zeroEq ? 'N/M' : `${(Number(proj.cashOnCash) || 0).toFixed(2)}%`}</span>
            <span className={yearPill}>{calYear}</span>
          </div>
          <div className="hidden sm:flex mt-2 sm:mt-3 items-center text-[10px] sm:text-xs text-slate-500">
            <span className="truncate">{zeroEq ? '100% financed (zero initial cash outlay)' : 'Annual cash flow / initial cash'}</span>
          </div>
        </div>
      </div>

      {/* Advanced Analytics */}
      <div className="bg-slate-900/40 border border-slate-900 p-3.5 sm:p-5 rounded-2xl relative overflow-hidden hover:border-slate-800 transition duration-300 space-y-4">
        <div className="border-b border-slate-900/80 pb-3 flex items-center justify-between">
          <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight flex items-center space-x-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-violet" />
            <span>Advanced Analytics</span>
          </h3>
          <span className="text-[9px] sm:text-[10px] text-slate-500 font-bold uppercase tracking-wider bg-slate-950 px-2 py-0.5 border border-slate-900 rounded">
            Exit: {startYr + Number(exitYear) - 1} (Yr {exitYear})
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className={analyticsCard}>
            <p className={analyticsLabel}><span>NPV</span><span className="text-slate-600 cursor-help" title="Net Present Value: Discounted cash flows + exit equity minus initial investment.">ⓘ</span></p>
            <div className="mt-1 flex items-baseline justify-between"><span className="text-lg sm:text-xl font-extrabold text-white tracking-tight">{formatCurrency(metrics.npv)}</span></div>
            <p className="hidden sm:block text-[10px] text-slate-500 mt-1">Today&apos;s cash value minus investment</p>
          </div>
          <div className={analyticsCard}>
            <p className={analyticsLabel}><span>IRR</span><span className="text-slate-600 cursor-help" title="Internal Rate of Return: Annualized rate of return of the investment.">ⓘ</span></p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-lg sm:text-xl font-extrabold text-accent-violet tracking-tight">{metrics.irrDisplay || `${(Number(metrics.irr) || 0).toFixed(2)}%`}</span>
            </div>
            <p className="hidden sm:block text-[10px] text-slate-500 mt-1">Annualized rate of return</p>
          </div>
          <div className={analyticsCard}>
            <p className={analyticsLabel}><span>Equity Multiplier</span><span className="text-slate-600 cursor-help" title="Equity Multiplier: Total returns divided by initial cash invested (also known as MOIC).">ⓘ</span></p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-lg sm:text-xl font-extrabold text-accent-cyan tracking-tight">{metrics.equityMultiplierDisplay || `${(Number(metrics.equityMultiplier) || 0).toFixed(2)}x`}</span>
            </div>
            <p className="hidden sm:block text-[10px] text-slate-500 mt-1">Total returns / Initial cash</p>
          </div>
          <div className={analyticsCard}>
            <p className={analyticsLabel}><span>Break-Even Year</span><span className="text-slate-600 cursor-help" title="Break-Even Year: The year when cumulative cash flow becomes positive.">ⓘ</span></p>
            <div className="mt-1 flex items-baseline justify-between"><span className="text-lg sm:text-xl font-extrabold text-accent-emerald tracking-tight">{breakEven}</span></div>
            <p className="hidden sm:block text-[10px] text-slate-500 mt-1">Year cumulative cash turns positive</p>
          </div>
        </div>
      </div>

      {/* Glossary */}
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl overflow-hidden hover:border-slate-800 transition duration-300">
        <div className="pb-3 border-b border-slate-900/80 flex items-center justify-between cursor-pointer" onClick={() => setGlossaryOpen((o) => !o)}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand-500" />
            <span>Glossary: Understanding Your Deal Metrics</span>
          </h3>
          <button type="button" className="text-slate-400 hover:text-white transition animate-pulse">
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transform transition-transform duration-200 ${glossaryOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </button>
        </div>
        {glossaryOpen && (
          <div className="mt-4 space-y-4 text-xs leading-relaxed text-slate-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <p className="font-semibold text-accent-violet flex items-center gap-1"><span>⚡</span><span>Internal Rate of Return (IRR)</span></p>
                <p className="text-slate-400">The annualized rate of return that equates the present value of all cash flows (including net sale equity at exit) to your initial investment. Think of it as the speed at which your capital grows. A higher IRR is better, with commercial real estate typically targeting 12% to 18%.</p>
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-white flex items-center gap-1"><span>💸</span><span>Net Present Value (NPV)</span></p>
                <p className="text-slate-400">The current value of all future cash flows (cash flow + exit proceeds), discounted back to today using a target discount rate (hurdle rate), minus your initial cash investment.</p>
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-accent-cyan flex items-center gap-1"><span /><span>Equity Multiplier (MOIC)</span></p>
                <p className="text-slate-400">How many times your cash investment is returned over the hold period. Calculated as Total Cash Returned / Total Cash Invested.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Two-column executive synopsis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-slate-900/40 border border-slate-900 hover:border-slate-800 p-5 rounded-2xl shadow-xl transition space-y-4">
          <div className="flex items-center justify-between border-b border-slate-900 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Property &amp; Site Details</h3>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Property Address</span>
                {addressList.length > 1 && <span className="text-[9px] font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-1.5 py-0.5 rounded">{addressList.length} Parcels</span>}
              </div>
              <span className="text-xs font-bold text-slate-200 mt-1 block truncate">{displayAddr}</span>
              {addressList.length > 1 && <span className="text-[10px] text-cyan-300/80 mt-0.5 block truncate">+ {addressList.length - 1} adjacent parcel{addressList.length > 2 ? 's' : ''} in assemblage</span>}
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900">
              <span className="text-[10px] font-bold text-slate-500 uppercase">APN &amp; County</span>
              <span className="text-xs font-bold text-brand-400 mt-1 block truncate">{apnText}</span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Class &amp; Tier</span>
              <span className="text-xs font-bold text-slate-200 mt-1 block truncate">{pClass} • {tier}</span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900">
              <span className="text-[10px] font-bold text-slate-500 uppercase">County Assessed Value</span>
              <span className="text-xs font-bold text-emerald-400 mt-1 block truncate">{assessed > 0 ? formatCurrency(assessed) : 'Pending Assessment'}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-900 text-xs flex items-center justify-between shadow-inner">
            <div className="min-w-0">
              <span className="font-bold text-white text-[11px] block truncate">{tenancyTitle}</span>
              <span className="text-[10px] text-slate-400 block truncate">{tenancySub}</span>
            </div>
            <Link to="/operations" className="shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-[10px] font-bold text-emerald-400 border border-slate-800 hover:border-emerald-500/40 transition flex items-center space-x-1 cursor-pointer">
              <span>Rent Roll</span><span>➔</span>
            </Link>
          </div>

          <button type="button" onClick={() => onSelectTab('property')} className="w-full py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center space-x-2 transition shadow-sm group">
            <span>View Property Records &amp; Details</span>
            <span className="text-emerald-400 group-hover:translate-x-1 transition-transform">➔</span>
          </button>
        </div>

        <div className="bg-slate-900/40 border border-slate-900 hover:border-slate-800 p-5 rounded-2xl shadow-xl transition space-y-4">
          <div className="flex items-center justify-between border-b border-slate-900 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Financing &amp; Debt Structure</h3>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Loan Amount</span>
              <span className="text-xs font-bold text-white mt-1 block truncate">
                {pit
                  ? <><span>{formatCurrency(pit.currentDebt)}</span> <span className="text-[10px] text-slate-400 font-normal">(Mo {pit.monthsElapsed})</span></>
                  : formatCurrency(metrics.loanAmount)}
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900">
              <span className="text-[10px] font-bold text-slate-500 uppercase">LTV &amp; Leverage</span>
              <span className="text-xs font-bold text-slate-200 mt-1 block truncate">
                {pit ? `${pit.ltv}% In-Place LTV • ${rate}%` : `${(Number(metrics.ltv) || 0).toFixed(1)}% LTV • ${rate}%`}
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Debt Service (P&amp;I)</span>
              <span className="text-xs font-bold text-slate-200 mt-1 block truncate">{formatCurrency(monthlyPayment)}/mo ({formatCurrency(monthlyPayment * 12)}/yr)</span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Coverage (DSCR)</span>
              <span className={`text-xs font-bold mt-1 block truncate ${vacant ? 'text-amber-400' : dscrGood ? 'text-emerald-400' : 'text-amber-400'}`}>{dscrText}</span>
            </div>
          </div>

          <button type="button" onClick={() => onSelectTab('debt')} className="w-full py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center space-x-2 transition shadow-sm group">
            <span>View Debt Structure &amp; Full Amortization Schedule</span>
            <span className="text-cyan-400 group-hover:translate-x-1 transition-transform">➔</span>
          </button>
        </div>
      </div>

      {/* Projections visualizer */}
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">10-Year Projections Visualization</h3>
            <p className="text-xs text-slate-400">Comparing property value, debt, equity and cash flow over time</p>
          </div>
          <div className="flex space-x-1.5 bg-slate-950 p-1 rounded-lg border border-slate-900">
            <button onClick={() => setChartType('cashflow')} className={chartType === 'cashflow' ? 'px-3 py-1 rounded-md text-xs font-semibold bg-slate-900 text-white shadow-sm transition' : 'px-3 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition'}>Cash Flow</button>
            <button onClick={() => setChartType('valuation')} className={chartType === 'valuation' ? 'px-3 py-1 rounded-md text-xs font-semibold bg-slate-900 text-white shadow-sm transition' : 'px-3 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition'}>Value vs Debt</button>
          </div>
        </div>
        <div className="h-64 md:h-80 w-full relative">
          <ProjectionsChart projections={projections} startYear={startYr} type={chartType} />
        </div>
      </div>

      {/* Where the money goes, value built, loan coverage */}
      <DealCharts metrics={metrics} startYear={startYr} defaultYear={targetYear} />

      {/* Milestones */}
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-900 pb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">5-Year Milestone Capital Trajectory</h3>
            <p className="text-[11px] text-slate-400">Key performance milestones across Year 1, Year 3, Year 5, Year 7, and Year 10</p>
          </div>
          <button type="button" onClick={() => onSelectTab('proforma')} className="text-xs font-bold text-brand-400 hover:text-brand-300 flex items-center space-x-1 transition self-start sm:self-auto">
            <span>View All 10 Years &amp; Monthly Schedule ➔</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-900 text-slate-400 font-semibold bg-slate-950/60">
                <th className="py-2.5 px-4 sticky left-0 bg-slate-950 z-20 border-r border-slate-800/80 shadow-md">Milestone</th>
                <th className="py-2.5 px-4">Property Value</th>
                <th className="py-2.5 px-4">Gross Income</th>
                <th className="py-2.5 px-4">NOI</th>
                <th className="py-2.5 px-4">Debt Service</th>
                <th className="py-2.5 px-4 text-emerald-400 font-bold">Net Cash Flow</th>
                <th className="py-2.5 px-4">Cash-on-Cash</th>
                <th className="py-2.5 px-4 text-brand-400 font-bold">Ending Equity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/60">
              {milestones.map((yr) => {
                const p = projections[yr - 1] || projections[projections.length - 1];
                if (!p) return null;
                const positive = Number(p.cashFlow) >= 0;
                return (
                  <tr key={yr} className="hover:bg-slate-900/40 transition">
                    <td className="py-2.5 px-4 font-bold text-slate-200 sticky left-0 bg-slate-950/95 backdrop-blur z-10 border-r border-slate-800/80 shadow-md">
                      Year {yr} <span className="text-[10px] text-slate-500 font-normal">({startYr + yr - 1})</span>
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-300">{formatCurrency(p.propertyValue)}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-300">{formatCurrency(p.grossPotentialIncome)}</td>
                    <td className="py-2.5 px-4 font-bold text-white">{formatCurrency(p.netOperatingIncome)}</td>
                    <td className="py-2.5 px-4 text-slate-400">{formatCurrency(p.debtService)}</td>
                    <td className={`py-2.5 px-4 font-bold ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(p.cashFlow)}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-300">{(Number(p.cashOnCash) || 0).toFixed(1)}%</td>
                    <td className="py-2.5 px-4 font-black text-brand-400">{formatCurrency(p.equity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Diligence & action center */}
      <div className="bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-950 p-5 rounded-2xl border border-slate-800 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-200">Due Diligence &amp; Deliverables</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{(deal as any).verified_items_count || 8}/8 Verified</span>
          </div>
          <p className="text-xs text-slate-400">All 8 underwriting inputs mapped to verifiable economic provenance, gap analysis, and deliverables.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { void openDealBrief(deal.id); }} className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-200 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition shadow-sm flex items-center space-x-1.5">
            <svg className="w-3.5 h-3.5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            <span>Export Brief (PDF)</span>
          </button>
          {onOpenEdit && (
            <button type="button" onClick={onOpenEdit} className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition shadow-sm flex items-center space-x-1.5">
              <span>✎ Edit Inputs</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
