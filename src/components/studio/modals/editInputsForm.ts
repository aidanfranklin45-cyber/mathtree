import type { DealRecord } from '../../../lib/math/types';

export type Form = Record<string, string> & { manageProperty: string; storageAutomated: string };

const str = (v: unknown, fallback: unknown = ''): string => (v === undefined || v === null || v === '' ? String(fallback ?? '') : String(v));

/** Port of legacy openEditDealModalFromProject: seed the form from the deal's facts. */
export function seedForm(deal: DealRecord): Form {
  const i: any = deal.inputs ?? {};
  const a = String(deal.asset_class ?? 'commercial');
  const lease = (Array.isArray(i.leases) && i.leases[0]) || {};

  let preAnnual = 0;
  let preMonthly = 0;
  if (a === 'commercial') {
    preAnnual = i.grossRentAnnual ?? (i.grossRentPerMonth ? i.grossRentPerMonth * 12 : 0);
  } else if (a === 'single-family') {
    preMonthly = i.monthlyRent ?? i.grossRentPerMonth ?? (i.grossRentAnnual ? Math.round(i.grossRentAnnual / 12) : 0);
    preAnnual = preMonthly ? preMonthly * 12 : 0;
  } else if (a === 'multi-unit') {
    const u = i.unitCount || i.numUnits || 4;
    preMonthly = i.monthlyRentPerUnit ?? i.rentPerUnit ?? (i.grossRentPerMonth ? Math.round(i.grossRentPerMonth / u) : 0);
    preAnnual = i.grossRentAnnual ?? (preMonthly ? preMonthly * u * 12 : 0);
  } else if (a === 'storage') {
    const u = i.storageUnitCount || i.unitCount || 20;
    preMonthly = i.storageRentPerUnit ?? i.monthlyRentPerUnit ?? (i.grossRentPerMonth ? Math.round(i.grossRentPerMonth / u) : 0);
    preAnnual = i.grossRentAnnual ?? (preMonthly ? preMonthly * u * 12 : 0);
  }
  const appRate = a === 'commercial' || a === 'storage'
    ? (i.targetCapRate ?? i.targetExitCapRate ?? i.appreciationRate ?? 6.5)
    : (i.appreciationRate ?? 3.5);

  return {
    name: deal.title || '',
    location: deal.location || '',
    status: deal.status || 'prospect',
    entity: deal.entity_id || i.entity_id || '',
    price: str(deal.purchase_price || i.purchasePrice, 0),
    marketTier: str(i.marketTier || i.commTier || i.storageTier, 'Tier 2'),
    propertyClass: str(i.propertyClass || i.commClass || i.storageClass, 'Class B'),
    facilityType: str(i.facilityType),
    grossRentAnnual: str(preAnnual, 0),
    grossRentMonthly: str(preMonthly, 0),
    vacancyRate: str(i.vacancyRate, 5),
    rentGrowth: str(i.rentGrowth ?? i.annualRentGrowth, 3),
    appreciation: str(appRate),
    opexRatio: str(i.expenseRatio ?? i.operatingExpenseRatio, 35),
    // Reflect what the engine assumes: an unset flag means no management fee, so never pre-tick it.
    manageProperty: i.manageProperty ? 'true' : 'false',
    rehabCosts: str(i.rehabCosts ?? i.rehabBudget, 0),
    closingCosts: str(i.closingCosts, 0),
    closingDate: str(i.closingDate, '2026-10-01'),
    exitYear: str(i.exitYear, 10),
    discountRate: str(i.discountRate, 8),
    rehabMode: i.rehabFinancingMode || (i.financeRehabAndClosingCosts ? 'roll_into_loan' : 'out_of_pocket'),
    exitCapTiming: i.exitCapTiming || 'amortized',
    financingType: i.financingType || 'fixed',
    armInitial: str(i.armInitialYears, 5),
    armRate: str(i.armAdjustmentRate, 7.75),
    armCap: str(i.armRateCap, 9.5),
    ioYears: str(i.interestOnlyYears, 3),
    downPayment: str(i.downPaymentPercent, 25),
    interestRate: str(i.interestRate, 6.5),
    loanTerm: str(i.loanTerm, 30),
    leaseType: i.leaseType || (a === 'commercial' ? 'NNN' : 'Gross'),
    tenantName: str(lease.tenantName || i.tenantName || deal.title),
    leaseStart: str(lease.leaseStartDate || i.leaseStartDate || i.closingDate),
    leaseEnd: str(lease.leaseEndDate || i.leaseEndDate),
    escalationType: str(lease.escalationType, 'Percentage Bump (%)'),
    nextEscalation: str(lease.nextEscalationDate),
    dueDay: str(lease.paymentDueDay, 1),
    graceDays: str(lease.gracePeriodDays, 5),
    expiryAssumption: str(lease.expiryAssumption, 'none'),
    extensionYears: str(lease.extensionYears, 5),
    extensionRentChangePct: str(lease.extensionRentChangePct, 0),
    reletVacancyMonths: str(lease.reletVacancyMonths, 12),
    reletRentChangePct: str(lease.reletRentChangePct, 0),
    reletCosts: str(lease.reletCosts, 0),
    gla: str(i.gla, 15000),
    unitCount: str(i.unitCount || i.numUnits, 4),
    storageUnits: str(i.storageUnitCount || i.unitCount, a === 'storage' ? 20 : 100),
    storageSqft: str(i.storageSqFt || i.totalSqFt || i.gla, a === 'storage' ? 2000 : 10000),
    storageAutomated: String(!!i.isAutomated),
    arv: str(i.arv),
  } as Form;
}

/** Port of legacy getEditModalInputs (same keys the engine and the legacy page use). */
export function buildInputs(f: Form, deal: DealRecord): Record<string, any> {
  const prev: any = deal.inputs ?? {};
  const a = String(deal.asset_class ?? 'commercial');
  const num = (v: string, fb: number) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
  const int = (v: string, fb: number) => { const n = parseInt(v, 10); return isNaN(n) ? fb : n; };
  const optional = (v: string) => { const n = parseFloat(v); return v.trim() !== '' && !isNaN(n) ? Math.max(0, n) : null; };
  const annual = optional(f.grossRentAnnual);
  const monthly = optional(f.grossRentMonthly);
  const app = num(f.appreciation, 3.5);

  const o: Record<string, any> = {
    purchasePrice: num(f.price, 0),
    downPaymentPercent: num(f.downPayment, 25),
    interestRate: num(f.interestRate, 6.5),
    loanTerm: int(f.loanTerm, 30),
    expenseRatio: num(f.opexRatio, 35),
    operatingExpenseRatio: num(f.opexRatio, 35),
    vacancyRate: num(f.vacancyRate, 5),
    rentGrowth: num(f.rentGrowth, 3),
    annualRentGrowth: num(f.rentGrowth, 3),
    appreciationRate: app,
    targetCapRate: app,
    targetExitCapRate: app,
    rehabCosts: num(f.rehabCosts, 0),
    rehabBudget: num(f.rehabCosts, 0),
    rehabFinancingMode: f.rehabMode || 'out_of_pocket',
    financeRehabAndClosingCosts: f.rehabMode === 'roll_into_loan',
    closingCosts: num(f.closingCosts, 0),
    closingDate: f.closingDate || prev.closingDate || '2026-10-01',
    leaseType: f.leaseType || 'Gross',
    exitYear: int(f.exitYear, 10),
    discountRate: num(f.discountRate, 8),
    financingType: f.financingType || 'fixed',
    armInitialYears: int(f.armInitial, 5),
    armAdjustmentRate: num(f.armRate, 7.75),
    armRateCap: num(f.armCap, 9.5),
    interestOnlyYears: int(f.ioYears, 3),
    manageProperty: f.manageProperty === 'true',
    exitCapTiming: f.exitCapTiming || 'amortized',
    marketTier: f.marketTier || 'Tier 2',
    propertyClass: f.propertyClass || 'Class B',
    facilityType: (f.facilityType || '').trim(),
  };

  if (a === 'single-family') {
    o.monthlyRent = monthly !== null ? monthly : annual !== null ? Math.round(annual / 12) : (prev.monthlyRent ?? 0);
    o.grossRentPerMonth = o.monthlyRent;
    o.grossRentAnnual = o.monthlyRent * 12;
    o.arv = num(f.arv, 0);
  } else if (a === 'multi-unit') {
    o.unitCount = int(f.unitCount, 4);
    o.numUnits = o.unitCount;
    if (monthly !== null) {
      o.monthlyRentPerUnit = monthly;
      o.grossRentPerMonth = monthly * o.unitCount;
      o.monthlyRent = o.grossRentPerMonth;
      o.grossRentAnnual = o.grossRentPerMonth * 12;
    } else if (annual !== null) {
      o.monthlyRentPerUnit = o.unitCount > 0 ? Math.round(annual / 12 / o.unitCount) : 0;
      o.grossRentAnnual = annual;
      o.grossRentPerMonth = Math.round(annual / 12);
      o.monthlyRent = o.grossRentPerMonth;
    } else {
      o.grossRentAnnual = prev.grossRentAnnual ?? 0;
      o.grossRentPerMonth = prev.grossRentPerMonth ?? 0;
      o.monthlyRent = o.grossRentPerMonth;
      o.monthlyRentPerUnit = prev.monthlyRentPerUnit ?? 0;
    }
  } else if (a === 'commercial') {
    if (annual !== null) {
      o.grossRentAnnual = annual;
      o.grossRentPerMonth = Math.round(annual / 12);
      o.monthlyRent = o.grossRentPerMonth;
    } else if (monthly !== null) {
      o.grossRentAnnual = monthly * 12;
      o.grossRentPerMonth = monthly;
      o.monthlyRent = monthly;
    } else {
      o.grossRentAnnual = prev.grossRentAnnual ?? 0;
      o.grossRentPerMonth = prev.grossRentPerMonth ?? 0;
      o.monthlyRent = o.grossRentPerMonth;
    }
    o.leaseType = f.leaseType || 'NNN';
    o.gla = num(f.gla, 15000);
  } else if (a === 'storage') {
    o.storageUnitCount = int(f.storageUnits, 20);
    o.unitCount = o.storageUnitCount;
    o.storageSqFt = num(f.storageSqft, 2000);
    o.totalSqFt = o.storageSqFt;
    o.isAutomated = f.storageAutomated === 'true';
    if (monthly !== null) {
      o.monthlyRentPerUnit = monthly;
      o.storageRentPerUnit = monthly;
      o.grossRentPerMonth = monthly * o.storageUnitCount;
      o.monthlyRent = o.grossRentPerMonth;
      o.grossRentAnnual = o.grossRentPerMonth * 12;
    } else if (annual !== null) {
      o.monthlyRentPerUnit = o.storageUnitCount > 0 ? Math.round(annual / 12 / o.storageUnitCount) : 0;
      o.storageRentPerUnit = o.monthlyRentPerUnit;
      o.grossRentAnnual = annual;
      o.grossRentPerMonth = Math.round(annual / 12);
      o.monthlyRent = o.grossRentPerMonth;
    } else {
      o.grossRentAnnual = prev.grossRentAnnual ?? 0;
      o.grossRentPerMonth = prev.grossRentPerMonth ?? 0;
      o.monthlyRent = o.grossRentPerMonth;
    }
  }
  return o;
}

