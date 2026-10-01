import type { DealRecord } from '../math/types';
import { resolvePointInTimeDealMetrics, resolveDealDisplayName } from '../math/pointInTime';
import { tryComputeDealMetrics } from '../engine/compute';
import { computePortfolioKpis, type PortfolioKpis } from '../portfolio/kpis';
import { normalizeBriefAssetClass, resolveParcels, type BriefAssetClass, type BriefParcel, type ParcelRow } from './buildBriefModel';

/**
 * Pure model for the portfolio and pipeline brief. Owned assets use the dashboard's point-in-time resolver and every deal's
 * returns come from the shared engine; the headline tiles come from `computePortfolioKpis`, the same function the dashboard
 * calls. Nothing is re-derived and nothing is invented: a missing fact stays null and the brief prints "Not provided".
 */

export type PortfolioParcelRow = ParcelRow & { deal_id?: string | null };

export interface PortfolioDealRow {
  id: string;
  name: string;
  location: string | null;
  status: 'owned' | 'prospect';
  isOwned: boolean;
  statusLabel: string;
  assetClass: BriefAssetClass;
  classLabel: string;
  apn: string | null;
  parcelCount: number;
  owner: string | null;
  assessed: number | null;
  acres: number;
  buildingSqFt: number;
  yearBuilt: string | null;
  zoning: string | null;
  price: number;
  equity: number | null;
  debt: number | null;
  cashFlow: number | null;
  coc: number | null;
  noi: number | null;
  debtService: number | null;
  capRate: number | null;
  irr: number | null;
  ltv: number | null;
  stage: string | null;
  /** The engine could not compute this deal (bad inputs); its figures are left blank rather than guessed. */
  computeFailed: boolean;
}

export interface PortfolioSector {
  id: BriefAssetClass;
  label: string;
  icon: string;
  count: number;
  value: number;
  weightPct: number;
  cashFlow: number;
  avgIrr: number | null;
}

export interface PortfolioProFormaYear {
  year: number;
  calendarYear: number;
  propertyValue: number;
  grossIncome: number;
  vacancyLoss: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  debtService: number;
  netCashFlow: number;
  cashOnCash: number;
  capRate: number;
  loanBalance: number;
  endingEquity: number;
}

export interface PortfolioModel {
  investorName: string | null;
  companyName: string | null;
  hurdleRate: number | null;
  dateStr: string;
  kpis: PortfolioKpis;
  totalVolume: number;
  totalDeals: number;
  footprintAcres: number;
  footprintSqFt: number;
  sectors: PortfolioSector[];
  owned: PortfolioDealRow[];
  ownedProForma: PortfolioProFormaYear[];
  pipeline: PortfolioDealRow[];
  audit: PortfolioDealRow[];
  flags: Array<{ title: string; description: string }>;
}

export interface PortfolioOptions {
  investorName?: string | null;
  companyName?: string | null;
  hurdleRate?: number | null;
  now?: Date;
}

const SECTORS: Array<{ id: BriefAssetClass; label: string; icon: string }> = [
  { id: 'commercial', label: 'Commercial / Industrial', icon: '🏢' },
  { id: 'residential', label: 'Single-Family Residential', icon: '🏠' },
  { id: 'multi_family', label: 'Multi-Family (Multi-Unit)', icon: '🏬' },
  { id: 'storage', label: 'Self-Storage Facilities', icon: '📦' },
];
const CLASS_LABEL: Record<BriefAssetClass, string> = {
  commercial: 'Commercial', residential: 'Single-Family', multi_family: 'Multi-Family', storage: 'Self-Storage',
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

export function buildPortfolioModel(deals: DealRecord[], parcelRows: PortfolioParcelRow[] = [], opts: PortfolioOptions = {}): PortfolioModel {
  const now = opts.now ?? new Date();
  const kpis = computePortfolioKpis(deals, now);

  const parcelsByDeal = new Map<string, PortfolioParcelRow[]>();
  for (const p of parcelRows) {
    if (!p.deal_id) continue;
    const list = parcelsByDeal.get(p.deal_id) ?? [];
    list.push(p);
    parcelsByDeal.set(p.deal_id, list);
  }

  const rowFor = (d: DealRecord): PortfolioDealRow => {
    const inputs = (d.inputs ?? {}) as Record<string, any>;
    const assessor = (inputs.assessorData ?? {}) as Record<string, any>;
    const assetClass = normalizeBriefAssetClass(d.asset_class ?? d.assetType ?? d.asset_type);
    const parcels: BriefParcel[] = resolveParcels(parcelsByDeal.get(d.id) ?? [], inputs);
    const primary = parcels[0];
    const hasApn = !!primary && primary.apn !== 'Pending Link';
    const parcelAssessed = parcels.reduce((s, p) => s + p.assessed, 0);
    const parcelAcres = parcels.reduce((s, p) => s + p.acres, 0);
    const price = num(d.purchase_price) || num(inputs.purchasePrice);
    const em = tryComputeDealMetrics(d);
    const statusNorm = String(d.status || 'prospect').toLowerCase();
    const isOwned = statusNorm === 'owned';
    const status: 'owned' | 'prospect' = isOwned ? 'owned' : 'prospect';
    const statusLabel = isOwned ? 'Owned Asset' : 'Pipeline Prospect';

    const base = {
      id: d.id,
      name: resolveDealDisplayName(d),
      location: text(d.location) ?? text(inputs.location),
      status,
      isOwned,
      statusLabel,
      assetClass,
      classLabel: text(inputs.facilityType) ?? CLASS_LABEL[assetClass],
      apn: hasApn ? `${primary.apn}${parcels.length > 1 ? ` (+${parcels.length - 1})` : ''}` : null,
      parcelCount: hasApn ? parcels.length : 0,
      owner: text(assessor.owner) ?? text(inputs.owner),
      assessed: parcelAssessed > 0 ? parcelAssessed : (num(assessor.totalAssessedValue ?? inputs.totalAssessedValue) || null),
      acres: parcelAcres > 0 ? parcelAcres : num(assessor.acres ?? inputs.acres),
      buildingSqFt: num(assessor.buildingSqFt ?? inputs.buildingSqFt ?? inputs.gla ?? inputs.totalSqFt),
      yearBuilt: text(assessor.yearBuilt) ?? text(inputs.yearBuilt),
      zoning: primary?.zoning ?? text(assessor.zoning) ?? text(inputs.zoning),
      stage: isOwned ? null : (text(inputs.dealStage) ?? text(d.status)),
      computeFailed: !em,
    };

    if (isOwned) {
      const pit = resolvePointInTimeDealMetrics(d, now);
      return {
        ...base,
        price: pit.currentVal,
        equity: pit.currentEquity,
        debt: pit.currentDebt,
        cashFlow: pit.currentCashFlow,
        coc: pit.currentEquity > 0 ? (pit.currentCashFlow / pit.currentEquity) * 100 : null,
        noi: pit.currentNoi,
        debtService: pit.currentDebtService,
        capRate: pit.currentVal > 0 && pit.currentNoi > 0 ? (pit.currentNoi / pit.currentVal) * 100 : null,
        irr: em ? num(em.irr) : null,
        ltv: pit.ltv,
      };
    }

    const zeroEquity = !!em?.isZeroEquity;
    return {
      ...base,
      price,
      equity: em ? num(em.initialCashInvested) : null,
      debt: em ? num(em.loanAmount) : null,
      cashFlow: em ? num(em.year1Cashflow) : null,
      coc: em && !zeroEquity ? num(em.cashOnCash) : null,
      noi: em ? num(em.noi) : null,
      debtService: em ? num(em.annualDebtService) : null,
      capRate: em ? num(em.capRate) : null,
      irr: em && !zeroEquity ? num(em.irr) : null,
      ltv: em ? num(em.ltv) : null,
    };
  };

  const rows = deals.map(rowFor);
  const owned = rows.filter((r) => r.isOwned);
  const pipeline = rows.filter((r) => !r.isOwned);

  const totalVolume = kpis.ownedVal + kpis.pipelineVal;
  const sectors: PortfolioSector[] = SECTORS.map((s) => {
    const match = rows.filter((r) => r.assetClass === s.id);
    const value = match.reduce((sum, r) => sum + r.price, 0);
    const irrs = match.map((r) => r.irr).filter((v): v is number => v !== null && v > 0);
    return {
      ...s,
      count: match.length,
      value,
      weightPct: totalVolume > 0 ? (value / totalVolume) * 100 : 0,
      cashFlow: match.reduce((sum, r) => sum + (r.cashFlow ?? 0), 0),
      avgIrr: irrs.length > 0 ? irrs.reduce((a, b) => a + b, 0) / irrs.length : null,
    };
  });

  const flags: PortfolioModel['flags'] = [];
  rows.forEach((r) => {
    if (r.computeFailed) flags.push({ title: r.name, description: 'Could not be computed from its inputs; its figures are left blank and excluded from totals.' });
    else if (r.cashFlow !== null && r.cashFlow < 0) flags.push({ title: r.name, description: `Underwritten cash flow is ${money(r.cashFlow)}/yr; an operating deficit requires a reserve buffer.` });
  });
  const unlinked = rows.filter((r) => r.parcelCount === 0);
  if (unlinked.length > 0) flags.push({ title: 'Unlinked county parcels', description: `${unlinked.length} of ${rows.length} assets have no county parcel linked: ${unlinked.map((r) => r.name).join(', ')}.` });

  // Build aggregated 5-year portfolio pro-forma for owned operating holdings
  const ownedDeals = deals.filter((d) => (d.status || 'prospect').toLowerCase() === 'owned');
  const ownedDealProjections: Array<Array<Record<string, any>>> = [];
  for (const d of ownedDeals) {
    const em = tryComputeDealMetrics(d);
    if (em && Array.isArray(em.projections) && em.projections.length > 0) {
      ownedDealProjections.push(em.projections);
    }
  }

  const ownedProForma: PortfolioProFormaYear[] = [];
  if (ownedDealProjections.length > 0) {
    const yearsCount = Math.min(5, Math.max(...ownedDealProjections.map((p) => p.length)));
    for (let y = 0; y < yearsCount; y++) {
      let propVal = 0;
      let gross = 0;
      let vac = 0;
      let opex = 0;
      let noi = 0;
      let ds = 0;
      let cf = 0;
      let loan = 0;
      let calYear: number | undefined = undefined;

      for (const proj of ownedDealProjections) {
        const p = proj[y];
        if (!p) continue;
        if (p.calendarYear && !calYear) calYear = p.calendarYear;
        propVal += Number(p.propertyValue) || 0;
        gross += Number(p.grossPotentialIncome ?? p.grossPotentialRent ?? p.effectiveGrossIncome) || 0;
        vac += Number(p.vacancyLoss) || 0;
        opex += Number(p.operatingExpenses) || 0;
        noi += Number(p.netOperatingIncome) || 0;
        ds += Number(p.debtService) || 0;
        cf += Number(p.netCashFlow ?? p.cashFlow) || 0;
        loan += Number(p.loanBalanceRemaining ?? p.endingLoanBalance) || 0;
      }

      const equity = Math.max(0, propVal - loan);
      const capRate = propVal > 0 && noi > 0 ? (noi / propVal) * 100 : 0;
      const coc = equity > 0 ? (cf / equity) * 100 : 0;

      ownedProForma.push({
        year: y + 1,
        calendarYear: calYear || now.getFullYear() + y,
        propertyValue: Math.round(propVal),
        grossIncome: Math.round(gross),
        vacancyLoss: Math.round(vac),
        operatingExpenses: Math.round(opex),
        netOperatingIncome: Math.round(noi),
        debtService: Math.round(ds),
        netCashFlow: Math.round(cf),
        cashOnCash: Number(coc.toFixed(2)),
        capRate: Number(capRate.toFixed(2)),
        loanBalance: Math.round(loan),
        endingEquity: Math.round(equity),
      });
    }
  }

  return {
    investorName: text(opts.investorName),
    companyName: text(opts.companyName),
    hurdleRate: opts.hurdleRate ?? null,
    dateStr: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    kpis,
    totalVolume,
    totalDeals: deals.length,
    footprintAcres: rows.reduce((s, r) => s + r.acres, 0),
    footprintSqFt: rows.reduce((s, r) => s + r.buildingSqFt, 0),
    sectors,
    owned,
    ownedProForma,
    pipeline,
    audit: [...rows].sort((a, b) => (a.isOwned === b.isOwned ? 0 : a.isOwned ? -1 : 1)),
    flags,
  };
}
