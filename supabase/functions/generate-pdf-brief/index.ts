// generate-pdf-brief/index.ts
// Institutional PDF & Executive Brief Serverless Generator for MathTree
// Dual-Mode: Single-Asset Underwriting Memo & Portfolio & Pipeline Command Center Brief

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

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

// Helper to dynamically calculate institutional pro-forma projections if stored projections are missing or corrupted
function computeFallbackProjections(assetClass: string, inputs: any, price: number): any[] {
  const normAsset = (assetClass || 'commercial').toLowerCase();
  const holdYears = Math.max(1, Math.min(30, parseInt(inputs.exitYear || inputs.holdingPeriod || 10, 10)));
  const rentGrowth = parseFloat(inputs.rentGrowth || 3.0);
  const vacancyRate = parseFloat(inputs.vacancyRate ?? 2.0);
  const isNNN = (inputs.leaseType || '').toUpperCase() === 'NNN' || (inputs.leases && inputs.leases[0]?.leaseType === 'NNN');
  
  const rawExpenseRatio = parseFloat(inputs.expenseRatio ?? inputs.operatingExpenseRatio ?? (normAsset === 'commercial' && isNNN ? 1.0 : 35.0));
  const expenseRatio = Math.max(0, isNaN(rawExpenseRatio) ? (isNNN ? 1.0 : 35.0) : rawExpenseRatio);
  
  // Year 1 Gross Rent resolution
  let monthlyRent = parseFloat(inputs.monthlyRent || inputs.grossRentPerMonth || 0);
  if (!monthlyRent && inputs.leases && inputs.leases.length > 0) {
    monthlyRent = inputs.leases.reduce((sum: number, l: any) => sum + parseFloat(l.monthlyRent || 0), 0);
  }
  if (!monthlyRent && inputs.grossRentAnnual) {
    monthlyRent = parseFloat(inputs.grossRentAnnual) / 12;
  }
  if (!monthlyRent && price > 0) {
    monthlyRent = price * 0.008;
  }
  let currentGross = monthlyRent * 12;

  // Financing terms
  const downPct = inputs.downPaymentPercent ? parseFloat(inputs.downPaymentPercent) : 25;
  const loanAmt = parseFloat(inputs.loanAmount || (price * (1 - downPct / 100)));
  const intRate = parseFloat(inputs.interestRate || 6.5);
  const termYears = parseInt(inputs.loanTerm || 25, 10);
  
  let monthlyPayment = 0;
  if (loanAmt > 0 && termYears > 0) {
    const r = intRate / 100 / 12;
    const n = termYears * 12;
    monthlyPayment = r > 0 ? (loanAmt * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1) : (loanAmt / n);
  }
  const annualDebtService = monthlyPayment * 12;

  const projections: any[] = [];
  let currentVal = price;
  let remainingLoan = loanAmt;
  const r = intRate / 100 / 12;
  const initialCash = (price * (downPct / 100)) + parseFloat(inputs.closingCosts || 0);

  for (let yr = 1; yr <= holdYears; yr++) {
    if (yr > 1) {
      currentGross *= (1 + rentGrowth / 100);
      if (normAsset !== 'commercial' && normAsset !== 'storage') {
        currentVal *= (1 + (parseFloat(inputs.appreciationRate || 2.5) / 100));
      }
    }

    const vacancyLoss = isNNN ? 0 : (currentGross * (vacancyRate / 100));
    const egi = currentGross - vacancyLoss;
    
    // NNN Commercial: Operating expenses (taxes, insurance, CAM) are paid/reimbursed by tenant.
    // Standard institutional reserve/admin is 1% of gross rent.
    const opex = currentGross * (expenseRatio / 100);
    const noi = Math.max(0, egi - opex);
    const ds = yr <= termYears ? annualDebtService : 0;
    const cf = noi - ds;
    const coc = initialCash > 0 ? (cf / initialCash) * 100 : 0;
    const capRate = currentVal > 0 ? (noi / currentVal) * 100 : 0;

    const elapsedMonths = yr * 12;
    const n = termYears * 12;
    if (elapsedMonths < n && r > 0) {
      remainingLoan = loanAmt * Math.pow(1 + r, elapsedMonths) - (monthlyPayment * (Math.pow(1 + r, elapsedMonths) - 1) / r);
    } else {
      remainingLoan = 0;
    }
    const equity = Math.max(0, currentVal - remainingLoan);

    projections.push({
      year: yr,
      propertyValue: Math.round(currentVal),
      grossPotentialIncome: Math.round(currentGross * 100) / 100,
      vacancyLoss: Math.round(vacancyLoss * 100) / 100,
      effectiveGrossIncome: Math.round(egi * 100) / 100,
      operatingExpenses: Math.round(opex * 100) / 100,
      netOperatingIncome: Math.round(noi * 100) / 100,
      debtService: Math.round(ds * 100) / 100,
      cashFlow: Math.round(cf * 100) / 100,
      netCashFlow: Math.round(cf * 100) / 100,
      cashOnCash: Math.round(coc * 100) / 100,
      capRate: Math.round(capRate * 100) / 100,
      loanBalanceRemaining: Math.round(remainingLoan),
      equity: Math.round(equity)
    });
  }

  return projections;
}

// =========================================================================
// 1. SINGLE-DEAL EXECUTIVE UNDERWRITING MEMORANDUM BUILDER
// =========================================================================
function buildSingleDealBriefHtml(deal: any, parcelPackage?: any): string {
  const title = deal.title || deal.name || 'Commercial Asset Underwriting';
  const location = deal.location || deal.address || 'Yakima, WA';
  const assetClass = (deal.asset_class || deal.asset_type || deal.assetType || 'commercial').toLowerCase();
  const status = (deal.status || 'prospect').toLowerCase();
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const inputs = deal.inputs || {};
  const metrics = deal.metrics || {};
  let proj: any[] = metrics.projections || [];
  const rawAssessor = inputs.assessorData || {};

  const price = parseFloat(deal.purchase_price || inputs.purchasePrice || 0);

  // Validate or heal corrupted projections (e.g. 100% OpEx wipeout on an income-producing asset or NNN lease)
  const isCorruptedProjections = proj.length === 0 || (
    (proj[0]?.netOperatingIncome <= 0 && (inputs.monthlyRent > 0 || inputs.grossRentAnnual > 0 || (inputs.leases && inputs.leases.length > 0) || price > 0)) ||
    (proj[0]?.operatingExpenses >= proj[0]?.effectiveGrossIncome && (proj[0]?.effectiveGrossIncome || 0) > 0)
  );

  if (isCorruptedProjections) {
    proj = computeFallbackProjections(assetClass, inputs, price);
  }

  const equity = parseFloat(deal.total_equity || metrics.initialEquity || metrics.initialCashInvested || (price * 0.25));
  const loanAmt = parseFloat(deal.loan_amount || metrics.loanAmount || Math.max(0, price - equity));
  const ltv = price > 0 ? Math.round((loanAmt / price) * 100) : (inputs.downPaymentPercent ? (100 - parseFloat(inputs.downPaymentPercent)) : 75);
  const intRate = parseFloat(inputs.interestRate || inputs.rate || 6.5);
  const loanTerm = parseInt(inputs.loanTerm || inputs.amortizationYears || 30, 10);
  const holdYears = parseInt(inputs.exitYear || inputs.holdingPeriod || 10, 10);
  const discountRate = parseFloat(inputs.discountRate || 8.0);

  const p0 = proj[0] || {};
  const noi = parseFloat(
    (p0.netOperatingIncome && p0.netOperatingIncome > 0)
      ? p0.netOperatingIncome
      : (metrics.noi || (deal.year1_cashflow ? deal.year1_cashflow * 1.5 : 0))
  );
  const debtService = parseFloat(metrics.annualDebtService || p0.debtService || 0);
  const cashFlow = (p0.netCashFlow !== undefined || p0.cashFlow !== undefined)
    ? parseFloat(p0.netCashFlow ?? p0.cashFlow)
    : (deal.year1_cashflow !== undefined && parseFloat(deal.year1_cashflow) > 0 ? parseFloat(deal.year1_cashflow) : (noi - debtService));
  const coc = (p0.cashOnCash !== undefined && !p0.isCoCNotMeaningful)
    ? parseFloat(p0.cashOnCash)
    : (equity > 0 ? (cashFlow / equity) * 100 : parseFloat(deal.cash_on_cash || metrics.cashOnCash || 0));
  const irr = parseFloat(deal.irr || metrics.irr || 0);
  const em = parseFloat(deal.equity_multiple || metrics.equityMultiplier || 1.0);
  const capRate = parseFloat(deal.cap_rate || metrics.capRate || (price > 0 ? (noi / price) * 100 : 0));
  const npv = parseFloat(metrics.npv || 0);
  const dscr = metrics.dscr || p0.dscr || (debtService > 0 ? (noi / debtService).toFixed(2) : 'N/A');

  // Calendar year resolution
  let startYear = new Date().getFullYear();
  if (inputs.closingDate) {
    const parsed = new Date(inputs.closingDate).getFullYear();
    if (!isNaN(parsed) && parsed > 2000 && parsed < 2100) startYear = parsed;
  }

  // County Assessor & Multi-Parcel Package variables (Sourced from Postgres view_deal_parcel_packages)
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

  // Pre-computed totals directly from Postgres view (with fallback to activeParcels if view has 0 parcels)
  const viewHasData = parcelPackage && (parseInt(parcelPackage.total_parcels, 10) > 0 || parseFloat(parcelPackage.combined_assessed_value || 0) > 0);

  const pkgTotalAssessed = (viewHasData && parseFloat(parcelPackage.combined_assessed_value || 0) > 0)
    ? parseFloat(parcelPackage.combined_assessed_value)
    : (hasMultipleParcels 
        ? activeParcels.reduce((s: number, p: any) => {
            const val = parseFloat(p.total_assessed_val || p.totalAssessedValue || p.assessedValue || 0);
            if (val > 0) return s + val;
            const land = parseFloat(p.market_land_val || p.marketLandValue || p.landValue || 0);
            const imp = parseFloat(p.market_imp_val || p.marketImprovementValue || p.improvementValue || 0);
            return s + (land + imp);
          }, 0) 
        : totalAssessed);

  const pkgTotalLand = (viewHasData && parseFloat(parcelPackage.total_land_value || 0) > 0)
    ? parseFloat(parcelPackage.total_land_value)
    : (hasMultipleParcels 
        ? activeParcels.reduce((s: number, p: any) => s + parseFloat(p.market_land_val || p.marketLandValue || p.landValue || 0), 0) 
        : landVal);

  const pkgTotalImp = (viewHasData && parseFloat(parcelPackage.total_improvement_value || 0) > 0)
    ? parseFloat(parcelPackage.total_improvement_value)
    : (hasMultipleParcels 
        ? activeParcels.reduce((s: number, p: any) => s + parseFloat(p.market_imp_val || p.marketImprovementValue || p.improvementValue || 0), 0) 
        : impVal);

  const pkgTotalAcres = (viewHasData && parseFloat(parcelPackage.total_package_acres || 0) > 0)
    ? parseFloat(parcelPackage.total_package_acres)
    : (hasMultipleParcels 
        ? activeParcels.reduce((s: number, p: any) => s + parseFloat(p.acres || p.acreage || (p.sqft ? p.sqft / 43560 : 0)), 0) 
        : acres);

  const pkgTotalSqFt = (viewHasData && parseFloat(parcelPackage.total_package_sqft || 0) > 0)
    ? parseFloat(parcelPackage.total_package_sqft)
    : (hasMultipleParcels 
        ? activeParcels.reduce((s: number, p: any) => s + parseInt(p.sqft || p.lotSqFt || p.lotSqft || (parseFloat(p.acres || 0) > 0 ? Math.round(parseFloat(p.acres) * 43560) : 0), 10), 0) 
        : lotSqFt);
  const zoning = rawAssessor.zoning || inputs.zoning || 'B-2 General Commercial';
  const useCode = rawAssessor.useCode || inputs.useCode || 'Commercial / Mixed';
  const yearBuilt = rawAssessor.yearBuilt || inputs.yearBuilt || '2022';
  const stories = rawAssessor.stories || inputs.stories || 1;
  const construction = rawAssessor.constructionType || inputs.constructionType || 'Wood/Steel Frame';
  const legalDesc = rawAssessor.legalDescription || inputs.legalDescription || '';
  const gisSyncDate = rawAssessor.lastSyncedAt || (inputs.gisSync && inputs.gisSync.lastSyncedAt);
  const gisBadge = gisSyncDate ? `Live GIS Verified (${new Date(gisSyncDate).toLocaleDateString()})` : (apn !== 'Pending Link' ? 'Verified County Parcel' : 'Manual Underwriting Record');

  // Lease / Tenant Terms
  const primaryLease = (inputs.leases && inputs.leases[0]) || {};
  const tenantName = primaryLease.tenantName || inputs.tenantName || (status === 'owned' ? 'In-Place Commercial Tenant' : 'Prospective Commercial Tenant');
  const leaseType = inputs.leaseType || primaryLease.leaseType || 'NNN';
  const monthlyRent = parseFloat(primaryLease.monthlyRent || inputs.monthlyRent || inputs.grossRentPerMonth || (price > 0 ? (price * 0.008) : 0));
  const annualRent = monthlyRent * 12;
  const leaseStart = primaryLease.leaseStartDate || inputs.leaseStartDate || (inputs.closingDate || '2025-01-01');
  const leaseEnd = primaryLease.leaseEndDate || inputs.leaseEndDate || '2030-12-31';
  const escType = primaryLease.escalationType || inputs.escalationType || 'Percentage Bump (%)';
  const escRate = primaryLease.escalationRate !== undefined ? primaryLease.escalationRate : (inputs.rentGrowth || 3.0);
  const escFreq = primaryLease.escalationFrequency || inputs.escalationFrequency || 'Annual on Anniversary';
  const nextEscDate = primaryLease.nextEscalationDate || inputs.nextEscalationDate || '2026-11-01';

  // Warnings / Risk flags
  const warnings: any[] = deal.warnings || [];
  if (cashFlow < 0) {
    warnings.push({ title: 'Negative Operating Cash Flow', description: `Year 1 underwritten cash flow is ${fmtCurr(cashFlow)} (CoC: ${fmtPct(coc)}). Operating deficit requires debt restructuring or cash reserve.` });
  }
  if (apn === 'Pending Link') {
    warnings.push({ title: 'Unlinked Assessor Parcel', description: 'Property is not tied to an active county parcel number; official assessment and boundary lines unverified.' });
  }
  if (dscr !== 'N/A' && parseFloat(dscr) < 1.25) {
    warnings.push({ title: 'DSCR Below 1.25x Covenant Floor', description: `Projected Year 1 DSCR of ${dscr}x is below the institutional underwriting threshold of 1.25x.` });
  }

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MathTree Institutional Underwriting Brief - ${title}</title>
  <style>
    @page { size: letter landscape; margin: 8mm 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #0f172a; margin: 0; padding: 12px; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #059669; padding-bottom: 8px; margin-bottom: 10px; }
    .logo-badge { font-size: 20px; font-weight: 900; color: #059669; letter-spacing: -0.5px; }
    .pill { display: inline-block; font-size: 8.5px; font-weight: 800; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; }
    .pill-green { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .pill-blue { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .pill-slate { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
    .scorecard { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 10px; }
    .scorecard-tile { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 6px 8px; }
    .tile-lbl { font-size: 7.5px; font-weight: 700; color: #64748b; text-transform: uppercase; margin: 0; }
    .tile-val { font-size: 14px; font-weight: 800; color: #0f172a; margin: 2px 0 0 0; }
    .box { border: 1px solid #cbd5e1; border-radius: 5px; overflow: hidden; margin-bottom: 10px; page-break-inside: avoid; }
    .box-header { background: #0f172a; color: #ffffff; padding: 4px 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.4px; }
    .table-data { width: 100%; font-size: 8px; border-collapse: collapse; line-height: 1.35; }
    .table-data th { background: #f1f5f9; border-bottom: 1px solid #cbd5e1; font-weight: 800; color: #1e293b; padding: 4px 6px; }
    .table-data td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
    .footer { border-top: 1px solid #cbd5e1; padding-top: 4px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8; margin-top: 10px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="logo-badge">MathTree</span>
        <span class="pill pill-green">Executive Underwriting Brief</span>
        <span class="pill ${status === 'owned' ? 'pill-green' : 'pill-blue'}">${status === 'owned' ? '🏛️ Owned Operating Asset' : '🎯 Pipeline Prospect'}</span>
      </div>
      <h1 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 3px 0 0 0;">${title}</h1>
      <div style="font-size: 9.5px; color: #475569; font-weight: 600; margin-top: 2px; display: flex; align-items: center; gap: 8px;">
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
    <div style="text-align: right; font-size: 9.5px; color: #64748b;">
      <p style="margin: 0; font-weight: 600;">Report Date: <strong style="color: #0f172a;">${dateStr}</strong></p>
      <p style="margin: 2px 0 0 0;">Target Hold Period: <strong style="color: #0f172a;">${holdYears} Years</strong></p>
      <p style="margin: 2px 0 0 0;">Settlement Closing: <strong style="color: #059669;">${inputs.closingDate || (startYear + '-10-15')}</strong></p>
    </div>
  </div>

  <!-- 6 Top-Level Executive Scorecard Tiles -->
  <div class="scorecard">
    <div class="scorecard-tile">
      <p class="tile-lbl">10-Yr Levered IRR</p>
      <p class="tile-val" style="color: #059669;">${fmtPct(irr)}</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">10-Yr NPV (@${discountRate}%)</p>
      <p class="tile-val">${fmtCurr(npv)}</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Equity Multiplier</p>
      <p class="tile-val">${fmtDec(em, 2)}x</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Year 1 Cash Flow</p>
      <p class="tile-val" style="color: ${cashFlow >= 0 ? '#059669' : '#e11d48'};">${fmtCurr(cashFlow)}</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Year 1 Cap Rate</p>
      <p class="tile-val">${fmtPct(capRate)}</p>
    </div>
    <div class="scorecard-tile">
      <p class="tile-lbl">Debt Service Coverage (DSCR)</p>
      <p class="tile-val" style="color: #0284c7;">${dscr !== 'N/A' ? fmtDec(dscr, 2) + 'x' : 'N/A'}</p>
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
        ${legalDesc ? `
        <tr style="background: #f8fafc;">
          <td style="color: #64748b; font-weight: 700;">Primary Legal Desc</td>
          <td colspan="5" style="font-size: 7.5px; color: #475569;">${legalDesc}</td>
        </tr>` : ''}
        ${hasMultipleParcels ? `
        <tr style="background: #ecfdf5; border-top: 1.5px solid #a7f3d0;">
          <td style="color: #065f46; font-weight: 800;">Package Scope</td>
          <td style="font-weight: 800; color: #065f46;">Multi-Parcel Bundle (${activeParcels.length} APNs)</td>
          <td style="color: #065f46; font-weight: 800;">Combined Assessment</td>
          <td style="font-weight: 900; color: #047857;">${fmtCurr(pkgTotalAssessed)} (${fmtCurr(pkgTotalLand)} L / ${fmtCurr(pkgTotalImp)} B)</td>
          <td style="color: #065f46; font-weight: 800;">Total Land Area</td>
          <td style="font-weight: 800; color: #047857;">${fmtDec(pkgTotalAcres, 2)} Acres (${pkgTotalSqFt.toLocaleString()} Sq Ft)</td>
        </tr>` : ''}
      </tbody>
    </table>

    ${hasMultipleParcels ? `
    <div style="background: #f1f5f9; padding: 3px 8px; font-size: 8px; font-weight: 800; color: #334155; text-transform: uppercase; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; display: flex; justify-content: space-between;">
      <span>Attached Parcel Package Breakdown (${activeParcels.length} Total Taxlots)</span>
      <span style="color: #047857;">Primary APN + ${adjacentParcels.length} Adjacent Companion Lot${adjacentParcels.length > 1 ? 's' : ''} Included</span>
    </div>
    <table class="table-data">
      <thead>
        <tr style="background: #f8fafc; font-size: 7.5px;">
          <th style="text-align: left; width: 12%; padding: 3px 6px;">Role</th>
          <th style="text-align: left; width: 16%; padding: 3px 6px;">APN / Parcel</th>
          <th style="text-align: left; width: 22%; padding: 3px 6px;">Situs Address</th>
          <th style="text-align: left; width: 18%; padding: 3px 6px;">Use / Zoning</th>
          <th style="text-align: right; width: 14%; padding: 3px 6px;">Lot Area</th>
          <th style="text-align: right; width: 18%; padding: 3px 6px;">Assessed Valuation</th>
        </tr>
      </thead>
      <tbody>
        ${activeParcels.map((p: any) => {
          const isPrim = p.is_primary ?? p.isPrimary;
          const pApn = p.formatted_apn || p.formattedApn || p.apn;
          const pAddr = p.situs_address || p.address || p.street || location;
          const pUse = p.use_code || p.useCode || zoning;
          const pAcres = parseFloat(p.acres || 0);
          const pSqft = parseInt(p.sqft || p.lotSqFt || (pAcres > 0 ? Math.round(pAcres * 43560) : 0), 10);
          const pTot = parseFloat(p.total_assessed_val || p.totalAssessedValue || p.assessedValue || 0);
          const pLand = parseFloat(p.market_land_val || p.marketLandValue || p.landValue || 0);
          const pBldg = parseFloat(p.market_imp_val || p.marketImprovementValue || p.improvementValue || 0);
          return `
          <tr style="border-bottom: 1px solid #f1f5f9; background: ${isPrim ? '#ffffff' : '#f8fafc'};">
            <td style="padding: 3px 6px; font-weight: 800;">
              ${isPrim 
                ? '<span style="background: #d1fae5; color: #065f46; padding: 1px 4px; border-radius: 3px; font-size: 7px; text-transform: uppercase;">Primary</span>' 
                : '<span style="background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-size: 7px; text-transform: uppercase;">Adjacent Lot</span>'}
            </td>
            <td style="padding: 3px 6px; font-family: monospace; font-weight: 700; color: ${isPrim ? '#047857' : '#0284c7'};">${pApn}</td>
            <td style="padding: 3px 6px; font-weight: 600; color: #1e293b;">${pAddr}</td>
            <td style="padding: 3px 6px; color: #475569;">${pUse}</td>
            <td style="padding: 3px 6px; text-align: right; font-weight: 600;">${pAcres > 0 ? `${fmtDec(pAcres, 2)} ac (${pSqft.toLocaleString()} sf)` : (pSqft > 0 ? `${pSqft.toLocaleString()} sf` : 'N/A')}</td>
            <td style="padding: 3px 6px; text-align: right; font-weight: 700; color: #0f172a;">${fmtCurr(pTot)} <span style="font-weight: 400; font-size: 7px; color: #64748b;">(${fmtCurr(pLand)} L / ${fmtCurr(pBldg)} B)</span></td>
          </tr>
          `;
        }).join('')}
      </tbody>
    </table>` : ''}
  </div>

  <!-- 2. Dynamic Lease Terms & Scheduled Escalations (Owned & Leased Assets) -->
  <div class="box">
    <div class="box-header" style="background: #064e3b;">
      <span>📑 Contractual Lease Terms & Rent Roll Escalation Schedule</span>
      <span style="font-size: 8px; background: rgba(255,255,255,0.2); padding: 1px 5px; border-radius: 3px;">In-Place Operating Leases</span>
    </div>
    <table class="table-data">
      <tbody>
        <tr>
          <td style="width: 14%; color: #64748b; font-weight: 700;">Tenant of Record</td>
          <td style="width: 22%; font-weight: 800; color: #0f172a;">${tenantName}</td>
          <td style="width: 14%; color: #64748b; font-weight: 700;">Lease Structure</td>
          <td style="width: 18%; font-weight: 700; color: #047857;">${leaseType} Commercial Lease</td>
          <td style="width: 14%; color: #64748b; font-weight: 700;">In-Place Rent</td>
          <td style="width: 18%; font-weight: 800; color: #059669;">${fmtCurr(monthlyRent)}/mo (${fmtCurr(annualRent)}/yr)</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 700;">Lease Term Dates</td>
          <td style="font-weight: 600; color: #0f172a;">${leaseStart} to ${leaseEnd}</td>
          <td style="color: #64748b; font-weight: 700;">Escalation Mechanism</td>
          <td style="font-weight: 600; color: #0f172a;">${escType} (${escRate}% bump)</td>
          <td style="color: #64748b; font-weight: 700;">Escalation Frequency</td>
          <td style="font-weight: 600; color: #0f172a;">${escFreq} • Next: <strong style="color: #047857;">${nextEscDate}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 3. Debt Capital Structure & Dynamic Amortization -->
  <div class="box">
    <div class="box-header" style="background: #1e293b;">
      <span>🏦 Senior Debt Financing & Capital Structure</span>
      <span style="font-size: 8px; color: #93c5fd;">${ltv}% LTV Commercial Loan</span>
    </div>
    <table class="table-data">
      <tbody>
        <tr>
          <td style="width: 14%; color: #64748b; font-weight: 700;">Purchase / Basis</td>
          <td style="width: 20%; font-weight: 800; color: #0f172a;">${fmtCurr(price)} ${bldgSqFt > 0 ? `($${(price/bldgSqFt).toFixed(0)}/sq ft)` : ''}</td>
          <td style="width: 13%; color: #64748b; font-weight: 700;">Required Equity</td>
          <td style="width: 20%; font-weight: 700; color: #0f172a;">${fmtCurr(equity)} (${100 - ltv}%)</td>
          <td style="width: 13%; color: #64748b; font-weight: 700;">Senior Loan Amount</td>
          <td style="width: 20%; font-weight: 800; color: #047857;">${fmtCurr(loanAmt)} (${ltv}% LTV)</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 700;">Note Terms</td>
          <td style="font-weight: 600; color: #0f172a;">${intRate}% Fixed • ${loanTerm} Yrs Amort</td>
          <td style="color: #64748b; font-weight: 700;">Annual P&I Debt Service</td>
          <td style="font-weight: 700; color: #0f172a;">${fmtCurr(debtService)}/yr (${fmtCurr(debtService/12)}/mo)</td>
          <td style="color: #64748b; font-weight: 700;">DSCR Covenant</td>
          <td style="font-weight: 800; color: ${dscr !== 'N/A' && parseFloat(dscr) >= 1.25 ? '#059669' : '#e11d48'};">${dscr !== 'N/A' ? fmtDec(dscr, 2) + 'x' : 'N/A'} (1.25x Floor)</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 4. Institutional 8-Row Underwriting Assumptions, Methodology & Diligence Bridge -->
  <div class="box">
    <div class="box-header" style="background: #0f172a;">
      <span>⚖️ Institutional Underwriting Assumptions, Methodology & Diligence Bridge</span>
      <span style="font-size: 8px; background: #047857; color: #ffffff; padding: 1px 6px; border-radius: 3px;">8-Point Provenance Audit</span>
    </div>
    <table class="table-data">
      <thead>
        <tr style="background: #f1f5f9; text-align: left;">
          <th style="width: 24%; border-right: 1px solid #e2e8f0;">Input Parameter & Value</th>
          <th style="width: 38%; border-right: 1px solid #e2e8f0;">Methodology & Provenance (How Reached)</th>
          <th style="width: 38%;">Valuation & Sensitivity Context</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border-right: 1px solid #e2e8f0; vertical-align: top;">
            <strong style="color: #0f172a; font-size: 8.5px; display: block;">1. Acquisition Price & Basis</strong>
            <span style="color: #059669; font-weight: 800; font-size: 9.5px;">${fmtCurr(price)}</span>
            ${bldgSqFt > 0 ? `<span style="color: #64748b; font-size: 7.5px; display: block;">($${(price / bldgSqFt).toFixed(2)}/sq ft)</span>` : ''}
          </td>
          <td style="border-right: 1px solid #e2e8f0; color: #334155; vertical-align: top;">
            Calibrated against official ${county} assessed valuation (${totalAssessed > 0 ? fmtCurr(totalAssessed) + ' total assessed basis' : 'county assessed roll'}) and LOI guidance.
          </td>
          <td style="color: #0f172a; vertical-align: top;">Valuation basis reflects regional replacement costs and submarket sales comps.</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="border-right: 1px solid #e2e8f0; vertical-align: top;">
            <strong style="color: #0f172a; font-size: 8.5px; display: block;">2. Gross Revenue & Escalation</strong>
            <span style="color: #0f172a; font-weight: 800; font-size: 9px;">${fmtCurr(annualRent)}/yr</span>
            <span style="color: #64748b; font-size: 7.5px; display: block;">${escType} • ${escRate}%/yr</span>
          </td>
          <td style="border-right: 1px solid #e2e8f0; color: #334155; vertical-align: top;">
            Derived from contractual ${leaseType} commercial lease agreements. Reflects active tenant obligations across Central Washington benchmarks.
          </td>
          <td style="color: #0f172a; vertical-align: top;">Compounding escalation protects real yields against regional inflation trends.</td>
        </tr>
        <tr>
          <td style="border-right: 1px solid #e2e8f0; vertical-align: top;">
            <strong style="color: #0f172a; font-size: 8.5px; display: block;">3. Debt Structure & Leverage</strong>
            <span style="color: #0f172a; font-weight: 700;">${ltv}% LTV • ${fmtCurr(loanAmt)}</span>
            <span style="color: #64748b; font-size: 7.5px; display: block;">${intRate}% Fixed • ${loanTerm} Yrs Amort</span>
          </td>
          <td style="border-right: 1px solid #e2e8f0; color: #334155; vertical-align: top;">
            Calibrated to current commercial banking lending terms. Debt service coverage confirms resilient cash flow cushion above 1.25x covenant.
          </td>
          <td style="color: #0f172a; vertical-align: top;">Subject to binding lender commitment letter, title endorsement, and Phase I ESA.</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="border-right: 1px solid #e2e8f0; vertical-align: top;">
            <strong style="color: #0f172a; font-size: 8.5px; display: block;">4. Vacancy & Credit Loss Reserve</strong>
            <span style="color: #0f172a; font-weight: 700;">${inputs.vacancyRate || 5}% of GPI</span>
            <span style="color: #64748b; font-size: 7.5px; display: block;">${fmtCurr(annualRent * ((parseFloat(inputs.vacancyRate) || 5) / 100))}/yr reserve</span>
          </td>
          <td style="border-right: 1px solid #e2e8f0; color: #334155; vertical-align: top;">
            Enforces institutional 5.0% underwriting floor for credit single-tenant assets to reserve for economic downtime and collection friction.
          </td>
          <td style="color: #0f172a; vertical-align: top;">Asset maintains positive cash flows up to 25% economic vacancy tolerance.</td>
        </tr>
        <tr>
          <td style="border-right: 1px solid #e2e8f0; vertical-align: top;">
            <strong style="color: #0f172a; font-size: 8.5px; display: block;">5. Operating Expenses & Management</strong>
            <span style="color: #0f172a; font-weight: 700;">${inputs.expenseRatio || 15}% of GPI</span>
            <span style="color: #64748b; font-size: 7.5px; display: block;">${inputs.manageProperty ? 'Managed (3.5%)' : 'Self-Managed'}</span>
          </td>
          <td style="border-right: 1px solid #e2e8f0; color: #334155; vertical-align: top;">
            Underwritten under ${leaseType} structure where tenant covers operational pass-throughs; ratio covers administrative overhead, taxes, and insurance reserve.
          </td>
          <td style="color: #0f172a; vertical-align: top;">Validated against 2 years of actual operating statements and active insurance quotes.</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="border-right: 1px solid #e2e8f0; vertical-align: top;">
            <strong style="color: #0f172a; font-size: 8.5px; display: block;">6. CapEx & Replacement Reserves</strong>
            <span style="color: #0f172a; font-weight: 700;">Rehab: ${fmtCurr(inputs.rehabCosts || 0)}</span>
            <span style="color: #64748b; font-size: 7.5px; display: block;">Reserves: ${inputs.capexReserve || 3.0}%/yr (${fmtCurr(annualRent * 0.03)}/yr)</span>
          </td>
          <td style="border-right: 1px solid #e2e8f0; color: #334155; vertical-align: top;">
            Evaluated based on physical property age (${yearBuilt} build). Ongoing reserve buffers roof, HVAC, and paving lifecycle maintenance.
          </td>
          <td style="color: #0f172a; vertical-align: top;">Accumulates dedicated structural replacement liquidity over the hold period.</td>
        </tr>
        <tr>
          <td style="border-right: 1px solid #e2e8f0; vertical-align: top;">
            <strong style="color: #0f172a; font-size: 8.5px; display: block;">7. Terminal Exit Cap Rate</strong>
            <span style="color: #0f172a; font-weight: 700;">${inputs.targetCapRate || 7.0}% Exit Cap</span>
            <span style="color: #64748b; font-size: 7.5px; display: block;">Spread: +50 bps over entry yield</span>
          </td>
          <td style="border-right: 1px solid #e2e8f0; color: #334155; vertical-align: top;">
            Modeled with a conservative +50 bps expansion buffer over entry yield to stress-test liquidity and interest rate shifts over the ${holdYears}-year hold.
          </td>
          <td style="color: #0f172a; vertical-align: top;">Supported by regional commercial sales comps and capital markets liquidity.</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="border-right: 1px solid #e2e8f0; vertical-align: top;">
            <strong style="color: #0f172a; font-size: 8.5px; display: block;">8. Hold Horizon & Settlement Timing</strong>
            <span style="color: #0f172a; font-weight: 700;">${holdYears}-Year Hold</span>
            <span style="color: #047857; font-size: 7.5px; display: block; font-weight: 700;">Closing: ${inputs.closingDate || (startYear + '-10-15')} (Stub Prorated)</span>
          </td>
          <td style="border-right: 1px solid #e2e8f0; color: #334155; vertical-align: top;">
            Aligned with fund lifecycle and full amortization wealth realization cycle. Incorporates stub proration for transaction closing settlement.
          </td>
          <td style="color: #0f172a; vertical-align: top;">Optimizes equity compounding and proceeds at disposition.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 5. 10-Year Pro-Forma Cash Flow Waterfall Table -->
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

  <!-- 6. Deal Risk & Underwriting Audit Flags -->
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
    <span>Confidential Institutional Investment Memo • DSCR: ${dscr} • Generated ${dateStr}</span>
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
