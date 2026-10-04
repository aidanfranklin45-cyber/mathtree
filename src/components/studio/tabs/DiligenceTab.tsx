import React, { useMemo, useState } from 'react';
import { DealRecord, DealMetrics, DealInputs } from '../../../lib/math/types';
import { formatCurrency } from '../../../lib/format';
import { firstFullYear } from '../../../lib/engine';

interface DiligenceTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  onPatchDeal: (inputsPatch: Partial<DealInputs>) => Promise<boolean>;
}

type Category = 'all' | 'acquisition' | 'revenue' | 'financing' | 'operations';

const CHECKLIST = [
  { id: 'assessor_records', label: 'County Assessor & Parcel Roll Records', detail: 'Assessed valuation, parcel boundary data, and tax history verified' },
  { id: 'rent_roll_leases', label: 'Rent Roll & Lease Agreement Terms', detail: 'Contractual rent rates, escalation clauses, and tenant lease structures' },
  { id: 'operating_history', label: 'Historical Operating Statements (T12)', detail: 'Operating revenues, utility histories, and expense reconciliations' },
  { id: 'debt_terms', label: 'Debt Financing & Capital Structure Terms', detail: 'Loan amortization schedule, interest rate, and DSCR covenants' },
  { id: 'physical_condition', label: 'Physical Asset Specs & Condition Assessment', detail: 'Building square footage, mechanical systems, and capital reserve needs' },
  { id: 'insurance_policy', label: 'Property & Casualty Insurance Coverage', detail: 'Hazard and liability coverage terms, replacement value, and annual premium' },
  { id: 'title_zoning', label: 'Zoning & Municipal Land Use Records', detail: 'Permitted land use codes, recorded easements, and legal description' },
  { id: 'tax_cost_seg', label: 'Tax Depreciation & Basis Allocation', detail: 'Land vs improvement basis split for annual cost recovery and deductions' },
];

const FILTERS: Array<[Category, string]> = [['acquisition', 'Acquisition'], ['revenue', 'Revenue'], ['financing', 'Debt'], ['operations', 'OpEx/CapEx']];

function normalizeAsset(ac: string): 'single-family' | 'multi-unit' | 'commercial' | 'storage' {
  const s = String(ac || 'commercial').toLowerCase();
  if (s.includes('multi')) return 'multi-unit';
  if (s.includes('single') || s.includes('resid')) return 'single-family';
  if (s.includes('storage')) return 'storage';
  return 'commercial';
}

export const DiligenceTab: React.FC<DiligenceTabProps> = ({ deal, metrics, onPatchDeal }) => {
  const [category, setCategory] = useState<Category>('all');
  const inputs: Record<string, any> = deal.inputs || {};
  const raw: Record<string, any> = inputs.assessorData || {};
  const asset = normalizeAsset(String(deal.asset_class));
  const checks: Record<string, boolean> = inputs.diligenceChecks || {};

  const assumptions = useMemo(() => {
    const totalAssessed = raw.totalAssessedValue || inputs.totalAssessedValue || inputs.assessedValue || 0;
    const sqft = raw.buildingSqFt || inputs.buildingSqFt || inputs.gla || inputs.totalSqFt || 0;
    const holdYrs = inputs.holdingPeriod ?? inputs.exitYear;
    const projections = (metrics.projections ?? []) as Array<Record<string, any>>;
    const p0: Record<string, any> = projections[0] || {};
    const isStub = Boolean(p0 && Number(p0.operatingMonths) < 12);
    const fullYear: Record<string, any> = firstFullYear(projections) || p0;

    const gpi = isStub ? (fullYear.grossPotentialIncome || p0.grossPotentialIncome || 0) : (p0.grossPotentialIncome || inputs.grossRentAnnual || 0);
    const opex = isStub ? (fullYear.operatingExpenses || p0.operatingExpenses || 0) : (p0.operatingExpenses || 0);
    const monthly = Number(metrics.monthlyMortgagePayment) || 0;
    const annualDebt = monthly * 12;
    const breakevenOcc = gpi > 0 ? ((opex + annualDebt) / gpi) * 100 : 0;
    const maxVacancy = Math.max(0, 100 - breakevenOcc);

    const vacancy = inputs.vacancyRate ?? 0;
    const opexRatio = inputs.expenseRatio ?? inputs.operatingExpenseRatio ?? 0;
    const down = inputs.downPaymentPercent ?? 0;
    const rate = inputs.interestRate ?? 0;
    const term = inputs.amortizationYears ?? inputs.loanTerm;
    const growth = inputs.rentGrowth ?? 0;

    let revenue = '';
    if (asset === 'single-family') revenue = `${formatCurrency(inputs.monthlyRent)}/mo (${formatCurrency((inputs.monthlyRent || 0) * 12)}/yr)`;
    else if (asset === 'multi-unit') revenue = `${inputs.unitCount || 1} Units @ ${formatCurrency(inputs.monthlyRentPerUnit)}/mo (${formatCurrency((inputs.unitCount || 1) * (inputs.monthlyRentPerUnit || 0) * 12)}/yr)`;
    else if (asset === 'commercial') revenue = `${formatCurrency(inputs.grossRentAnnual || 0)}/yr (${Number(inputs.gla || sqft || 0).toLocaleString()} sq ft GLA)`;
    else revenue = `${formatCurrency(inputs.grossRentAnnual || 0)}/yr (${inputs.unitCount || 0} Units)`;

    const price = Number(metrics.purchasePrice) || 0;
    const pricePerSqFt = sqft > 0 ? (price / sqft).toFixed(2) : 'N/A';
    const rehab = parseFloat(inputs.rehabCosts || 0) || 0;
    const closing = parseFloat(inputs.closingCosts || 0) || 0;
    const rolled = (inputs.rehabFinancingMode || (inputs.financeRehabAndClosingCosts ? 'roll_into_loan' : 'out_of_pocket')) === 'roll_into_loan';
    const downAmt = parseFloat(String((metrics as any).downPaymentAmount || 0)) || 0;
    const outlay = parseFloat(String(metrics.initialCashInvested ?? (rolled ? downAmt : downAmt + rehab + closing))) || 0;
    const dscrVal = metrics.dscr ?? fullYear.dscr ?? p0.dscr;
    const dscr = dscrVal !== null && dscrVal !== undefined && !isNaN(Number(dscrVal))
      ? `${Number(dscrVal).toFixed(2)}x${isStub ? ' (Stabilized)' : ''}`
      : 'N/A';
    const leaseType = inputs.leaseType || (asset === 'single-family' ? 'Gross' : 'NNN');
    const fullNoi = Number(isStub ? (fullYear.netOperatingIncome || 0) : (p0.netOperatingIncome || 0));
    const cushion = Math.max(0, fullNoi - annualDebt);

    return [
      {
        id: 'price', icon: '🏷️', name: '1. Acquisition Price & Cost Basis', category: 'acquisition' as const,
        value: formatCurrency(price) + (pricePerSqFt !== 'N/A' ? ` ($${pricePerSqFt}/sq ft)` : ''),
        provenance: `Underwritten against official ${raw.county || 'County'} Assessor tax roll valuation (${totalAssessed > 0 ? `${formatCurrency(totalAssessed)} assessed basis` : 'assessed tax roll'}). Establishes baseline entry pricing calibrated to purchase contract terms.`,
      },
      {
        id: 'capex', icon: '🏗️', name: '2. Total Initial Capital Outlay (Equity, Rehab & Closing)', category: 'acquisition' as const,
        value: rolled
          ? `${formatCurrency(outlay)} Total Outlay • (${formatCurrency(downAmt)} Down • ${formatCurrency(rehab)} Rehab + ${formatCurrency(closing)} Closing Rolled into Loan)`
          : `${formatCurrency(outlay)} Total Outlay • (${formatCurrency(downAmt)} Down + ${formatCurrency(rehab)} Rehab + ${formatCurrency(closing)} Closing • Funded Out-of-Pocket)`,
        provenance: `Represents total Day 1 sponsor equity required to capitalize the acquisition (${formatCurrency(downAmt)} down payment), fund estimated closing costs (${formatCurrency(closing)}), and execute renovation scope (${formatCurrency(rehab)}) to capture After-Repair Value. ${rolled ? 'Rehab and closing costs are rolled directly into the senior loan facility.' : 'Rehab and closing settlements are funded 100% upfront out of sponsor equity.'} Ongoing replacement reserve: ${inputs.capexReserve ?? 0}%/yr (${formatCurrency(fullYear.capexReserve || p0.capexReserve || 0)}/yr).`,
      },
      {
        id: 'vacancy', icon: '🛡️', name: '3. Economic Vacancy & Credit Loss', category: 'operations' as const,
        value: `${vacancy}% of GPI (${formatCurrency(fullYear.vacancyLoss || p0.vacancyLoss || 0)}/yr reserve)`,
        provenance: `Enforces a ${vacancy}% underwriting allowance for tenant rollover downtime, collection friction, and lease turnover. Asset maintains operational cash flow solvency up to ${maxVacancy.toFixed(1)}% vacancy tolerance.`,
      },
      {
        id: 'financing', icon: '🏦', name: '4. Loan-to-Value & Leverage Structure', category: 'financing' as const,
        value: `${down}% Down (${formatCurrency(downAmt)}) • ${(Number(metrics.ltv) || 0).toFixed(1)}% ${rolled ? 'LTC' : 'LTV'} (${formatCurrency(metrics.loanAmount)})`,
        provenance: `Calibrated to lending terms (${down}% equity down, ${(Number(metrics.ltv) || 0).toFixed(1)}% senior debt). Total project basis structured under ${rolled ? 'LTC package including rehab and closing costs' : 'standard acquisition LTV with cash-funded capex'}.`,
      },
      {
        id: 'terms', icon: '📑', name: '5. Financing Terms & Debt Service', category: 'financing' as const,
        value: `${rate}% Fixed • ${term} Yrs • ${formatCurrency(monthly)}/mo P&I • DSCR: ${dscr}`,
        provenance: `Fixed mortgage amortization over ${term} years (${formatCurrency(annualDebt)}/yr total annual debt). Net Operating Income of ${formatCurrency(fullNoi)}/yr provides a cash flow cushion of ${formatCurrency(cushion)}/yr above debt service.${isStub && p0.dscr !== null ? ` Initial ${p0.operatingMonths}-month stub period carries ${Number(p0.dscr).toFixed(2)}x coverage.` : ''}`,
      },
      {
        id: 'revenue', icon: '📈', name: '6. Gross Revenue & Rental Income', category: 'revenue' as const,
        value: `${revenue} • +${growth}%/yr Growth`,
        provenance: `Derived from ${asset === 'commercial' ? `${inputs.leaseType || 'NNN'} commercial single-tenant lease terms` : asset === 'multi-unit' ? 'unit-level rental rate schedule' : 'in-place residential market rents'}. Escalation mechanism compounds to protect real yields.`,
      },
      {
        id: 'opex', icon: '⚙️', name: '7. Operating Expense Ratio (OER) & Management', category: 'operations' as const,
        value: `${opexRatio}% of GPI (${formatCurrency(fullYear.operatingExpenses || p0.operatingExpenses || 0)}/yr) • ${inputs.manageProperty ? 'Professional Management' : 'Self-Managed'}`,
        provenance: `Underwritten under ${leaseType} structure covering county real estate taxes, hazard/property insurance, property management fees (${inputs.manageProperty ? '3.5-10%' : 'self-managed'}), and operational reserves.`,
      },
      {
        id: 'exit', icon: '🎯', name: '8. Terminal Cap Rate & Hold Horizon', category: 'acquisition' as const,
        value: `${holdYrs}-Year Hold • ${asset === 'commercial' || asset === 'storage' ? `${inputs.targetCapRate ?? 0}% Exit Cap (+50 bps spread)` : `${inputs.appreciationRate ?? 0}%/yr Appreciation`}`,
        provenance: `Modeled with a terminal cap rate spread (+50 bps expansion buffer over entry yield) to stress-test liquidity, asset vintage aging, and capital market shifts over the ${holdYrs}-year hold.`,
      },
    ];
  }, [deal, metrics, asset]);

  const visible = category === 'all' ? assumptions : assumptions.filter((a) => a.category === category);
  const done = CHECKLIST.filter((c) => checks[c.id]).length;
  const pct = Math.round((done / CHECKLIST.length) * 100);

  const toggle = (id: string) => { void onPatchDeal({ diligenceChecks: { ...checks, [id]: !checks[id] } } as Partial<DealInputs>); };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-5 transition duration-300">
        <div className="pb-3 border-b border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span>Underwriting Assumptions Provenance &amp; Diligence Bridge</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {category === 'all' ? 'Comprehensive Audit' : `${category.toUpperCase()} FOCUS`}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Granular provenance for every model input: Economic Derivation, Assessor Benchmarks, and Quantitative Valuation Sensitivity.</p>
          </div>
          <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button type="button" onClick={() => setCategory('all')} className={category === 'all' ? 'px-2.5 py-1 rounded-lg font-bold bg-brand-600 text-white transition text-[11px]' : 'px-2.5 py-1 rounded-lg font-semibold text-slate-400 hover:text-white transition text-[11px]'}>All (8)</button>
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setCategory(key)} className={category === key ? 'px-2.5 py-1 rounded-lg font-bold bg-brand-600 text-white transition text-[11px]' : 'px-2.5 py-1 rounded-lg font-semibold text-slate-400 hover:text-white transition text-[11px]'}>{label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((a) => (
            <div key={a.id} className="bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 space-y-3.5 shadow-lg transition flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 border-b border-slate-900 pb-2.5">
                  <div className="flex items-center space-x-2"><span className="text-base">{a.icon}</span><span className="text-xs font-bold text-slate-200">{a.name}</span></div>
                  <span className="text-[9.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-brand-500/10 text-brand-300 border border-brand-500/20">{a.category}</span>
                </div>
                <div>
                  <span className="text-[9.5px] uppercase font-bold text-slate-500 block mb-1">Underwritten Metric &amp; Value</span>
                  <div className="text-xs sm:text-sm font-black text-emerald-400 bg-slate-900/90 px-3 py-2 rounded-xl border border-slate-800/90 shadow-inner leading-snug">{a.value}</div>
                </div>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 text-xs">
                <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 block mb-1">💡 Methodology &amp; Diligence Provenance</span>
                <p className="text-slate-300 leading-relaxed text-[11.5px]">{a.provenance}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
            <div className="flex items-center space-x-2">
              <span className="text-base">📋</span>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">Underwriting Records &amp; Verification Audit</h4>
                <p className="text-[11px] text-slate-400">Track documentation, historical records, and property data inputs used to evaluate the asset.</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Diligence Completion</span>
                <span className="text-xs font-black text-emerald-400">{pct}% ({done} of {CHECKLIST.length} Verified)</span>
              </div>
              <div className="w-24 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div className="bg-emerald-500 h-2 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {CHECKLIST.map((item) => {
              const isDone = !!checks[item.id];
              return (
                <label key={item.id}
                  className={`flex items-start space-x-2.5 p-2.5 rounded-xl border transition cursor-pointer ${isDone ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-200' : 'bg-slate-900/40 border-slate-900 text-slate-300 hover:bg-slate-900/70'}`}>
                  <input type="checkbox" checked={isDone} onChange={() => toggle(item.id)} className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-emerald-500 mt-0.5 h-3.5 w-3.5 cursor-pointer" />
                  <div className="flex-1">
                    <span className={`font-bold block ${isDone ? 'line-through text-emerald-300/80' : 'text-slate-200'}`}>{item.label}</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">{item.detail}</span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
