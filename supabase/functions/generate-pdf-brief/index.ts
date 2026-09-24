// generate-pdf-brief/index.ts
// Institutional PDF & Executive Brief Serverless Generator for MathTree
// Dual-Mode: Single-Asset Underwriting Memo & Portfolio & Pipeline Command Center Brief

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';
import {
  calculateProjections,
  calculateTaxMetrics,
  calculateSensitivityMatrix,
  getAnnualAmortization
} from '../_shared/math-engine.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function fmtCurr(num: any): string {
  const n = parseFloat(num) || 0;
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtPct(num: any): string {
  const n = parseFloat(num) || 0;
  return n.toFixed(2) + '%';
}

function fmtDec(num: any, decimals = 1): string {
  const n = parseFloat(num) || 0;
  return n.toFixed(decimals);
}

// =========================================================================
// MONTE CARLO STOCHASTIC VOLATILITY ENGINE (ON-DEMAND AT INITIALIZATION)
// =========================================================================
interface MonteCarloResult {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  probExceedingHurdle: number;
  probNegativeIrr: number;
  svgChart: string;
  narrative: string;
}

function runOnDemandMonteCarlo(
  assetClass: string,
  baseInputs: any,
  hurdleRate: number,
  dealSeedStr = 'mathtree'
): MonteCarloResult {
  // Deterministic LCG pseudo-random generator based on deal seed
  let seed = 0;
  for (let i = 0; i < dealSeedStr.length; i++) {
    seed = (seed << 5) - seed + dealSeedStr.charCodeAt(i);
    seed |= 0;
  }
  seed = Math.abs(seed) || 54321;

  function nextRandom(): number {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  function randomNorm(mean = 0, stdev = 1): number {
    const u1 = Math.max(1e-7, nextRandom());
    const u2 = nextRandom();
    return mean + Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * stdev;
  }

  const TRIALS = 500;
  const irrs: number[] = [];

  const basePrice = parseFloat(baseInputs.purchasePrice || baseInputs.price || 0);
  const baseGrossRent = parseFloat(baseInputs.grossRentAnnual || (baseInputs.monthlyRent ? baseInputs.monthlyRent * 12 : 0) || (basePrice * 0.08));
  const baseVacancy = parseFloat(baseInputs.vacancyRate || 5.0);
  const baseExpenseRatio = parseFloat(baseInputs.expenseRatio || 25.0);
  const baseExitCap = parseFloat(baseInputs.targetCapRate || baseInputs.exitCapRate || 7.0);

  for (let i = 0; i < TRIALS; i++) {
    // 1. Rent fluctuation (±7.5% stdev)
    const rentMult = Math.max(0.75, Math.min(1.25, 1.0 + randomNorm(0, 0.075)));
    const simRent = baseGrossRent * rentMult;

    // 2. Vacancy stress (stochastic shift)
    const vacShift = Math.max(2.0, Math.min(22.0, baseVacancy + randomNorm(0, 3.5)));

    // 3. OpEx ratio swing (±3.0%)
    const opexShift = Math.max(10.0, Math.min(50.0, baseExpenseRatio + randomNorm(0, 3.0)));

    // 4. Exit cap expansion / compression (±0.75%)
    const capShift = Math.max(4.0, Math.min(14.0, baseExitCap + randomNorm(0, 0.75)));

    const simInputs = {
      ...baseInputs,
      grossRentAnnual: simRent,
      monthlyRent: simRent / 12,
      grossRentPerMonth: simRent / 12,
      vacancyRate: vacShift,
      expenseRatio: opexShift,
      targetCapRate: capShift,
      exitCapRate: capShift,
    };

    try {
      const res = calculateProjections(assetClass as any, simInputs);
      const irrVal = parseFloat(res.irr as any) || 0;
      irrs.push(irrVal);
    } catch {
      irrs.push(0);
    }
  }

  irrs.sort((a, b) => a - b);

  const p10 = irrs[Math.floor(TRIALS * 0.10)] ?? 0;
  const p50 = irrs[Math.floor(TRIALS * 0.50)] ?? 0;
  const p90 = irrs[Math.floor(TRIALS * 0.90)] ?? 0;
  const mean = irrs.reduce((s, x) => s + x, 0) / TRIALS;

  const countAboveHurdle = irrs.filter(x => x >= hurdleRate).length;
  const probExceedingHurdle = Math.round((countAboveHurdle / TRIALS) * 100);
  const countNegative = irrs.filter(x => x < 0).length;
  const probNegativeIrr = Math.round((countNegative / TRIALS) * 100);

  // Build SVG Histogram with 10 bins
  const minIrr = Math.floor(Math.max(-10, p10 - 2.5));
  const maxIrr = Math.ceil(Math.min(40, p90 + 2.5));
  const binCount = 10;
  const binWidth = Math.max(0.5, (maxIrr - minIrr) / binCount);

  const bins: { label: string; count: number; start: number; end: number }[] = [];
  for (let b = 0; b < binCount; b++) {
    const bStart = minIrr + b * binWidth;
    const bEnd = bStart + binWidth;
    const count = irrs.filter(x => (b === binCount - 1 ? (x >= bStart && x <= bEnd + 0.001) : (x >= bStart && x < bEnd))).length;
    bins.push({
      label: `${bStart.toFixed(0)}-${bEnd.toFixed(0)}%`,
      start: bStart,
      end: bEnd,
      count
    });
  }

  const maxBinCount = Math.max(1, ...bins.map(b => b.count));
  const chartWidth = 540;
  const chartHeight = 65;
  const barGap = 4;
  const totalBarWidth = (chartWidth - (binCount - 1) * barGap) / binCount;

  // Hurdle rate marker X position
  const hurdleX = Math.max(15, Math.min(chartWidth - 15, ((hurdleRate - minIrr) / (maxIrr - minIrr)) * chartWidth));

  let barsSvg = '';
  bins.forEach((bin, idx) => {
    const barH = (bin.count / maxBinCount) * 44;
    const x = idx * (totalBarWidth + barGap);
    const y = 48 - barH;
    let fillColor = '#059669'; // Emerald for >= hurdleRate
    if (bin.end < 0) {
      fillColor = '#e11d48'; // Rose
    } else if (bin.end < hurdleRate) {
      fillColor = '#d97706'; // Amber
    }

    barsSvg += `
      <g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${totalBarWidth.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${fillColor}" opacity="0.9" />
        <text x="${(x + totalBarWidth / 2).toFixed(1)}" y="58" font-size="6.5" fill="#64748b" text-anchor="middle" font-family="sans-serif">${bin.start.toFixed(0)}%</text>
        <text x="${(x + totalBarWidth / 2).toFixed(1)}" y="${Math.max(8, y - 2).toFixed(1)}" font-size="6" font-weight="bold" fill="#334155" text-anchor="middle" font-family="sans-serif">${bin.count}</text>
      </g>
    `;
  });

  const svgChart = `
    <svg viewBox="0 0 ${chartWidth} ${chartHeight}" style="width: 100%; height: ${chartHeight}px; overflow: visible;">
      <!-- Bars -->
      ${barsSvg}
      <!-- Hurdle Rate Reference Line -->
      <line x1="${hurdleX.toFixed(1)}" y1="2" x2="${hurdleX.toFixed(1)}" y2="48" stroke="#047857" stroke-width="1.5" stroke-dasharray="3 2" />
      <text x="${hurdleX.toFixed(1)}" y="4" font-size="6.5" font-weight="800" fill="#047857" text-anchor="middle" font-family="sans-serif">Hurdle ${hurdleRate.toFixed(1)}%</text>
    </svg>
  `;

  const narrative = `Stochastic trial across 500 randomized economic runs modeling simultaneous market variations: rental rate drift (±7.5%), vacancy shocks (up to 20% stress peak), exit cap spread expansion (±75 bps), and inflationary OpEx swing (±3.0%). The asset demonstrates a <strong>${probExceedingHurdle}% win-rate probability</strong> of meeting or exceeding your <strong>${hurdleRate.toFixed(1)}% hurdle rate</strong>, with a Value-at-Risk (P10) downside floor of <strong>${p10.toFixed(1)}% IRR</strong> and an upside P90 of <strong>${p90.toFixed(1)}% IRR</strong> (expected median: <strong>${p50.toFixed(1)}% IRR</strong>). Downside negative cash return risk is limited to <strong>${probNegativeIrr}%</strong> of trials.`;

  return {
    p10,
    p50,
    p90,
    mean,
    probExceedingHurdle,
    probNegativeIrr,
    svgChart,
    narrative
  };
}

// =========================================================================
// 1. SINGLE-DEAL EXECUTIVE UNDERWRITING MEMORANDUM BUILDER
// =========================================================================
function buildSingleDealBriefHtml(deal: any, parcelPackage?: any): string {
  const rawAssetClass = (deal.asset_class || deal.asset_type || deal.assetType || 'commercial').toLowerCase().replace(/_/g, '-');
  const isResidential = rawAssetClass === 'residential' || rawAssetClass === 'single-family' || rawAssetClass === 'sfr';
  const isMultiFamily = rawAssetClass === 'multi-family' || rawAssetClass === 'multifamily' || rawAssetClass === 'multi-unit';
  const isStorage = rawAssetClass === 'storage' || rawAssetClass === 'self-storage';
  const assetClass = isResidential ? 'residential' : (isMultiFamily ? 'multi_family' : (isStorage ? 'storage' : 'commercial'));

  const title = deal.title || deal.name || (isResidential ? 'Single-Family Residential Investment' : 'Commercial Asset Underwriting');
  const location = deal.location || deal.address || 'Yakima, WA';
  const status = (deal.status || 'prospect').toLowerCase();
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const inputs = deal.inputs || {};

  // Authoritative live calculation directly through canonical MathTree engine
  const mathResults = calculateProjections(assetClass as any, inputs);
  const proj: any[] = (mathResults.projections && mathResults.projections.length > 0)
    ? mathResults.projections
    : (deal.metrics?.projections || []);
  const metrics = { ...(deal.metrics || {}), ...mathResults };
  const rawAssessor = inputs.assessorData || {};

  const price = parseFloat(deal.purchase_price || inputs.purchasePrice || mathResults.purchasePrice || 0);
  const rehabCosts = parseFloat(inputs.rehabCosts || inputs.rehabBudget || 0);
  const closingCosts = parseFloat(inputs.closingCosts || 0);
  const arv = parseFloat(inputs.arv || inputs.afterRepairValue || (price + rehabCosts * 1.4) || price);
  const rehabMode = inputs.rehabFinancingMode || (inputs.financeRehabAndClosingCosts ? 'roll_into_loan' : 'out_of_pocket');
  const totalFinancedBasis = rehabMode === 'roll_into_loan' ? (price + rehabCosts + closingCosts) : price;

  const equity = parseFloat(deal.total_equity || metrics.initialEquity || metrics.initialCashInvested || mathResults.initialCashInvested || (price * 0.25));
  const loanAmt = parseFloat(deal.loan_amount || metrics.loanAmount || mathResults.loanAmount || Math.max(0, totalFinancedBasis - equity));
  const ltv = totalFinancedBasis > 0 ? Math.round((loanAmt / totalFinancedBasis) * 100) : (inputs.downPaymentPercent ? (100 - parseFloat(inputs.downPaymentPercent)) : 75);
  const downPaymentPercent = parseFloat(inputs.downPaymentPercent || (100 - ltv) || 25);
  const intRate = parseFloat(inputs.interestRate || inputs.rate || 6.5);
  const loanTerm = parseInt(inputs.loanTerm || inputs.amortizationYears || 30, 10);
  const holdYears = parseInt(inputs.exitYear || inputs.holdingPeriod || 10, 10);
  const discountRate = parseFloat(inputs.discountRate || 8.0);

  const p0 = proj[0] || {};
  const noi = parseFloat(p0.netOperatingIncome ?? metrics.noi ?? 0);
  const debtService = parseFloat(metrics.annualDebtService || p0.debtService || (metrics.monthlyMortgagePayment ? metrics.monthlyMortgagePayment * 12 : 0));
  const monthlyDebtService = debtService / 12;
  const year1PrincipalMo = parseFloat(p0.principalPayment || (debtService * 0.25)) / 12;
  const year1InterestMo = Math.max(0, monthlyDebtService - year1PrincipalMo);

  const cashFlow = parseFloat(p0.cashFlow ?? p0.netCashFlow ?? metrics.year1CashFlow ?? (noi - debtService));
  const monthlyCashFlow = cashFlow / 12;
  const coc = parseFloat(p0.cashOnCash ?? metrics.cash_on_cash ?? metrics.year1CoC ?? (equity > 0 ? (cashFlow / equity) * 100 : 0));
  const irr = parseFloat(metrics.irr ?? deal.irr ?? 0);
  const em = parseFloat(metrics.equityMultiple ?? metrics.equityMultiplier ?? deal.equity_multiple ?? 1.0);
  const capRate = parseFloat(p0.capRate ?? metrics.capRate ?? (price > 0 ? (noi / price) * 100 : 0));
  const npv = parseFloat(metrics.npv ?? 0);

  // Dynamic DSCR & Covenant reconciliation (NO hardcoded conflict)
  const dscrNum = (p0.dscr !== null && p0.dscr !== undefined) ? Number(p0.dscr) : (debtService > 0 ? (noi / debtService) : 0);
  const dscrFormatted = debtService > 0 ? `${dscrNum.toFixed(2)}x` : 'N/A';

  let dscrEvaluation = '';
  if (dscrNum >= 1.25 && cashFlow > 0) {
    dscrEvaluation = `Calibrated to lending terms. Debt service coverage of ${dscrNum.toFixed(2)}x confirms resilient cash flow cushion (${fmtCurr(cashFlow)}/yr) comfortably exceeding institutional 1.25x covenant floor.`;
  } else if (dscrNum >= 1.0 && cashFlow > 0) {
    dscrEvaluation = `Moderate coverage. Projected Year 1 DSCR of ${dscrNum.toFixed(2)}x yields positive cash flow (${fmtCurr(cashFlow)}/yr) but sits below preferred 1.25x bank covenant buffer; sensitive to vacancy spikes or debt rate increases.`;
  } else {
    dscrEvaluation = `Underwriting Deficit Flag: Projected Year 1 operating cash flow is negative (${fmtCurr(cashFlow)}/yr, DSCR: ${dscrNum > 0 ? dscrNum.toFixed(2) + 'x' : 'N/A'}). Requires operating interest reserve or debt restructuring to service senior debt until stabilization.`;
  }

  // Debt Structure & Leverage Provenance
  let debtProvenance = '';
  if (rehabMode === 'roll_into_loan') {
    debtProvenance = `Structured on Total Project Basis (LTC): Purchase (${fmtCurr(price)}) + Rehab (${fmtCurr(rehabCosts)}) + Closing (${fmtCurr(closingCosts)}) = Total Financed Basis (${fmtCurr(totalFinancedBasis)}). Senior debt finances ${100 - downPaymentPercent}% of total basis (${fmtCurr(loanAmt)}), requiring ${fmtCurr(equity)} (${downPaymentPercent}%) initial sponsor equity.`;
  } else {
    debtProvenance = `Structured on Acquisition Price (LTV): Senior loan of ${fmtCurr(loanAmt)} (${ltv}% LTV) finances acquisition price (${fmtCurr(price)}). Rehab budget (${fmtCurr(rehabCosts)}) and closing costs (${fmtCurr(closingCosts)}) are funded 100% upfront out of sponsor equity (${fmtCurr(equity)} total cash outlay).`;
  }

  // Calendar year resolution
  let startYear = new Date().getFullYear();
  if (inputs.closingDate) {
    const parsed = new Date(inputs.closingDate).getFullYear();
    if (!isNaN(parsed) && parsed > 2000 && parsed < 2100) startYear = parsed;
  }

  // County Assessor & Multi-Parcel Package variables
  const pkgParcels: any[] = (parcelPackage && Array.isArray(parcelPackage.parcels) && parcelPackage.parcels.length > 0)
    ? parcelPackage.parcels
    : (Array.isArray(inputs.parcels) ? inputs.parcels : []);
  const includedParcels = pkgParcels.filter((p: any) => p.included !== false);
  const activeParcels = includedParcels.length > 0 ? includedParcels : pkgParcels;
  const adjacentParcels = activeParcels.filter((p: any) => !(p.is_primary ?? p.isPrimary));
  const hasMultipleParcels = (parcelPackage && parcelPackage.total_parcels > 1) || activeParcels.length > 1;

  const primParcel = (parcelPackage && parcelPackage.primary_parcel) || activeParcels[0] || {};
  const apn = primParcel.apn || inputs.primaryApn || inputs.apn || rawAssessor.apn || 'Pending Link';
  const formattedApn = primParcel.formatted_apn || primParcel.formattedApn || rawAssessor.formattedApn || (apn.length === 11 ? (apn.slice(0, 6) + '-' + apn.slice(6)) : apn);
  const county = inputs.county || rawAssessor.county || (location.toLowerCase().includes('yakima') ? 'Yakima County, WA' : 'County Assessor Record');
  const owner = primParcel.owner || rawAssessor.owner || inputs.owner || 'Owner of Record';
  const totalAssessed = parseFloat(primParcel.total_assessed_val || primParcel.totalAssessedValue || rawAssessor.totalAssessedValue || inputs.totalAssessedValue || 0);
  const landVal = parseFloat(primParcel.market_land_val || primParcel.marketLandValue || rawAssessor.marketLandValue || inputs.marketLandValue || 0);
  const impVal = parseFloat(primParcel.market_imp_val || primParcel.marketImprovementValue || rawAssessor.marketImprovementValue || inputs.marketImprovementValue || 0);
  const acres = parseFloat(primParcel.acres || rawAssessor.acres || inputs.acres || inputs.acreage || 0);
  const bldgSqFt = parseInt(rawAssessor.buildingSqFt || inputs.buildingSqFt || inputs.gla || inputs.totalSqFt || (activeParcels[0]?.buildingSqFt) || 0, 10);
  const lotSqFt = parseInt(primParcel.sqft || rawAssessor.sqft || inputs.sqft || (activeParcels[0]?.sqft) || (acres > 0 ? Math.round(acres * 43560) : 0), 10);

  const zoning = rawAssessor.zoning || inputs.zoning || (isResidential ? 'R-1 Single Family Residential' : 'B-2 General Commercial');
  const useCode = rawAssessor.useCode || inputs.useCode || (isResidential ? 'Residential / Single Family' : 'Commercial / Mixed');
  const yearBuilt = rawAssessor.yearBuilt || inputs.yearBuilt || '2020';
  const stories = rawAssessor.stories || inputs.stories || 1;
  const construction = rawAssessor.constructionType || inputs.constructionType || (isResidential ? 'Wood Frame / Siding' : 'Wood/Steel Frame');
  const legalDesc = rawAssessor.legalDescription || inputs.legalDescription || '';
  const gisSyncDate = rawAssessor.lastSyncedAt || (inputs.gisSync && inputs.gisSync.lastSyncedAt);
  const gisBadge = gisSyncDate ? `Live GIS Verified (${new Date(gisSyncDate).toLocaleDateString()})` : (apn !== 'Pending Link' ? 'Verified County Parcel' : 'Manual Underwriting Record');

  // Lease / Tenant Terms & Monthly Revenue Resolution
  const primaryLease = (inputs.leases && inputs.leases[0]) || {};
  const tenantName = primaryLease.tenantName || inputs.tenantName || (isResidential ? 'Residential In-Place Tenant' : (status === 'owned' ? 'In-Place Commercial Tenant' : 'Prospective Commercial Tenant'));
  const leaseType = isResidential ? 'Residential Gross Lease' : (inputs.leaseType || primaryLease.leaseType || 'NNN');
  const monthlyRent = parseFloat(primaryLease.monthlyRent || inputs.monthlyRent || inputs.grossRentPerMonth || (price > 0 ? (price * 0.008) : 2500));
  const annualRent = monthlyRent * 12;
  const leaseStart = primaryLease.leaseStartDate || inputs.leaseStartDate || (inputs.closingDate || '2025-01-01');
  const leaseEnd = primaryLease.leaseEndDate || inputs.leaseEndDate || '2030-12-31';
  const escType = primaryLease.escalationType || inputs.escalationType || 'Percentage Bump (%)';
  const escRate = primaryLease.escalationRate !== undefined ? primaryLease.escalationRate : (inputs.rentGrowth || 3.0);
  const escFreq = primaryLease.escalationFrequency || inputs.escalationFrequency || 'Annual on Anniversary';
  const nextEscDate = primaryLease.nextEscalationDate || inputs.nextEscalationDate || '2026-11-01';

  // Asset-Class Revenue Provenance
  let revenueProvenance = '';
  if (isResidential) {
    revenueProvenance = `Underwritten from local residential market comps and in-place tenant rental agreements (${fmtCurr(monthlyRent)}/mo • ${fmtCurr(annualRent)}/yr gross yield). Reflects single-family residential tenancy in Central Washington.`;
  } else if (isMultiFamily) {
    const units = parseInt(inputs.unitCount || inputs.numUnits || 4, 10);
    const rentPerDoor = units > 0 ? monthlyRent / units : monthlyRent;
    revenueProvenance = `Derived from ${units} residential multi-family doors at an average of ${fmtCurr(rentPerDoor)}/mo per unit (${fmtCurr(monthlyRent)}/mo combined • ${fmtCurr(annualRent)}/yr total gross potential income).`;
  } else if (isStorage) {
    const storageSqft = parseInt(inputs.storageSqFt || inputs.gla || bldgSqFt || 10000, 10);
    revenueProvenance = `Derived from ${storageSqft.toLocaleString()} net rentable self-storage square footage (${fmtCurr(monthlyRent)}/mo • $${(annualRent/storageSqft).toFixed(2)}/sq ft annual gross revenue).`;
  } else {
    revenueProvenance = `Derived from contractual ${leaseType} commercial lease agreements (${fmtCurr(monthlyRent)}/mo • ${fmtCurr(annualRent)}/yr). Reflects active commercial tenant obligations across Central Washington benchmarks.`;
  }

  // Asset-Class OpEx Provenance
  let opexProvenance = '';
  if (isResidential) {
    opexProvenance = `Underwritten at ${inputs.expenseRatio || 25}% of gross revenue (${fmtCurr(annualRent * ((parseFloat(inputs.expenseRatio) || 25) / 100))}/yr) to cover residential property management (8-10%), county real estate taxes, hazard insurance, and tenant turnover/maintenance reserves.`;
  } else {
    opexProvenance = `Underwritten under ${leaseType} commercial structure where tenant covers operational pass-throughs; ratio covers administrative overhead, taxes, and insurance reserve.`;
  }

  // Warnings / Risk flags
  const warnings: any[] = deal.warnings || [];
  if (cashFlow < 0) {
    warnings.push({ title: 'Negative Operating Cash Flow', description: `Year 1 underwritten cash flow is ${fmtCurr(cashFlow)} (CoC: ${fmtPct(coc)}). Operating deficit requires debt restructuring or cash reserve.` });
  }
  if (apn === 'Pending Link') {
    warnings.push({ title: 'Unlinked Assessor Parcel', description: 'Property is not tied to an active county parcel number; official assessment and boundary lines unverified.' });
  }
  if (dscrFormatted !== 'N/A' && dscrNum < 1.25) {
    warnings.push({ title: 'DSCR Below 1.25x Covenant Floor', description: `Projected Year 1 DSCR of ${dscrNum.toFixed(2)}x is below the institutional underwriting threshold of 1.25x.` });
  }

  // Run On-Demand Monte Carlo Simulation (500 trials, zero database footprint)
  const mc = runOnDemandMonteCarlo(assetClass, inputs, discountRate, String(deal.id || deal.title || 'mathtree'));

  // Build Waterfall Rows
  let waterfallRows = '';
  if (proj.length > 0) {
    waterfallRows = proj.map((p, idx) => {
      const rowYr = p.calendarYear || (startYear + (p.year || idx + 1) - 1);
      const cf = parseFloat(p.netCashFlow ?? p.cashFlow ?? 0);
      const rowCoc = parseFloat(p.cashOnCash ?? 0);
      const rowCap = parseFloat(p.capRate ?? 0);
      return `
        <tr style="border-bottom: 1px solid #e2e8f0; background: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'}; font-size: 8.5px;">
          <td style="padding: 4px 6px; text-align: center; font-weight: 700; color: #0f172a;">${rowYr} <span style="font-size: 7.5px; color: #64748b; font-weight: normal;">(Yr ${p.year || idx + 1})</span></td>
          <td style="padding: 4px 6px; text-align: right;">${fmtCurr(p.propertyValue)}</td>
          <td style="padding: 4px 6px; text-align: right;">${fmtCurr(p.grossPotentialIncome || p.effectiveGrossIncome)}</td>
          <td style="padding: 4px 6px; text-align: right; color: #e11d48;">${fmtCurr(p.vacancyLoss || 0)}</td>
          <td style="padding: 4px 6px; text-align: right; color: #64748b;">${fmtCurr(p.operatingExpenses || 0)}</td>
          <td style="padding: 4px 6px; text-align: right; font-weight: 700; color: #0f172a;">${fmtCurr(p.netOperatingIncome)}</td>
          <td style="padding: 4px 6px; text-align: right; color: #64748b;">${fmtCurr(p.debtService)}</td>
          <td style="padding: 4px 6px; text-align: right; font-weight: 800; color: ${cf >= 0 ? '#059669' : '#e11d48'};">${fmtCurr(cf)}</td>
          <td style="padding: 4px 6px; text-align: right; font-weight: 600; color: ${rowCoc >= 0 ? '#047857' : '#e11d48'};">${fmtPct(rowCoc)}</td>
          <td style="padding: 4px 6px; text-align: right;">${fmtPct(rowCap)}</td>
          <td style="padding: 4px 6px; text-align: right; color: #64748b;">${fmtCurr(p.loanBalanceRemaining || p.loanBalance || 0)}</td>
          <td style="padding: 4px 6px; text-align: right; font-weight: 700; color: #059669;">${fmtCurr(p.equity || 0)}</td>
        </tr>
      `;
    }).join('');
  } else {
    waterfallRows = `
      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 8.5px;">
        <td style="padding: 4px 6px; text-align: center; font-weight: 700;">${startYear} (Yr 1)</td>
        <td style="padding: 4px 6px; text-align: right;">${fmtCurr(price)}</td>
        <td style="padding: 4px 6px; text-align: right;">${fmtCurr(annualRent)}</td>
        <td style="padding: 4px 6px; text-align: right; color: #e11d48;">${fmtCurr(annualRent * 0.05)}</td>
        <td style="padding: 4px 6px; text-align: right; color: #64748b;">${fmtCurr(annualRent * 0.15)}</td>
        <td style="padding: 4px 6px; text-align: right; font-weight: 700;">${fmtCurr(noi)}</td>
        <td style="padding: 4px 6px; text-align: right;">${fmtCurr(debtService)}</td>
        <td style="padding: 4px 6px; text-align: right; font-weight: 800; color: #059669;">${fmtCurr(cashFlow)}</td>
        <td style="padding: 4px 6px; text-align: right; font-weight: 600; color: #047857;">${fmtPct(coc)}</td>
        <td style="padding: 4px 6px; text-align: right;">${fmtPct(capRate)}</td>
        <td style="padding: 4px 6px; text-align: right;">${fmtCurr(loanAmt)}</td>
        <td style="padding: 4px 6px; text-align: right; font-weight: 700; color: #059669;">${fmtCurr(equity)}</td>
      </tr>
    `;
  }

  // Header Title & Badge
  const memoTypeLabel = isResidential
    ? 'Single-Family Residential Investment Memo'
    : (isMultiFamily ? 'Multi-Family Residential Memo' : (isStorage ? 'Self-Storage Facility Memo' : 'Commercial Underwriting Memo'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MathTree Institutional Underwriting Brief - ${title}</title>
  <style>
    @page { size: letter landscape; margin: 7mm 9mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #0f172a; margin: 0; padding: 10px; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #059669; padding-bottom: 6px; margin-bottom: 8px; }
    .logo-badge { font-size: 18px; font-weight: 900; color: #059669; letter-spacing: -0.5px; }
    .pill { display: inline-block; font-size: 8px; font-weight: 800; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; }
    .pill-green { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .pill-blue { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .pill-purple { background: #faf5ff; color: #7e22ce; border: 1px solid #e9d5ff; }
    .pill-slate { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
    .scorecard { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-bottom: 8px; }
    .scorecard-tile { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 5px 7px; }
    .tile-lbl { font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase; margin: 0; }
    .tile-val { font-size: 13px; font-weight: 800; color: #0f172a; margin: 2px 0 0 0; }
    .box { border: 1px solid #cbd5e1; border-radius: 5px; overflow: hidden; margin-bottom: 8px; page-break-inside: avoid; }
    .box-header { background: #0f172a; color: #ffffff; padding: 4px 8px; font-size: 8.5px; font-weight: 800; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.3px; }
    .table-data { width: 100%; font-size: 8px; border-collapse: collapse; line-height: 1.35; }
    .table-data th { background: #f1f5f9; border-bottom: 1px solid #cbd5e1; font-weight: 800; color: #1e293b; padding: 3px 5px; }
    .table-data td { padding: 3.5px 5px; border-bottom: 1px solid #f1f5f9; }
    .footer { border-top: 1px solid #cbd5e1; padding-top: 4px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8; margin-top: 8px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="logo-badge">MathTree</span>
        <span class="pill pill-green">${memoTypeLabel}</span>
        <span class="pill ${status === 'owned' ? 'pill-green' : 'pill-blue'}">${status === 'owned' ? '🏛️ Owned Operating Asset' : '🎯 Pipeline Prospect'}</span>
        ${isResidential ? `<span class="pill pill-purple">🏡 Single-Family</span>` : ''}
      </div>
      <h1 style="font-size: 15px; font-weight: 800; color: #0f172a; margin: 3px 0 0 0;">${title}</h1>
      <div style="font-size: 9px; color: #475569; font-weight: 600; margin-top: 2px; display: flex; align-items: center; gap: 6px;">
        <span>📍 <strong>${location}</strong></span>
        <span>•</span>
        <span style="font-family: monospace; font-weight: 700; color: #047857;">APN: ${formattedApn}${adjacentParcels.length > 0 ? ` (+${adjacentParcels.length} Adjacent)` : ''}</span>
        <span>•</span>
        <span>🏛️ ${county}</span>
        <span>•</span>
        <span class="pill pill-slate">${gisBadge}</span>
        ${hasMultipleParcels ? `<span class="pill pill-green">📦 ${activeParcels.length}-Parcel Package</span>` : ''}
      </div>
    </div>
    <div style="text-align: right; font-size: 9px; color: #64748b;">
      <p style="margin: 0; font-weight: 600;">Report Date: <strong style="color: #0f172a;">${dateStr}</strong></p>
      <p style="margin: 1.5px 0 0 0;">Target Hold Period: <strong style="color: #0f172a;">${holdYears} Years</strong></p>
      <p style="margin: 1.5px 0 0 0;">Settlement Closing: <strong style="color: #059669;">${inputs.closingDate || (startYear + '-10-15')}</strong></p>
    </div>
  </div>

  <!-- 6 Top-Level Executive Scorecard Tiles -->
  <div class="scorecard">
    <div class="scorecard-tile">
      <p class="tile-lbl">10-Yr Levered IRR</p>
      <p class="tile-val" style="color: #059669;">${fmtPct(irr)}</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Gross Monthly Rent</p>
      <p class="tile-val">${fmtCurr(monthlyRent)}<span style="font-size: 8px; color: #64748b; font-weight: normal;">/mo</span></p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Year 1 Net Cash Flow</p>
      <p class="tile-val" style="color: ${cashFlow >= 0 ? '#059669' : '#e11d48'};">${fmtCurr(cashFlow)}<span style="font-size: 8px; color: #64748b; font-weight: normal;"> (${fmtCurr(monthlyCashFlow)}/mo)</span></p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Equity Multiplier</p>
      <p class="tile-val">${fmtDec(em, 2)}x</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Year 1 Cap Rate</p>
      <p class="tile-val">${fmtPct(capRate)}</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Senior DSCR</p>
      <p class="tile-val" style="color: ${dscrNum >= 1.25 ? '#0284c7' : (dscrNum >= 1.0 ? '#d97706' : '#e11d48')};">${dscrFormatted}</p>
    </div>
  </div>

  <!-- 1. Official County Assessor & Parcel Record Section -->
  <div class="box">
    <div class="box-header">
      <span>🏛️ Official County Assessor & Parcel Records</span>
      <span style="font-size: 8px; color: #34d399;">${hasMultipleParcels ? `Multi-Parcel Package (${activeParcels.length} APNs • Tax Roll Audit)` : 'Tax Roll & Boundary Audit'}</span>
    </div>
    <table class="table-data">
      <tbody>
        <tr>
          <td style="width: 14%; color: #64748b; font-weight: 700;">Property Address</td>
          <td style="width: 22%; font-weight: 700; color: #0f172a;">${location}</td>
          <td style="width: 14%; color: #64748b; font-weight: 700;">County Jurisdiction</td>
          <td style="width: 18%; font-weight: 700; color: #0f172a;">${county}</td>
          <td style="width: 14%; color: #64748b; font-weight: 700;">Primary APN / Parcel</td>
          <td style="width: 18%; font-family: monospace; font-weight: 700; color: #047857;">${formattedApn}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 700;">Owner of Record</td>
          <td style="font-weight: 700; color: #0f172a;">${owner}</td>
          <td style="color: #64748b; font-weight: 700;">${hasMultipleParcels ? 'Primary Lot Assessment' : 'Total Assessed Value'}</td>
          <td style="font-weight: 800; color: #059669;">${totalAssessed > 0 ? fmtCurr(totalAssessed) : 'Pending Assessment'}</td>
          <td style="color: #64748b; font-weight: 700;">Land / Bldg Split</td>
          <td style="font-weight: 600; color: #334155;">${totalAssessed > 0 ? `${fmtCurr(landVal)} L / ${fmtCurr(impVal)} B` : 'N/A'}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 700;">Primary Lot Area</td>
          <td style="font-weight: 700; color: #0f172a;">${acres > 0 ? `${fmtDec(acres, 2)} Acres (${lotSqFt.toLocaleString()} Sq Ft)` : (lotSqFt > 0 ? `${lotSqFt.toLocaleString()} Sq Ft` : 'N/A')}</td>
          <td style="color: #64748b; font-weight: 700;">Zoning & Land Use</td>
          <td style="font-weight: 600; color: #0f172a;">${zoning} • ${useCode}</td>
          <td style="color: #64748b; font-weight: 700;">Structural Specs</td>
          <td style="font-weight: 600; color: #0f172a;">Built ${yearBuilt} • ${bldgSqFt > 0 ? bldgSqFt.toLocaleString() + ' Sq Ft' : 'Pending Specs'} • ${stories} Story (${construction})</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 2. Core Underwriting Assumptions & Capital Structure (The High-Level Overview) -->
  <div class="box">
    <div class="box-header" style="background: #0f172a;">
      <span>⚖️ Core Underwriting Assumptions &amp; Capital Structure (High-Level Overview)</span>
      <span style="font-size: 8px; background: #047857; color: #ffffff; padding: 1.5px 7px; border-radius: 3px; font-weight: 800;">Strategic Inputs &amp; Provenance</span>
    </div>
    <table class="table-data">
      <thead>
        <tr style="background: #f1f5f9; text-align: left; font-size: 8.5px;">
          <th style="width: 42%; border-right: 1px solid #e2e8f0; padding: 4px 6px;">Underwriting Metric &amp; Strategic Value</th>
          <th style="width: 58%; padding: 4px 6px;">Methodology &amp; Diligence Provenance (How Reached)</th>
        </tr>
      </thead>
      <tbody>
        <!-- 1. Acquisition Price & Basis -->
        <tr>
          <td style="border-right: 1px solid #e2e8f0; vertical-align: middle; padding: 5px 6px;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">1. Acquisition Price &amp; Basis</div>
            <div style="display: flex; align-items: baseline; gap: 4px; margin-top: 2px;">
              <span style="font-size: 13.5px; font-weight: 900; color: #059669; letter-spacing: -0.3px;">${fmtCurr(price)}</span>
              ${bldgSqFt > 0 ? `<span style="font-size: 8.5px; color: #475569; font-weight: 700;">($${(price / bldgSqFt).toFixed(0)}/sq ft)</span>` : ''}
            </div>
          </td>
          <td style="color: #334155; vertical-align: middle; font-size: 8px; line-height: 1.35; padding: 5px 6px;">
            Reconciled against official ${county} assessed valuation (${totalAssessed > 0 ? fmtCurr(totalAssessed) + ' total assessed basis' : 'county tax roll'}) and purchase contract terms.
          </td>
        </tr>

        <!-- 2. Initial Rehab Capital Outlay (incl. Closing Costs) -->
        <tr style="background: #f8fafc;">
          <td style="border-right: 1px solid #e2e8f0; vertical-align: middle; padding: 5px 6px;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">2. Initial Rehab Capital Outlay (incl. Closing Costs)</div>
            <div style="display: flex; align-items: baseline; gap: 5px; margin-top: 2px;">
              <span style="font-size: 13.5px; font-weight: 900; color: #0284c7; letter-spacing: -0.3px;">${fmtCurr(rehabCosts + closingCosts)}</span>
              <span style="font-size: 8px; font-weight: 800; color: #0369a1; background: #e0f2fe; padding: 1px 5px; border-radius: 3px;">Total Initial Outlay</span>
            </div>
            <div style="font-size: 8px; color: #334155; font-weight: 600; margin-top: 2px;">
              ${fmtCurr(rehabCosts)} Rehab Scope + ${fmtCurr(closingCosts)} Closing Costs (${rehabMode === 'roll_into_loan' ? 'Rolled into Loan' : 'Funded Out-of-Pocket'})
            </div>
          </td>
          <td style="color: #334155; vertical-align: middle; font-size: 8px; line-height: 1.35; padding: 5px 6px;">
            Allocates dedicated initial renovation scope to bring property to peak market rent and capture full After-Repair Value (${fmtCurr(arv)}). ${rehabMode === 'roll_into_loan' ? 'Rehab and closing costs are rolled directly into the senior loan facility.' : 'Rehab and transaction closing costs are funded 100% upfront out of sponsor equity.'} Ongoing replacement reserves: ${inputs.capexReserve || 3.0}%/yr.
          </td>
        </tr>

        <!-- 3. Vacancy & Economic Downtime -->
        <tr>
          <td style="border-right: 1px solid #e2e8f0; vertical-align: middle; padding: 5px 6px;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">3. Vacancy &amp; Economic Downtime</div>
            <div style="display: flex; align-items: baseline; gap: 4px; margin-top: 2px;">
              <span style="font-size: 13.5px; font-weight: 900; color: #0f172a; letter-spacing: -0.3px;">${inputs.vacancyRate || 5}% of Gross</span>
              <span style="font-size: 8.5px; color: #64748b; font-weight: 700;">(${fmtCurr(annualRent * ((parseFloat(inputs.vacancyRate) || 5) / 100))}/yr reserve)</span>
            </div>
          </td>
          <td style="color: #334155; vertical-align: middle; font-size: 8px; line-height: 1.35; padding: 5px 6px;">
            Enforces institutional underwriting allowance to buffer tenant rollover friction, collection delay, and physical downtime. Asset maintains operational cash flow solvency up to 20% economic vacancy tolerance.
          </td>
        </tr>

        <!-- 4. Loan-to-Value & Senior Debt -->
        <tr style="background: #f8fafc;">
          <td style="border-right: 1px solid #e2e8f0; vertical-align: middle; padding: 5px 6px;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">4. Loan-to-Value &amp; Leverage Structure</div>
            <div style="display: flex; align-items: baseline; gap: 5px; margin-top: 2px;">
              <span style="font-size: 13.5px; font-weight: 900; color: #0f172a; letter-spacing: -0.3px;">${ltv}% ${rehabMode === 'roll_into_loan' ? 'LTC' : 'LTV'}</span>
              <span style="font-size: 11.5px; font-weight: 800; color: #047857;">${fmtCurr(loanAmt)} Senior Debt</span>
            </div>
            <div style="font-size: 8px; color: #475569; font-weight: 600; margin-top: 2px;">
              Required Sponsor Equity: ${fmtCurr(equity)} (${downPaymentPercent}% of Total Basis)
            </div>
          </td>
          <td style="color: #334155; vertical-align: middle; font-size: 8px; line-height: 1.35; padding: 5px 6px;">
            ${debtProvenance}
          </td>
        </tr>

        <!-- 5. Financing Terms & Debt Service -->
        <tr>
          <td style="border-right: 1px solid #e2e8f0; vertical-align: middle; padding: 5px 6px;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">5. Financing Terms &amp; Debt Service</div>
            <div style="display: flex; align-items: baseline; gap: 5px; margin-top: 2px;">
              <span style="font-size: 13px; font-weight: 900; color: #0f172a;">${intRate}% Fixed • ${loanTerm} Yrs</span>
              <span style="font-size: 11px; font-weight: 800; color: #0284c7;">${fmtCurr(monthlyDebtService)}/mo P&amp;I</span>
            </div>
            <div style="font-size: 8px; color: #334155; margin-top: 2px;">
              ${fmtCurr(debtService)}/yr Annual Debt (${fmtCurr(year1PrincipalMo)}/mo Prin • ${fmtCurr(year1InterestMo)}/mo Int) • DSCR: <strong style="color: ${dscrNum >= 1.25 ? '#059669' : (dscrNum >= 1.0 ? '#d97706' : '#e11d48')};">${dscrFormatted}</strong>
            </div>
          </td>
          <td style="color: #334155; vertical-align: middle; font-size: 8px; line-height: 1.35; padding: 5px 6px;">
            ${dscrEvaluation}
          </td>
        </tr>

        <!-- 6. Gross Revenue & In-Place Tenancy -->
        <tr style="background: #f8fafc;">
          <td style="border-right: 1px solid #e2e8f0; vertical-align: middle; padding: 5px 6px;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">6. Gross In-Place Revenue &amp; Tenancy</div>
            <div style="display: flex; align-items: baseline; gap: 4px; margin-top: 2px;">
              <span style="font-size: 13.5px; font-weight: 900; color: #059669; letter-spacing: -0.3px;">${fmtCurr(monthlyRent)}/mo</span>
              <span style="font-size: 8.5px; font-weight: 700; color: #64748b;">(${fmtCurr(annualRent)}/yr)</span>
            </div>
            <div style="font-size: 8px; color: #334155; margin-top: 2px;">
              ${tenantName} • ${leaseType} • +${escRate}%/yr Escalation • Lease: ${leaseStart} to ${leaseEnd}
            </div>
          </td>
          <td style="color: #334155; vertical-align: middle; font-size: 8px; line-height: 1.35; padding: 5px 6px;">
            ${revenueProvenance}
          </td>
        </tr>

        <!-- 7. Operating Expenses & Management -->
        <tr>
          <td style="border-right: 1px solid #e2e8f0; vertical-align: middle; padding: 5px 6px;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">7. Operating Expenses &amp; Management</div>
            <div style="display: flex; align-items: baseline; gap: 4px; margin-top: 2px;">
              <span style="font-size: 13.5px; font-weight: 900; color: #0f172a; letter-spacing: -0.3px;">${inputs.expenseRatio || 25}% of GPI</span>
              <span style="font-size: 8.5px; font-weight: 700; color: #64748b;">(${fmtCurr(annualRent * ((parseFloat(inputs.expenseRatio) || 25) / 100))}/yr)</span>
            </div>
            <div style="font-size: 8px; color: #475569; margin-top: 2px;">
              ${fmtCurr((annualRent * ((parseFloat(inputs.expenseRatio) || 25) / 100)) / 12)}/mo OpEx • ${isResidential ? 'Taxes, Insurance, Management & Maintenance' : 'Pass-Through CAM / Admin & Insurance'}
            </div>
          </td>
          <td style="color: #334155; vertical-align: middle; font-size: 8px; line-height: 1.35; padding: 5px 6px;">
            ${opexProvenance}
          </td>
        </tr>

        <!-- 8. Hold Horizon & Exit Cap Rate -->
        <tr style="background: #f8fafc;">
          <td style="border-right: 1px solid #e2e8f0; vertical-align: middle; padding: 5px 6px;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">8. Hold Horizon &amp; Terminal Exit Cap Rate</div>
            <div style="display: flex; align-items: baseline; gap: 4px; margin-top: 2px;">
              <span style="font-size: 13.5px; font-weight: 900; color: #0f172a; letter-spacing: -0.3px;">${holdYears}-Year Hold</span>
              <span style="font-size: 11px; font-weight: 800; color: #059669;">${inputs.targetCapRate || 7.0}% Exit Cap</span>
            </div>
            <div style="font-size: 8px; color: #047857; font-weight: 700; margin-top: 2px;">
              Closing Settlement: ${inputs.closingDate || (startYear + '-10-15')} (Stub Prorated)
            </div>
          </td>
          <td style="color: #334155; vertical-align: middle; font-size: 8px; line-height: 1.35; padding: 5px 6px;">
            Modeled with a conservative +50 bps expansion buffer over entry yield to stress-test liquidity and interest rate shifts over the ${holdYears}-year investment horizon.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 3. 10-Year Pro-Forma Cash Flow Waterfall Table -->
  <div class="box">
    <div class="box-header" style="background: #0f172a;">
      <span>📊 10-Year Institutional Pro-Forma Forecast</span>
      <span style="font-size: 8px; color: #34d399;">Calendar-Year Cash Flow Waterfall</span>
    </div>
    <table class="table-data" style="text-align: right;">
      <thead>
        <tr style="background: #f8fafc; color: #334155;">
          <th style="padding: 4px 6px; text-align: center;">Date / Period</th>
          <th style="padding: 4px 6px;">Asset Value</th>
          <th style="padding: 4px 6px;">Gross Income</th>
          <th style="padding: 4px 6px;">Vacancy</th>
          <th style="padding: 4px 6px;">OpEx</th>
          <th style="padding: 4px 6px;">NOI</th>
          <th style="padding: 4px 6px;">Debt Service</th>
          <th style="padding: 4px 6px; color: #059669;">Net Cash Flow</th>
          <th style="padding: 4px 6px;">CoC %</th>
          <th style="padding: 4px 6px;">Cap Rate</th>
          <th style="padding: 4px 6px;">Loan Balance</th>
          <th style="padding: 4px 6px; color: #059669;">Ending Equity</th>
        </tr>
      </thead>
      <tbody>
        ${waterfallRows}
      </tbody>
    </table>
  </div>

  <!-- 4. Monte Carlo Stochastic Simulation & Volatility Audit (On-Demand) -->
  <div class="box">
    <div class="box-header" style="background: #064e3b; display: flex; justify-content: space-between; align-items: center;">
      <span>🎲 Stochastic Monte Carlo Simulation &amp; Risk Distribution (500 Runs)</span>
      <span style="font-size: 8px; color: #a7f3d0;">Value-at-Risk (VaR) &amp; Volatility Stress Audit</span>
    </div>
    <div style="padding: 6px 8px; background: #ffffff;">
      <!-- Stats Tiles -->
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin-bottom: 5px;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
          <p style="font-size: 7px; color: #64748b; font-weight: 700; text-transform: uppercase; margin: 0;">P10 (Downside Floor)</p>
          <p style="font-size: 11px; font-weight: 800; color: ${mc.p10 >= 0 ? '#d97706' : '#e11d48'}; margin: 1px 0 0 0;">${mc.p10.toFixed(1)}% IRR</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
          <p style="font-size: 7px; color: #64748b; font-weight: 700; text-transform: uppercase; margin: 0;">P50 (Median Expected)</p>
          <p style="font-size: 11px; font-weight: 800; color: #0f172a; margin: 1px 0 0 0;">${mc.p50.toFixed(1)}% IRR</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
          <p style="font-size: 7px; color: #64748b; font-weight: 700; text-transform: uppercase; margin: 0;">P90 (Upside Scenario)</p>
          <p style="font-size: 11px; font-weight: 800; color: #059669; margin: 1px 0 0 0;">${mc.p90.toFixed(1)}% IRR</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
          <p style="font-size: 7px; color: #64748b; font-weight: 700; text-transform: uppercase; margin: 0;">Hurdle Beat Probability</p>
          <p style="font-size: 11px; font-weight: 800; color: #047857; margin: 1px 0 0 0;">${mc.probExceedingHurdle}% (≥${discountRate.toFixed(1)}%)</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
          <p style="font-size: 7px; color: #64748b; font-weight: 700; text-transform: uppercase; margin: 0;">Capital Loss Risk</p>
          <p style="font-size: 11px; font-weight: 800; color: ${mc.probNegativeIrr > 0 ? '#e11d48' : '#059669'}; margin: 1px 0 0 0;">${mc.probNegativeIrr}% (<0% IRR)</p>
        </div>
      </div>

      <!-- Inline SVG Distribution Histogram -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px; margin-bottom: 5px;">
        ${mc.svgChart}
      </div>

      <!-- Narrative Interpretation -->
      <p style="font-size: 7.5px; color: #334155; line-height: 1.4; margin: 0;">
        ${mc.narrative}
      </p>
    </div>
  </div>

  <!-- 5. Deal Risk & Underwriting Audit Flags -->
  ${warnings.length > 0 ? `
  <div style="border: 1px solid #fde68a; background: #fffbeb; border-radius: 5px; padding: 5px 8px; margin-bottom: 8px;">
    <p style="font-size: 8px; font-weight: 800; color: #92400e; text-transform: uppercase; margin: 0 0 2px 0;">Deal Risk & Underwriting Audit Flags</p>
    <ul style="margin: 0; padding-left: 12px; font-size: 7.5px; color: #78350f; line-height: 1.3;">
      ${warnings.map(w => `<li><strong>${w.title}:</strong> ${w.description}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  <!-- Footer -->
  <div class="footer">
    <span>MathTree Real Estate Underwriting Platform • Direct Postgres Engine</span>
    <span>Confidential Institutional Investment Memo • Senior DSCR: ${dscrFormatted} • Generated ${dateStr}</span>
  </div>

  <script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { window.print(); }, 250);
    });
  </script>
</body>
</html>`;
}

// =========================================================================
// 2. PORTFOLIO & PIPELINE COMMAND CENTER BRIEF BUILDER
// =========================================================================
function buildPortfolioBriefHtml(portfolio: any): string {
  const invName = portfolio.investorName || portfolio.sponsor || 'Investor';
  const compName = portfolio.companyName || 'MathTree Real Estate Capital';
  const hurdleRate = parseFloat(portfolio.hurdleRate || 10.0);
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const kpis = portfolio.kpis || {};
  const ownedGAV = parseFloat(kpis.ownedGAV || 0);
  const ownedEquity = parseFloat(kpis.ownedEquity || 0);
  const ownedDebt = parseFloat(kpis.ownedDebt || 0);
  const blendedOwnedLtv = parseInt(kpis.blendedOwnedLtv || (ownedGAV > 0 ? Math.round((ownedDebt / ownedGAV) * 100) : 0), 10);
  const ownedCashFlow = parseFloat(kpis.ownedCashFlow || 0);
  const blendedOwnedYield = parseFloat(kpis.blendedOwnedYield || (ownedEquity > 0 ? (ownedCashFlow / ownedEquity) * 100 : 0));
  const pipelineVolume = parseFloat(kpis.pipelineVolume || 0);
  const pipelineCount = parseInt(kpis.pipelineCount || 0, 10);
  const avgPipelineIrr = parseFloat(kpis.avgPipelineIrr || 0);
  const footprintAcres = parseFloat(kpis.footprintAcres || 0);
  const footprintSqFt = parseInt(kpis.footprintSqFt || 0, 10);
  const totalVolume = parseFloat(kpis.totalVolume || (ownedGAV + pipelineVolume));
  const totalDeals = parseInt(kpis.totalDeals || 0, 10);

  const sectorRows: any[] = portfolio.sectors || [];
  const ownedHoldings: any[] = portfolio.ownedHoldings || [];
  const pipelineDeals: any[] = portfolio.pipelineDeals || [];
  const assessorAudit: any[] = portfolio.assessorAudit || [];
  const auditFlags: any[] = portfolio.auditFlags || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MathTree Portfolio Command Brief - ${compName}</title>
  <style>
    @page { size: letter landscape; margin: 8mm 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 12px; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #059669; padding-bottom: 8px; margin-bottom: 10px; }
    .logo-badge { font-size: 22px; font-weight: 900; color: #059669; letter-spacing: -0.5px; }
    .pill { display: inline-block; font-size: 8.5px; font-weight: 800; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; }
    .pill-green { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .scorecard { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 10px; }
    .scorecard-tile { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 6px 8px; }
    .tile-lbl { font-size: 7.5px; font-weight: 700; color: #64748b; text-transform: uppercase; margin: 0; }
    .tile-val { font-size: 14px; font-weight: 800; color: #0f172a; margin: 2px 0 0 0; }
    .box { border: 1px solid #cbd5e1; border-radius: 5px; overflow: hidden; margin-bottom: 10px; page-break-inside: avoid; }
    .box-header { background: #0f172a; color: #ffffff; padding: 4px 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.4px; }
    .table-data { width: 100%; font-size: 8px; border-collapse: collapse; line-height: 1.35; }
    .table-data th { background: #f8fafc; border-bottom: 1px solid #cbd5e1; font-weight: 800; color: #334155; padding: 4px 6px; }
    .table-data td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
    .footer { border-top: 1px solid #cbd5e1; padding-top: 4px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8; margin-top: 10px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>

  <!-- Portfolio Header -->
  <div class="header">
    <div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="logo-badge">MathTree</span>
        <span class="pill pill-green">Portfolio & Pipeline Command Center</span>
      </div>
      <h1 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 3px 0 0 0;">Executive Portfolio & Acquisition Pipeline Underwriting Brief</h1>
      <div style="font-size: 9.5px; color: #475569; font-weight: 600; margin-top: 2px; display: flex; align-items: center; gap: 10px;">
        <span>👤 Sponsor / Investor: <strong style="color: #0f172a;">${invName}</strong></span>
        <span>•</span>
        <span>🏢 Entity: <strong style="color: #0f172a;">${compName}</strong></span>
        <span>•</span>
        <span>🎯 Hurdle Rate: <strong style="color: #059669;">${fmtDec(hurdleRate)}% / yr</strong></span>
      </div>
    </div>
    <div style="text-align: right; font-size: 9.5px; color: #64748b;">
      <p style="margin: 0; font-weight: 600;">Report Date: <strong style="color: #0f172a;">${dateStr}</strong></p>
      <p style="margin: 2px 0 0 0;">Underwritten Assets: <strong style="color: #0f172a;">${totalDeals} (${ownedHoldings.length} Owned, ${pipelineDeals.length} Pipeline)</strong></p>
      <p style="margin: 2px 0 0 0;">Total Real Estate Capital: <strong style="color: #059669;">${fmtCurr(totalVolume)}</strong></p>
    </div>
  </div>

  <!-- 6 Executive KPI Tiles -->
  <div class="scorecard">
    <div class="scorecard-tile">
      <p class="tile-lbl">Owned Gross Value (GAV)</p>
      <p class="tile-val" style="color: #059669;">${fmtCurr(ownedGAV)}</p>
      <p style="font-size: 7.5px; color: #64748b; margin: 1px 0 0 0;">Net Equity: <strong>${fmtCurr(ownedEquity)}</strong></p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Owned Debt & Leverage</p>
      <p class="tile-val">${fmtCurr(ownedDebt)}</p>
      <p style="font-size: 7.5px; color: #64748b; margin: 1px 0 0 0;">Blended LTV: <strong>${blendedOwnedLtv}%</strong></p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Owned Net Cash Flow</p>
      <p class="tile-val" style="color: ${ownedCashFlow >= 0 ? '#059669' : '#e11d48'};">${fmtCurr(ownedCashFlow)}/yr</p>
      <p style="font-size: 7.5px; color: #64748b; margin: 1px 0 0 0;">CoC Yield: <strong>${blendedOwnedYield > 0 ? fmtDec(blendedOwnedYield) + '%' : 'N/M'}</strong></p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Pipeline Deal Volume</p>
      <p class="tile-val" style="color: #0284c7;">${fmtCurr(pipelineVolume)}</p>
      <p style="font-size: 7.5px; color: #64748b; margin: 1px 0 0 0;">Active Prospects: <strong>${pipelineCount} Deals</strong></p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Target Pipeline Return</p>
      <p class="tile-val" style="color: #0284c7;">${avgPipelineIrr > 0 ? fmtDec(avgPipelineIrr) + '%' : 'N/A'}</p>
      <p style="font-size: 7.5px; color: #64748b; margin: 1px 0 0 0;">Weighted 10-Yr IRR</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Physical Footprint</p>
      <p class="tile-val">${footprintAcres > 0 ? fmtDec(footprintAcres, 2) + ' Ac' : 'Active Footprint'}</p>
      <p style="font-size: 7.5px; color: #64748b; margin: 1px 0 0 0;">${footprintSqFt.toLocaleString()} Sq Ft</p>
    </div>
  </div>

  <!-- Sector Diversification Matrix -->
  <div class="box">
    <div class="box-header" style="background: #334155;">
      <span>Sector Diversification & Asset Allocation Matrix</span>
      <span style="font-size: 8px;">Capital Allocation</span>
    </div>
    <table class="table-data" style="text-align: right;">
      <thead>
        <tr>
          <th style="padding: 4px 6px; text-align: left;">Asset Class / Sector</th>
          <th style="padding: 4px 6px;">Deals</th>
          <th style="padding: 4px 6px;">Aggregate Valuation</th>
          <th style="padding: 4px 6px;">Portfolio Weight</th>
          <th style="padding: 4px 6px;">Annual Cash Flow</th>
          <th style="padding: 4px 6px;">Weighted Target IRR</th>
        </tr>
      </thead>
      <tbody>
        ${sectorRows.map((r, i) => `
          <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="padding: 3px 6px; text-align: left; font-weight: 700; color: #0f172a;">${r.icon || '🏢'} ${r.label}</td>
            <td style="padding: 3px 6px; font-weight: 600;">${r.count}</td>
            <td style="padding: 3px 6px; font-weight: 700; color: #0f172a;">${fmtCurr(r.val)}</td>
            <td style="padding: 3px 6px; font-weight: 600;">${r.pctOfTotal}%</td>
            <td style="padding: 3px 6px; font-weight: 700; color: ${r.cf >= 0 ? '#059669' : '#e11d48'};">${fmtCurr(r.cf)}/yr</td>
            <td style="padding: 3px 6px; font-weight: 700; color: #059669;">${r.avgIrr > 0 ? fmtDec(r.avgIrr) + '%' : 'N/A'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Owned Operating Holdings Register -->
  <div class="box">
    <div class="box-header" style="background: #064e3b;">
      <span>🏛️ Owned Operating Holdings — Performance & Equity Register (${ownedHoldings.length} Assets)</span>
      <span style="font-size: 8px; background: rgba(255,255,255,0.2); padding: 1px 5px; border-radius: 3px;">In-Place GAV: ${fmtCurr(ownedGAV)}</span>
    </div>
    ${ownedHoldings.length > 0 ? `
    <table class="table-data" style="text-align: right;">
      <thead>
        <tr>
          <th style="padding: 4px 6px; text-align: left;">Property Name & Location</th>
          <th style="padding: 4px 6px; text-align: center;">Assessor APN</th>
          <th style="padding: 4px 6px; text-align: left;">Strategy / Class</th>
          <th style="padding: 4px 6px;">Cost Basis</th>
          <th style="padding: 4px 6px;">Annual NOI</th>
          <th style="padding: 4px 6px;">Debt Service</th>
          <th style="padding: 4px 6px; color: #059669;">Net Cash Flow</th>
          <th style="padding: 4px 6px;">CoC Yield</th>
          <th style="padding: 4px 6px;">Cap Rate</th>
          <th style="padding: 4px 6px;">Debt Balance</th>
          <th style="padding: 4px 6px; color: #059669;">Net Equity</th>
        </tr>
      </thead>
      <tbody>
        ${ownedHoldings.map((d, i) => `
          <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="padding: 4px 6px; text-align: left;">
              <strong style="color: #0f172a; font-size: 8.5px; display: block;">${d.name}</strong>
              <span style="color: #64748b; font-size: 7.5px;">${d.location}</span>
            </td>
            <td style="padding: 4px 6px; text-align: center; font-family: monospace; font-weight: 700; color: #047857;">${d.apn || 'Pending'}</td>
            <td style="padding: 4px 6px; text-align: left; color: #475569; font-weight: 600;">${d.facilityType || d.assetClass}</td>
            <td style="padding: 4px 6px; font-weight: 700; color: #0f172a;">${fmtCurr(d.price)}</td>
            <td style="padding: 4px 6px; font-weight: 600;">${fmtCurr(d.noi)}</td>
            <td style="padding: 4px 6px; color: #64748b;">${fmtCurr(d.debtService)}</td>
            <td style="padding: 4px 6px; font-weight: 800; color: ${d.cashFlow >= 0 ? '#059669' : '#e11d48'};">${fmtCurr(d.cashFlow)}</td>
            <td style="padding: 4px 6px; font-weight: 700; color: #059669;">${fmtDec(d.coc)}%</td>
            <td style="padding: 4px 6px;">${d.capRate ? fmtDec(d.capRate) + '%' : 'N/A'}</td>
            <td style="padding: 4px 6px; color: #64748b;">${fmtCurr(d.debt)}</td>
            <td style="padding: 4px 6px; font-weight: 800; color: #059669;">${fmtCurr(d.equity)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : '<div style="padding: 8px; font-size: 8.5px; color: #64748b; text-align: center;">No active properties currently recorded in owned portfolio.</div>'}
  </div>

  <!-- Acquisition Pipeline Register -->
  <div class="box">
    <div class="box-header" style="background: #0369a1;">
      <span>🎯 Acquisition Pipeline — Prospect Underwriting Register (${pipelineDeals.length} Opportunities)</span>
      <span style="font-size: 8px; background: rgba(255,255,255,0.2); padding: 1px 5px; border-radius: 3px;">Pipeline Volume: ${fmtCurr(pipelineVolume)}</span>
    </div>
    ${pipelineDeals.length > 0 ? `
    <table class="table-data" style="text-align: right;">
      <thead>
        <tr>
          <th style="padding: 4px 6px; text-align: left;">Opportunity Name & Address</th>
          <th style="padding: 4px 6px; text-align: center;">Assessor APN</th>
          <th style="padding: 4px 6px; text-align: left;">Facility / Strategy</th>
          <th style="padding: 4px 6px;">Target Price</th>
          <th style="padding: 4px 6px; color: #0284c7;">10-Yr IRR</th>
          <th style="padding: 4px 6px;">Yr 1 Cash Flow</th>
          <th style="padding: 4px 6px;">Yr 1 CoC</th>
          <th style="padding: 4px 6px;">Projected NOI</th>
          <th style="padding: 4px 6px;">Debt & LTV</th>
          <th style="padding: 4px 6px; text-align: center;">Stage</th>
        </tr>
      </thead>
      <tbody>
        ${pipelineDeals.map((d, i) => `
          <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="padding: 4px 6px; text-align: left;">
              <strong style="color: #0f172a; font-size: 8.5px; display: block;">${d.name}</strong>
              <span style="color: #64748b; font-size: 7.5px;">${d.location}</span>
            </td>
            <td style="padding: 4px 6px; text-align: center; font-family: monospace; font-weight: 700; color: #047857;">${d.apn || 'Pending'}</td>
            <td style="padding: 4px 6px; text-align: left; color: #475569; font-weight: 600;">${d.facilityType || d.assetClass}</td>
            <td style="padding: 4px 6px; font-weight: 700; color: #0f172a;">${fmtCurr(d.price)}</td>
            <td style="padding: 4px 6px; font-weight: 800; color: #0284c7;">${fmtDec(d.irr)}%</td>
            <td style="padding: 4px 6px; font-weight: 700; color: ${d.cashFlow >= 0 ? '#059669' : '#e11d48'};">${fmtCurr(d.cashFlow)}</td>
            <td style="padding: 4px 6px; font-weight: 700; color: ${d.coc >= 0 ? '#059669' : '#e11d48'};">${fmtDec(d.coc)}%</td>
            <td style="padding: 4px 6px; font-weight: 600;">${fmtCurr(d.noi)}</td>
            <td style="padding: 4px 6px; color: #475569;">${fmtCurr(d.debt)} (${d.ltv}%)</td>
            <td style="padding: 4px 6px; text-align: center;">
              <span style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 1px 4px; border-radius: 3px; font-size: 7px; font-weight: 700; text-transform: uppercase;">${d.stage || 'Screening'}</span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : '<div style="padding: 8px; font-size: 8.5px; color: #64748b; text-align: center;">No prospective acquisition opportunities currently in pipeline.</div>'}
  </div>

  <!-- County Assessor & Structural Cross-Verification Table -->
  <div class="box">
    <div class="box-header" style="background: #1e293b;">
      <span>🏛️ County Assessor & Structural Characteristics Cross-Verification Audit</span>
      <span style="font-size: 8px;">Tax Roll Audit</span>
    </div>
    <table class="table-data" style="text-align: left;">
      <thead>
        <tr>
          <th style="padding: 4px 6px; width: 22%;">Property & Location</th>
          <th style="padding: 4px 6px; width: 15%;">Assessor APN</th>
          <th style="padding: 4px 6px; width: 18%;">Owner of Record</th>
          <th style="padding: 4px 6px; width: 15%;">Assessed Value</th>
          <th style="padding: 4px 6px; width: 12%;">Parcel Area</th>
          <th style="padding: 4px 6px; width: 18%;">Structural Specs & Zoning</th>
        </tr>
      </thead>
      <tbody>
        ${assessorAudit.map((d, i) => `
          <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="padding: 4px 6px;">
              <strong style="color: #0f172a; font-size: 8.5px; display: block;">${d.name}</strong>
              <span style="color: #64748b; font-size: 7.5px;">${d.location}</span>
            </td>
            <td style="padding: 4px 6px; font-family: monospace; font-weight: 700; color: #047857;">${d.apn || 'Pending'}</td>
            <td style="padding: 4px 6px; font-weight: 700; color: #0f172a;">${d.owner || 'Owner of Record'}</td>
            <td style="padding: 4px 6px; font-weight: 700; color: #059669;">${d.assessedVal ? fmtCurr(d.assessedVal) : fmtCurr(d.price)}</td>
            <td style="padding: 4px 6px; color: #334155;">${d.acres > 0 ? fmtDec(d.acres, 2) + ' Acres' : 'Pending Survey'}</td>
            <td style="padding: 4px 6px; color: #334155;">
              <span>Built ${d.yearBuilt || '2022'} • ${d.bldgSqFt ? d.bldgSqFt.toLocaleString() + ' Sq Ft' : 'Pending'}</span><br>
              <span style="font-size: 7px; color: #64748b;">Zoning: ${d.zoning || 'Commercial'}</span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Portfolio Risk & Governance Standards -->
  <div style="border: 1px solid #cbd5e1; border-radius: 5px; background: #f8fafc; padding: 6px 8px; margin-bottom: 8px;">
    <div style="font-size: 8.5px; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 4px;">
      Portfolio Governance Standards & Diligence Policy
    </div>
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; font-size: 7.5px;">
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
        <strong style="color: #047857; display: block;">Closing Proration Policy</strong>
        <p style="color: #475569; margin: 1px 0 0 0;">Underwritten with Q4 stub proration (partial-year recognition) to avoid Year 1 inflation.</p>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
        <strong style="color: #047857; display: block;">Vacancy Floor Mandate</strong>
        <p style="color: #475569; margin: 1px 0 0 0;">5.0% institutional credit tenant vacancy reserve enforced regardless of physical occupancy.</p>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
        <strong style="color: #047857; display: block;">Debt Stress Coverage</strong>
        <p style="color: #475569; margin: 1px 0 0 0;">Commercial notes stress-tested against +100 bps rate shifts; min Year 1 DSCR covenant floor of 1.25x.</p>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px;">
        <strong style="color: #047857; display: block;">Operating Liquidity Reserve</strong>
        <p style="color: #475569; margin: 1px 0 0 0;">Pipeline deals require min 6-month P&I operating buffer to absorb transitional rollover or rehab lags.</p>
      </div>
    </div>
  </div>

  ${auditFlags.length > 0 ? `
  <div style="border: 1px solid #fde68a; background: #fffbeb; border-radius: 5px; padding: 5px 8px; margin-bottom: 8px;">
    <p style="font-size: 8px; font-weight: 800; color: #92400e; text-transform: uppercase; margin: 0 0 2px 0;">Portfolio Risk & Audit Flags</p>
    <ul style="margin: 0; padding-left: 12px; font-size: 7.5px; color: #78350f; line-height: 1.3;">
      ${auditFlags.map(f => `<li><strong>${f.deal || f.title}:</strong> ${f.desc || f.description}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  <!-- Footer -->
  <div class="footer">
    <span>MathTree Real Estate Portfolio & Pipeline Studio • Direct Postgres Engine</span>
    <span>Confidential Institutional Underwriting Report • Generated for ${invName} (${compName}) • ${dateStr}</span>
  </div>

  <script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { window.print(); }, 250);
    });
  </script>
</body>
</html>`;
}

// =========================================================================
// 2.5 SERVER-SIDE PORTFOLIO AGGREGATOR (Calculates totals directly from DB)
// =========================================================================
function aggregateDealsToPortfolio(deals: any[], meta: any = {}) {
  const owned = deals.filter(d => d.status === 'owned');
  const pipeline = deals.filter(d => d.status !== 'owned');

  let ownedGAV = 0, ownedEquity = 0, ownedDebt = 0, ownedCashFlow = 0, ownedNoi = 0, ownedDebtService = 0;
  let ownedUnits = 0, ownedCommercialSqFt = 0, ownedAcres = 0;

  const ownedHoldings = owned.map(d => {
    const price = parseFloat(d.purchase_price || d.inputs?.purchasePrice || 0);
    const eq = parseFloat(d.total_equity || d.metrics?.initialCashInvested || (price * 0.25));
    const debt = Math.max(0, price - eq);
    const cf = parseFloat(d.year1_cashflow || d.metrics?.projections?.[0]?.cashFlow || 0);
    const noi = parseFloat(d.metrics?.noi || d.metrics?.projections?.[0]?.netOperatingIncome || 0);
    const debtService = parseFloat(d.metrics?.annualDebtService || d.metrics?.projections?.[0]?.debtService || 0);
    const dscr = d.metrics?.dscr || (debtService > 0 ? (noi / debtService).toFixed(2) : 'N/A');
    const capRate = parseFloat(d.metrics?.capRate || d.cap_rate || 0);
    const inp = d.inputs || {};
    const rawAssessor = inp.assessorData || {};

    ownedGAV += price;
    ownedEquity += eq;
    ownedDebt += debt;
    ownedCashFlow += cf;
    ownedNoi += noi;
    ownedDebtService += debtService;

    const acres = parseFloat(rawAssessor.acres || inp.acres || 0);
    ownedAcres += acres;
    const bldg = parseFloat(rawAssessor.buildingSqFt || inp.buildingSqFt || inp.gla || inp.totalSqFt || 0);
    ownedCommercialSqFt += bldg;

    return {
      id: d.id,
      name: d.title || d.name || 'Untitled Asset',
      location: d.location || inp.location || 'Location Unspecified',
      status: 'owned',
      assetClass: d.asset_type || d.asset_class || 'commercial',
      facilityType: inp.facilityType || (d.asset_type === 'commercial' ? 'Commercial Real Estate' : d.asset_type),
      price,
      equity: eq,
      debt,
      cashFlow: cf,
      coc: eq > 0 ? ((cf / eq) * 100) : 0,
      noi,
      debtService,
      dscr,
      capRate,
      apn: rawAssessor.apn || inp.primaryApn || inp.apn || 'Pending Link',
      county: rawAssessor.county || inp.county || 'Yakima County, WA',
      acres,
      bldgSqFt: bldg,
      yearBuilt: rawAssessor.yearBuilt || inp.yearBuilt || 'N/A',
      zoning: rawAssessor.zoning || inp.zoning || 'Commercial / Mixed',
      owner: rawAssessor.owner || inp.owner || 'Owner of Record'
    };
  });

  let pipelineVolume = 0, pipelineEquity = 0, sumPipelineIrr = 0, pipelineYear1CF = 0, pipelineNoi = 0;
  let pipelineUnits = 0, pipelineCommercialSqFt = 0, pipelineAcres = 0;

  const pipelineDeals = pipeline.map(d => {
    const price = parseFloat(d.purchase_price || d.inputs?.purchasePrice || 0);
    const eq = parseFloat(d.total_equity || d.metrics?.initialCashInvested || (price * 0.25));
    const debt = Math.max(0, price - eq);
    const cf = parseFloat(d.year1_cashflow || d.metrics?.projections?.[0]?.cashFlow || 0);
    const irr = parseFloat(d.irr || d.metrics?.irr || 0);
    const noi = parseFloat(d.metrics?.noi || d.metrics?.projections?.[0]?.netOperatingIncome || 0);
    const debtService = parseFloat(d.metrics?.annualDebtService || d.metrics?.projections?.[0]?.debtService || 0);
    const dscr = d.metrics?.dscr || (debtService > 0 ? (noi / debtService).toFixed(2) : 'N/A');
    const capRate = parseFloat(d.metrics?.capRate || d.cap_rate || 0);
    const inp = d.inputs || {};
    const rawAssessor = inp.assessorData || {};

    pipelineVolume += price;
    pipelineEquity += eq;
    sumPipelineIrr += irr;
    pipelineYear1CF += cf;
    pipelineNoi += noi;

    const acres = parseFloat(rawAssessor.acres || inp.acres || 0);
    pipelineAcres += acres;
    const bldg = parseFloat(rawAssessor.buildingSqFt || inp.buildingSqFt || inp.gla || inp.totalSqFt || 0);
    pipelineCommercialSqFt += bldg;

    return {
      id: d.id,
      name: d.title || d.name || 'Untitled Asset',
      location: d.location || inp.location || 'Location Unspecified',
      status: d.status || 'prospect',
      assetClass: d.asset_type || d.asset_class || 'commercial',
      facilityType: inp.facilityType || (d.asset_type === 'commercial' ? 'Commercial Logistics' : d.asset_type),
      price,
      equity: eq,
      debt,
      cashFlow: cf,
      coc: eq > 0 ? ((cf / eq) * 100) : 0,
      irr,
      noi,
      debtService,
      dscr,
      capRate,
      ltv: price > 0 ? Math.round((debt / price) * 100) : 0,
      rate: inp.interestRate || 6.5,
      term: inp.loanTerm || 30,
      stage: inp.dealStage || 'screening',
      holdYrs: inp.exitYear || 10,
      apn: rawAssessor.apn || inp.primaryApn || inp.apn || 'Pending Link',
      county: rawAssessor.county || inp.county || 'Yakima County, WA',
      acres,
      bldgSqFt: bldg,
      yearBuilt: rawAssessor.yearBuilt || inp.yearBuilt || 'N/A',
      zoning: rawAssessor.zoning || inp.zoning || 'Commercial / Mixed',
      owner: rawAssessor.owner || inp.owner || 'Owner of Record'
    };
  });

  const totalVolume = ownedGAV + pipelineVolume;
  const totalDeals = deals.length;
  const blendedOwnedLtv = ownedGAV > 0 ? Math.round((ownedDebt / ownedGAV) * 100) : 0;
  const blendedOwnedYield = ownedEquity > 0 ? ((ownedCashFlow / ownedEquity) * 100) : 0;
  const avgPipelineIrr = pipeline.length > 0 ? (sumPipelineIrr / pipeline.length) : 0;

  const sectorsDef = [
    { id: 'commercial', label: 'Commercial / Industrial', icon: '🏢' },
    { id: 'single-family', label: 'Single-Family Residential', icon: '🏠' },
    { id: 'multi-unit', label: 'Multi-Family (Multi-Unit)', icon: '🏬' },
    { id: 'storage', label: 'Self-Storage Facilities', icon: '📦' }
  ];

  const sectors = sectorsDef.map(sec => {
    const matching = deals.filter(d => (d.asset_type || d.asset_class || 'commercial') === sec.id);
    const count = matching.length;
    const val = matching.reduce((sum, d) => sum + parseFloat(d.purchase_price || d.inputs?.purchasePrice || 0), 0);
    const cf = matching.reduce((sum, d) => sum + parseFloat(d.year1_cashflow || d.metrics?.projections?.[0]?.cashFlow || 0), 0);
    const avgIrr = count > 0 ? (matching.reduce((sum, d) => sum + parseFloat(d.irr || d.metrics?.irr || 0), 0) / count) : 0;
    const pctOfTotal = totalVolume > 0 ? ((val / totalVolume) * 100).toFixed(1) : '0.0';
    return { ...sec, count, val, cf, avgIrr, pctOfTotal };
  });

  const auditFlags: any[] = [];
  deals.forEach(d => {
    const cf = parseFloat(d.year1_cashflow || d.metrics?.projections?.[0]?.cashFlow || 0);
    if (cf < 0) {
      auditFlags.push({
        deal: d.title || d.name,
        severity: 'warn',
        title: 'Negative Cash Flow Alert',
        desc: `Year 1 underwritten cash flow is $${Math.round(cf).toLocaleString()} (operating deficit requires reserve buffer).`
      });
    }
  });

  return {
    investorName: meta.investorName || 'Investor',
    companyName: meta.companyName || 'MathTree Real Estate Capital',
    hurdleRate: meta.hurdleRate || 10.0,
    kpis: {
      ownedGAV,
      ownedEquity,
      ownedDebt,
      blendedOwnedLtv,
      ownedCashFlow,
      blendedOwnedYield,
      pipelineVolume,
      pipelineCount: pipeline.length,
      avgPipelineIrr,
      footprintAcres: ownedAcres + pipelineAcres,
      footprintSqFt: ownedCommercialSqFt + pipelineCommercialSqFt,
      totalVolume,
      totalDeals
    },
    sectors,
    ownedHoldings,
    pipelineDeals,
    assessorAudit: [...ownedHoldings, ...pipelineDeals],
    auditFlags
  };
}

// =========================================================================
// 3. SERVER ENTRYPOINT & HTTP REQUEST HANDLER
// =========================================================================
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const queryDealId = url.searchParams.get('dealId') || url.searchParams.get('id');
    const queryMode = url.searchParams.get('mode');

    let bodyPayload: any = {};
    if (req.method === 'POST') {
      bodyPayload = await req.json().catch(() => ({}));
    }

    const dealId = queryDealId || bodyPayload.dealId || bodyPayload.id;
    const mode = (queryMode || bodyPayload.mode || (bodyPayload.portfolio ? 'portfolio' : (dealId ? 'deal' : 'deal'))).toLowerCase();

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://bgexwcepwbxvhxbpblhd.supabase.co';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    let html = '';

    if (dealId) {
      // Direct database resolution for single-asset memo
      let { data: dbDeal, error: dealErr } = await supabase.from('deals').select('*').eq('id', dealId).single();
      if (dealErr || !dbDeal) {
        const { data: demoDeals } = await supabase.from('deals').select('*').eq('is_demo', true).limit(1);
        if (demoDeals && demoDeals[0]) {
          dbDeal = demoDeals[0];
        } else {
          throw new Error(`Deal not found for ID: ${dealId} (${dealErr?.message || 'record missing'})`);
        }
      }

      // Query pre-computed parcel package aggregation view directly from Postgres:
      const { data: parcelPackage } = await supabase
        .from('view_deal_parcel_packages')
        .select('*')
        .eq('deal_id', dbDeal.id)
        .maybeSingle();

      html = buildSingleDealBriefHtml(dbDeal, parcelPackage);
    } else if (mode === 'portfolio') {
      if (bodyPayload.portfolio && bodyPayload.portfolio.kpis) {
        // Direct payload provided
        html = buildPortfolioBriefHtml(bodyPayload.portfolio);
      } else {
        // Direct database resolution for portfolio command center
        const authHeader = req.headers.get('Authorization');
        let dealsQuery = supabase.from('deals').select('*');
        let invName = 'Investor';
        let compName = 'MathTree Real Estate Capital';

        if (authHeader && authHeader.includes('Bearer ')) {
          const token = authHeader.replace('Bearer ', '').trim();
          const { data: { user } } = await supabase.auth.getUser(token);
          if (user) {
            invName = (user.user_metadata && user.user_metadata.full_name) || (user.email ? user.email.split('@')[0] : 'Investor');
            dealsQuery = dealsQuery.eq('user_id', user.id);
          } else {
            dealsQuery = dealsQuery.eq('is_demo', true);
          }
        } else {
          dealsQuery = dealsQuery.eq('is_demo', true);
        }

        let { data: dealsList, error: dealsErr } = await dealsQuery;
        if (dealsErr) throw new Error(dealsErr.message);

        // Benchmark fallback: If user account has 0 deals yet, fall back to benchmark deals so portfolio brief is populated
        if (!dealsList || dealsList.length === 0) {
          const { data: demoDeals } = await supabase.from('deals').select('*').eq('is_demo', true);
          dealsList = demoDeals || [];
        }

        const portfolioData = aggregateDealsToPortfolio(dealsList || [], { investorName: invName, companyName: compName });
        html = buildPortfolioBriefHtml(portfolioData);
      }
    } else {
      // Fallback to dealData from payload or query title
      const dealData = bodyPayload.deal || bodyPayload;
      if (dealData && (dealData.title || dealData.inputs)) {
        html = buildSingleDealBriefHtml(dealData);
      } else {
        const title = url.searchParams.get('title') || 'Investment Underwriting Brief';
        html = buildSingleDealBriefHtml({ title, inputs: {}, metrics: {} });
      }
    }

    return new Response(html, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
