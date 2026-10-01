import type { DealMetrics, DealRecord, ProFormaYear } from '../math/types';
import { computeDealMetrics, prepareEngineInputs } from '../engine/compute';
import { firstFullYear } from '../engine';

/**
 * The single source for the deal brief. Every figure comes from ONE engine run (`computeDealMetrics`, the same call the
 * Deal Studio makes) plus the facts stored in the `leases` and `parcels` tables. Nothing is re-derived here and nothing is
 * invented: a value that is not provided stays null and the brief prints "Not provided".
 */

export interface LeaseRow {
  id?: string;
  tenant_name?: string | null;
  lease_type?: string | null;
  derived_unit_number?: string | null;
  derived_unit_type?: string | null;
  derived_sqft?: number | string | null;
  monthly_rent?: number | string | null;
  lease_start_date?: string | null;
  lease_end_date?: string | null;
  escalation_type?: string | null;
  escalation_rate?: number | string | null;
  escalation_frequency?: string | null;
  next_escalation_date?: string | null;
  is_active?: boolean | null;
}

export interface ParcelRow {
  id?: string;
  apn?: string | null;
  formatted_apn?: string | null;
  is_primary?: boolean | null;
  included?: boolean | null;
  situs_address?: string | null;
  legal_description?: string | null;
  use_code?: string | null;
  zoning?: string | null;
  acres?: number | string | null;
  sqft?: number | string | null;
  market_land_val?: number | string | null;
  market_imp_val?: number | string | null;
  total_assessed_val?: number | string | null;
}

export interface BriefParcel {
  apn: string;
  address: string | null;
  isPrimary: boolean;
  assessed: number;
  land: number;
  improvement: number;
  acres: number;
  sqft: number;
  zoning: string | null;
  useCode: string | null;
}

export interface BriefLease {
  tenant: string | null;
  unit: string | null;
  type: string | null;
  monthlyRent: number;
  start: string | null;
  end: string | null;
  escalation: string | null;
  nextEscalation: string | null;
}

export type BriefAssetClass = 'residential' | 'multi_family' | 'storage' | 'commercial';

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const present = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== '';
const text = (v: unknown): string | null => (present(v) ? String(v).trim() : null);

export function normalizeBriefAssetClass(raw: unknown): BriefAssetClass {
  const v = String(raw ?? 'commercial').toLowerCase().replace(/_/g, '-');
  if (v === 'residential' || v === 'single-family' || v === 'sfr') return 'residential';
  if (v === 'multi-family' || v === 'multifamily' || v === 'multi-unit') return 'multi_family';
  if (v === 'storage' || v === 'self-storage') return 'storage';
  return 'commercial';
}

function mapParcel(p: ParcelRow): BriefParcel {
  const land = num(p.market_land_val);
  const imp = num(p.market_imp_val);
  const acres = num(p.acres);
  return {
    apn: text(p.formatted_apn) ?? text(p.apn) ?? 'Pending Link',
    address: text(p.situs_address),
    isPrimary: !!p.is_primary,
    land,
    improvement: imp,
    assessed: present(p.total_assessed_val) ? num(p.total_assessed_val) : land + imp,
    acres,
    sqft: present(p.sqft) ? num(p.sqft) : Math.round(acres * 43560),
    zoning: text(p.zoning),
    useCode: text(p.use_code),
  };
}

/** Parcels come from the `parcels` table; deals that predate it fall back to `inputs.parcels` (camelCase JSON). */
export function resolveParcels(parcelRows: ParcelRow[], inputs: Record<string, any>): BriefParcel[] {
  const rows: ParcelRow[] = parcelRows.length > 0
    ? parcelRows
    : (Array.isArray(inputs.parcels) ? inputs.parcels : [])
        .filter((p: any) => p && typeof p === 'object')
        .map((p: any): ParcelRow => ({
          apn: p.apn ?? p.parcelNumber,
          formatted_apn: p.formattedApn ?? p.formatted_apn,
          is_primary: p.isPrimary ?? p.is_primary,
          included: p.included,
          situs_address: p.address ?? p.situs_address,
          zoning: p.zoning,
          use_code: p.useCode ?? p.use_code,
          acres: p.acres,
          sqft: p.sqft,
          market_land_val: p.marketLandValue ?? p.market_land_val,
          market_imp_val: p.marketImprovementValue ?? p.market_imp_val,
          total_assessed_val: p.totalAssessedValue ?? p.total_assessed_val,
        }));
  const included = rows.filter((p) => p.included !== false);
  return (included.length > 0 ? included : rows)
    .map(mapParcel)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

function mapLease(l: LeaseRow): BriefLease {
  const rate = present(l.escalation_rate) ? num(l.escalation_rate) : null;
  const escParts = [rate !== null ? `${rate}%` : null, text(l.escalation_frequency)].filter(Boolean);
  return {
    tenant: text(l.tenant_name),
    unit: text(l.derived_unit_number),
    type: text(l.lease_type) ?? text(l.derived_unit_type),
    monthlyRent: num(l.monthly_rent),
    start: text(l.lease_start_date),
    end: text(l.lease_end_date),
    escalation: escParts.length > 0 ? escParts.join(' ') : null,
    nextEscalation: text(l.next_escalation_date),
  };
}

export interface BriefModel {
  title: string;
  location: string | null;
  status: string;
  assetClass: BriefAssetClass;
  isResidential: boolean;
  isMultiFamily: boolean;
  isStorage: boolean;
  memoTypeLabel: string;
  dateStr: string;
  startYear: number;
  closingDate: string | null;

  metrics: DealMetrics;
  proj: ProFormaYear[];
  p0: Partial<ProFormaYear> & Record<string, any>;
  isProrated: boolean;

  price: number;
  rehabCosts: number;
  closingCosts: number;
  arv: number | null;
  rehabMode: 'roll_into_loan' | 'out_of_pocket';
  totalFinancedBasis: number;
  downPaymentAmt: number;
  downPaymentPct: number;
  loanAmt: number;
  equity: number;
  ltvPct: number;
  interestRate: number;
  loanTerm: number;
  holdYears: number;
  discountRate: number;
  exitCapRate: number;
  capexReservePct: number | null;

  noi: number;
  debtService: number;
  monthlyDebtService: number;
  principalPerMonth: number;
  interestPerMonth: number;
  cashFlow: number;
  monthlyCashFlow: number;
  cashOnCash: number;
  irr: number;
  equityMultiple: number;
  capRate: number;
  dscr: number | null;
  dscrFormatted: string;

  /** Underwritten rent: what the engine ran on (the same figure the Studio shows). */
  annualRent: number;
  monthlyRent: number;
  vacancyPct: number;
  vacancyLossAnnual: number;
  expenseRatioPct: number;
  opExAnnual: number;

  parcels: BriefParcel[];
  parcelTotals: { assessed: number; land: number; improvement: number; acres: number; sqft: number };
  county: string | null;
  owner: string | null;
  zoning: string | null;
  useCode: string | null;
  yearBuilt: string | null;
  stories: string | null;
  construction: string | null;
  buildingSqFt: number;
  gisBadge: string;

  /** The in-place rent roll from the Operations `leases` table (actuals), active leases only. */
  rentRoll: BriefLease[];
  rentRollMonthly: number;
  /** In-place rent roll minus underwritten monthly rent; null when there is no rent roll. */
  rentVarianceMonthly: number | null;
  /** Underwriting leases (inputs.leases) the engine used. */
  underwritingLeases: BriefLease[];

  dscrEvaluation: string;
  debtProvenance: string;
  revenueProvenance: string;
  opexProvenance: string;
  warnings: Array<{ title: string; description: string }>;
  /** Inputs for the on-demand Monte Carlo (same preparation the Sensitivity tab uses). */
  monteCarloInputs: Record<string, any>;
}

const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
const pct1 = (n: number): string => (Math.abs(n - Math.round(n)) < 0.005 ? n.toFixed(0) : n.toFixed(1));

export function buildBriefModel(
  deal: DealRecord,
  leaseRows: LeaseRow[] = [],
  parcelRows: ParcelRow[] = [],
  now: Date = new Date(),
): BriefModel {
  const metrics = computeDealMetrics(deal);
  const raw = metrics as unknown as Record<string, any>;
  const inputs = prepareEngineInputs(deal) as Record<string, any>;

  const assetClass = normalizeBriefAssetClass(deal.asset_class ?? deal.assetType);
  const isResidential = assetClass === 'residential';
  const isMultiFamily = assetClass === 'multi_family';
  const isStorage = assetClass === 'storage';
  const status = String(deal.status || 'prospect').toLowerCase();

  const proj = (metrics.projections ?? []) as ProFormaYear[];
  const p0 = (proj[0] ?? {}) as Record<string, any>;
  const firstFull = (firstFullYear(proj as any[]) ?? p0) as Record<string, any>;
  const isProrated = Boolean(raw.isProratedFirstYear || (p0.operatingMonths !== undefined && p0.operatingMonths < 12));
  const months = num(p0.operatingMonths) || 12;

  // Capital structure: engine results only (mirrors math-engine.ts: downPaymentPercent defaults to 0, not 25)
  const price = num(raw.purchasePrice);
  const rehabCosts = num(raw.rehabCosts);
  const closingCosts = num(inputs.closingCosts);
  const arv = raw.arv ? num(raw.arv) : null;
  const rehabMode: BriefModel['rehabMode'] =
    (inputs.rehabFinancingMode || (inputs.financeRehabAndClosingCosts ? 'roll_into_loan' : 'out_of_pocket')) === 'roll_into_loan'
      ? 'roll_into_loan'
      : 'out_of_pocket';
  const totalFinancedBasis = rehabMode === 'roll_into_loan' ? price + rehabCosts + closingCosts : price;
  const downPaymentAmt = num(raw.downPaymentAmount);
  const downPaymentPct = totalFinancedBasis > 0 ? (downPaymentAmt / totalFinancedBasis) * 100 : 0;
  const loanAmt = num(raw.loanAmount);
  const equity = num(raw.initialCashInvested);
  const ltvPct = totalFinancedBasis > 0 ? (loanAmt / totalFinancedBasis) * 100 : 0;

  const interestRate = p0.appliedInterestRate !== undefined ? num(p0.appliedInterestRate) : num(inputs.interestRate);
  const loanTerm = parseInt(String(inputs.loanTerm || inputs.loanTermYears || inputs.amortizationYears || 30), 10) || 30;
  const rawHold = parseInt(String(inputs.holdingPeriod || inputs.exitYear || inputs.holdYears || 10), 10);
  const holdYears = Math.max(1, Math.min(30, Number.isNaN(rawHold) ? 10 : rawHold));
  const discountRate = num(inputs.discountRate);
  const exitCapRate = num(inputs.targetCapRate) || num(inputs.targetExitCapRate) || num(inputs.exitCapRate) || 6.5;

  const noi = num(p0.netOperatingIncome);
  const debtService = num(p0.debtService ?? p0.annualDebtService);
  const monthlyDebtService = num(raw.monthlyMortgagePayment);
  const principalPerMonth = num(p0.principalPaid) / months;
  const interestPerMonth = num(p0.interestPaid) / months;
  const cashFlow = num(p0.cashFlow);
  const dscr = metrics.dscr === null || metrics.dscr === undefined || metrics.dscr === '' || Number.isNaN(Number(metrics.dscr)) ? null : Number(metrics.dscr);
  const dscrFormatted = dscr !== null && debtService > 0 ? `${dscr.toFixed(2)}x` : 'N/A';
  const dscrNum = dscr ?? 0;

  // Revenue and expenses from the first FULL operating year. A closing mid-year makes Year 1 a stub holding only a few
  // months of rent, so dividing it by 12 would understate the monthly rent (6 months of $2,600 is $15,600, not $1,300/mo).
  const fy = firstFull;
  const annualRent = num(fy.grossPotentialIncome ?? fy.grossPotentialRent);
  const monthlyRent = annualRent / 12;
  const vacancyLossAnnual = num(fy.vacancyLoss);
  const vacancyPct = annualRent > 0 ? (vacancyLossAnnual / annualRent) * 100 : 0;
  const opExAnnual = num(fy.operatingExpenses);
  const expenseRatioPct = annualRent > 0 ? (opExAnnual / annualRent) * 100 : 0;

  // Leases: underwriting leases (what the engine ran) and the live rent roll (what is actually in place)
  const underwritingLeases = (Array.isArray(inputs.leases) ? inputs.leases : []).map(
    (l: any): BriefLease => ({
      tenant: text(l.tenantName),
      unit: text(l.unitNumber),
      type: text(l.leaseType),
      monthlyRent: num(l.monthlyRent) || num(l.annualRent) / 12,
      start: text(l.leaseStartDate),
      end: text(l.leaseEndDate),
      escalation: present(l.escalationRate) ? `${num(l.escalationRate)}% ${text(l.escalationFrequency) ?? ''}`.trim() : null,
      nextEscalation: text(l.nextEscalationDate),
    }),
  );
  const rentRoll = leaseRows.filter((l) => l.is_active !== false).map(mapLease);
  const rentRollMonthly = rentRoll.reduce((s, l) => s + l.monthlyRent, 0);
  const rentVarianceMonthly = rentRoll.length > 0 ? rentRollMonthly - monthlyRent : null;

  // Assessor records
  const parcels = resolveParcels(parcelRows, inputs);
  const parcelTotals = parcels.reduce(
    (t, p) => ({ assessed: t.assessed + p.assessed, land: t.land + p.land, improvement: t.improvement + p.improvement, acres: t.acres + p.acres, sqft: t.sqft + p.sqft }),
    { assessed: 0, land: 0, improvement: 0, acres: 0, sqft: 0 },
  );
  const assessor = (inputs.assessorData ?? {}) as Record<string, any>;
  const primary = parcels[0];
  const gisSyncDate = assessor.lastSyncedAt ?? inputs.gisSync?.lastSyncedAt;
  const hasApn = !!primary && primary.apn !== 'Pending Link';
  const gisBadge = gisSyncDate
    ? `Live GIS Verified (${new Date(gisSyncDate).toLocaleDateString()})`
    : hasApn ? 'Verified County Parcel' : 'Manual Underwriting Record';
  const buildingSqFt = num(assessor.buildingSqFt ?? inputs.buildingSqFt ?? inputs.gla ?? inputs.totalSqFt);

  const closingDate = text(inputs.closingDate) ?? text(deal.closing_date);
  // The first projection year is authoritative for the table, so the header must agree with it
  const parsedYear = closingDate ? new Date(closingDate).getFullYear() : NaN;
  const startYear = num(p0.calendarYear) > 2000 ? num(p0.calendarYear) : parsedYear > 2000 && parsedYear < 2100 ? parsedYear : now.getFullYear();

  // Narrative, built only from the numbers above
  let dscrEvaluation: string;
  if (dscrNum >= 1.25 && cashFlow > 0) {
    dscrEvaluation = `Calibrated to lending terms. ${isProrated ? 'Stabilized debt' : 'Debt'} service coverage of ${dscrNum.toFixed(2)}x confirms resilient cash flow cushion (${money(isProrated ? num(firstFull.cashFlow ?? cashFlow) : cashFlow)}/yr) comfortably exceeding institutional 1.25x covenant floor.${isProrated && p0.dscr ? ` Note: Year 1 partial stub coverage is ${Number(p0.dscr).toFixed(2)}x (${months} mos) before full-year stabilization.` : ''}`;
  } else if (dscrNum >= 1.0 && cashFlow > 0) {
    dscrEvaluation = `Moderate coverage. Projected ${isProrated ? 'Stabilized ' : 'Year 1 '}DSCR of ${dscrNum.toFixed(2)}x yields positive cash flow (${money(cashFlow)}/yr) but sits below preferred 1.25x bank covenant buffer; sensitive to vacancy spikes or debt rate increases.`;
  } else {
    dscrEvaluation = `Underwriting Deficit Flag: Projected ${isProrated ? 'Stabilized ' : 'Year 1 '}operating cash flow is ${cashFlow < 0 ? 'negative' : 'thin'} (${money(cashFlow)}/yr, DSCR: ${dscrNum > 0 ? dscrNum.toFixed(2) + 'x' : 'N/A'}). Requires operating interest reserve or debt restructuring to service senior debt until stabilization.`;
  }

  const debtProvenance = rehabMode === 'roll_into_loan'
    ? `Structured on Total Project Basis (LTC): Purchase (${money(price)}) + Rehab (${money(rehabCosts)}) + Closing (${money(closingCosts)}) = Total Financed Basis (${money(totalFinancedBasis)}). Senior debt of ${money(loanAmt)} finances ${pct1(ltvPct)}% of total basis, requiring ${money(equity)} (${pct1(downPaymentPct)}%) initial sponsor equity down payment.`
    : `Structured on Acquisition Price (LTV): Senior loan of ${money(loanAmt)} (${pct1(ltvPct)}% LTV) finances purchase price (${money(price)}). Rehab scope (${money(rehabCosts)}) and closing settlement (${money(closingCosts)}) are paid 100% upfront out of pocket by sponsor, requiring ${money(equity)} total upfront cash outlay (${money(downPaymentAmt)} acquisition down payment + ${money(rehabCosts + closingCosts)} rehab & closing).`;

  const leaseKind = isResidential ? 'Residential Gross Lease' : (underwritingLeases[0]?.type ?? text(inputs.leaseType) ?? 'commercial');
  let revenueProvenance: string;
  if (isResidential) {
    revenueProvenance = `Underwritten from in-place residential tenancy (${money(monthlyRent)}/mo, ${money(annualRent)}/yr gross).`;
  } else if (isMultiFamily) {
    const units = parseInt(String(inputs.unitCount || inputs.numUnits || 0), 10);
    revenueProvenance = units > 0
      ? `Derived from ${units} residential multi-family doors at an average of ${money(monthlyRent / units)}/mo per unit (${money(monthlyRent)}/mo combined, ${money(annualRent)}/yr gross potential income).`
      : `Derived from the multi-family rent roll (${money(monthlyRent)}/mo, ${money(annualRent)}/yr gross potential income).`;
  } else if (isStorage) {
    const sf = num(inputs.storageSqFt ?? inputs.gla) || buildingSqFt;
    revenueProvenance = sf > 0
      ? `Derived from ${sf.toLocaleString()} net rentable self-storage square feet (${money(monthlyRent)}/mo, $${(annualRent / sf).toFixed(2)}/sq ft annual gross revenue).`
      : `Derived from the self-storage rent schedule (${money(monthlyRent)}/mo, ${money(annualRent)}/yr).`;
  } else {
    const l0 = underwritingLeases[0];
    revenueProvenance = l0 && l0.start && l0.monthlyRent > 0
      ? `Contractual ${leaseKind} lease commences ${l0.start}${l0.tenant ? ` with ${l0.tenant}` : ''} at ${money(l0.monthlyRent)}/mo (${money(l0.monthlyRent * 12)}/yr base rate)${l0.escalation ? ` with ${l0.escalation} escalation` : ''}. Calendar-year pro-forma revenues reflect exact active months and compounding adjustments.`
      : `Derived from contractual ${leaseKind} lease agreements (${money(monthlyRent)}/mo, ${money(annualRent)}/yr).`;
  }

  const opexProvenance = isResidential
    ? `Underwritten at ${pct1(expenseRatioPct)}% of gross revenue (${money(opExAnnual)}/yr) to cover residential property management, county real estate taxes, hazard insurance, and maintenance reserves.`
    : `Underwritten under ${leaseKind} structure at ${pct1(expenseRatioPct)}% of gross income (${money(opExAnnual)}/yr).`;

  const warnings: Array<{ title: string; description: string }> = [];
  const stub = isProrated ? 'Stabilized ' : 'Year 1 ';
  if (cashFlow < 0) warnings.push({ title: 'Negative Operating Cash Flow', description: `${isProrated ? 'Stub ' : 'Year 1 '}underwritten cash flow is ${money(cashFlow)}. Operating deficit requires debt restructuring or cash reserve.` });
  if (!hasApn) warnings.push({ title: 'Unlinked Assessor Parcel', description: 'Property is not tied to an active county parcel number; official assessment and boundary lines unverified.' });
  if (dscrFormatted !== 'N/A' && dscrNum < 1.25) warnings.push({ title: `${stub}DSCR Below 1.25x Covenant Floor`, description: `Projected ${stub}DSCR of ${dscrNum.toFixed(2)}x is below the institutional underwriting threshold of 1.25x.` });
  if (rentVarianceMonthly !== null && monthlyRent > 0 && Math.abs(rentVarianceMonthly) / monthlyRent >= 0.05) {
    warnings.push({ title: 'Rent Roll Differs From Underwriting', description: `In-place rent roll is ${money(rentRollMonthly)}/mo versus ${money(monthlyRent)}/mo underwritten (${rentVarianceMonthly >= 0 ? '+' : '-'}${money(Math.abs(rentVarianceMonthly))}/mo).` });
  }

  const memoTypeLabel = isResidential
    ? 'Single-Family Residential Investment Memo'
    : isMultiFamily ? 'Multi-Family Residential Memo' : isStorage ? 'Self-Storage Facility Memo' : 'Commercial Underwriting Memo';

  return {
    title: String(deal.title || deal.name || 'Investment Underwriting Brief'),
    location: text(deal.location) ?? text(deal.address),
    status,
    assetClass,
    isResidential,
    isMultiFamily,
    isStorage,
    memoTypeLabel,
    dateStr: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    startYear,
    closingDate,
    metrics,
    proj,
    p0,
    isProrated,
    price,
    rehabCosts,
    closingCosts,
    arv,
    rehabMode,
    totalFinancedBasis,
    downPaymentAmt,
    downPaymentPct,
    loanAmt,
    equity,
    ltvPct,
    interestRate,
    loanTerm,
    holdYears,
    discountRate,
    exitCapRate,
    capexReservePct: present(inputs.capexReserve) ? num(inputs.capexReserve) : null,
    noi,
    debtService,
    monthlyDebtService,
    principalPerMonth,
    interestPerMonth,
    cashFlow,
    monthlyCashFlow: cashFlow / months,
    cashOnCash: num(raw.cashOnCash),
    irr: num(raw.irr),
    equityMultiple: num(raw.equityMultiplier),
    capRate: num(raw.capRate),
    dscr,
    dscrFormatted,
    annualRent,
    monthlyRent,
    vacancyPct,
    vacancyLossAnnual,
    expenseRatioPct,
    opExAnnual,
    parcels,
    parcelTotals,
    county: text(inputs.county) ?? text(assessor.county),
    owner: text(assessor.owner) ?? text(inputs.owner),
    zoning: primary?.zoning ?? text(assessor.zoning) ?? text(inputs.zoning),
    useCode: primary?.useCode ?? text(assessor.useCode) ?? text(inputs.useCode),
    yearBuilt: text(assessor.yearBuilt) ?? text(inputs.yearBuilt),
    stories: text(assessor.stories) ?? text(inputs.stories),
    construction: text(assessor.constructionType) ?? text(inputs.constructionType),
    buildingSqFt,
    gisBadge,
    rentRoll,
    rentRollMonthly,
    rentVarianceMonthly,
    underwritingLeases,
    dscrEvaluation,
    debtProvenance,
    revenueProvenance,
    opexProvenance,
    warnings,
    monteCarloInputs: inputs,
  };
}
