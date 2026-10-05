import type { DealRecord } from '../../../lib/math/types';
import { getExpiryDefaults } from '../../../lib/engine/expiryDefaults';

export type Form = Record<string, string> & { manageProperty: string; storageAutomated: string };

/** A stated value as a string; blank when the deal does not state it. There is no fallback: a blank field stays blank and is flagged. */
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Port of legacy openEditDealModalFromProject: seed the form from the deal's facts, and only its facts. */
export function seedForm(deal: DealRecord): Form {
  const i: any = deal.inputs ?? {};
  const a = String(deal.asset_class ?? 'commercial');
  const lease = (Array.isArray(i.leases) && i.leases[0]) || {};

  let preAnnual: number | undefined;
  let preMonthly: number | undefined;
  if (a === 'commercial') {
    preAnnual = i.grossRentAnnual ?? (i.grossRentPerMonth ? i.grossRentPerMonth * 12 : undefined);
  } else if (a === 'single-family') {
    preMonthly = i.monthlyRent ?? i.grossRentPerMonth ?? (i.grossRentAnnual ? Math.round(i.grossRentAnnual / 12) : undefined);
    preAnnual = preMonthly ? preMonthly * 12 : undefined;
  } else if (a === 'multi-unit') {
    const u = i.unitCount || i.numUnits || 0;
    preMonthly = i.monthlyRentPerUnit ?? i.rentPerUnit ?? (u && i.grossRentPerMonth ? Math.round(i.grossRentPerMonth / u) : (u && i.monthlyRent ? Math.round(i.monthlyRent / u) : undefined));
    preAnnual = i.grossRentAnnual ?? (preMonthly && u ? preMonthly * u * 12 : undefined);
  } else if (a === 'storage') {
    const u = i.storageUnitCount || i.unitCount || 0;
    preMonthly = i.storageRentPerUnit ?? i.monthlyRentPerUnit ?? (u && i.grossRentPerMonth ? Math.round(i.grossRentPerMonth / u) : (u && i.monthlyRent ? Math.round(i.monthlyRent / u) : undefined));
    preAnnual = i.grossRentAnnual ?? (preMonthly && u ? preMonthly * u * 12 : undefined);
  }
  const appRate = a === 'commercial' || a === 'storage' ? (i.targetCapRate ?? i.targetExitCapRate) : i.appreciationRate;
  const capexIsPercent = i.capexReservePercent !== undefined && i.capexReservePercent !== null && i.capexReservePercent !== '';

  return {
    name: deal.title || '',
    location: deal.location || '',
    status: deal.status || 'prospect',
    entity: deal.entity_id || i.entity_id || '',
    price: str(deal.purchase_price || i.purchasePrice),
    marketTier: str(i.marketTier || i.commTier || i.storageTier) || 'Tier 2',
    propertyClass: str(i.propertyClass || i.commClass || i.storageClass) || 'Class B',
    facilityType: str(i.facilityType),
    // Rents are shown in whole dollars: cents and floating-point noise (38192.399999999994) are not information
    grossRentAnnual: str(preAnnual === undefined ? undefined : Math.round(Number(preAnnual))),
    grossRentMonthly: str(preMonthly === undefined ? undefined : Math.round(Number(preMonthly))),
    vacancyRate: str(i.vacancyRate ?? i.vacancyRatePercent),
    rentGrowth: str(i.rentGrowth ?? i.annualRentGrowth ?? i.rentGrowthPercent),
    appreciation: str(appRate),
    opexRatio: str(i.expenseRatio ?? i.operatingExpenseRatio),
    expenseGrowth: str(i.expenseGrowth ?? i.expenseInflation ?? i.expenseGrowthRate ?? i.expenseGrowthPercent),
    // Reflect what the engine does: an unset flag means no management fee, so never pre-tick it.
    manageProperty: i.manageProperty ? 'true' : 'false',
    managementFee: str(i.managementFeePercent),
    payroll: str(i.payrollMarketingPercent),
    capexKind: capexIsPercent ? 'percent' : 'annual',
    capexValue: str(capexIsPercent ? i.capexReservePercent : (i.capexReserveAnnual ?? i.capexReserve)),
    taxes: str(i.annualTaxes ?? i.propertyTaxes),
    insurance: str(i.annualInsurance ?? i.insurance),
    maintenance: str(i.annualMaintenance ?? i.maintenance),
    utilities: str(i.annualUtilities ?? i.utilities),
    sellingCost: str(i.sellingCostPercent),
    rehabCosts: str(i.rehabCosts ?? i.rehabBudget),
    closingCosts: str(i.closingCosts),
    closingDate: str(i.closingDate),
    exitYear: str(i.holdingPeriod ?? i.exitYear ?? i.holdYears),
    discountRate: str(i.discountRate ?? i.discountRatePercent),
    rehabMode: i.rehabFinancingMode || (i.financeRehabAndClosingCosts ? 'roll_into_loan' : 'out_of_pocket'),
    exitCapTiming: i.exitCapTiming || 'amortized',
    financingType: i.financingType || 'fixed',
    armInitial: str(i.armInitialYears),
    armRate: str(i.armAdjustmentRate),
    armCap: str(i.armRateCap),
    ioYears: str(i.interestOnlyYears),
    downPayment: str(i.downPaymentPercent),
    loanAmount: str(i.loanAmount),
    interestRate: str(i.interestRate),
    // `loanTerm` is the key the wizard has always stored for the amortization period
    amortization: str(i.amortizationYears ?? i.loanTerm),
    maturity: str(i.loanMaturityYears ?? i.loanTermYears),
    leaseType: i.leaseType || '',
    // Only what was entered: the project's name is not a tenant, and a closing date is not a lease start
    tenantName: str(lease.tenantName || i.tenantName),
    leaseStart: str(lease.leaseStartDate || i.leaseStartDate),
    leaseEnd: str(lease.leaseEndDate || i.leaseEndDate),
    // Many leases (most residential) are month to month and have no end date: say so, rather than invent one
    termType: str(lease.termType),
    escalationType: str(lease.escalationType) || 'Percentage Bump (%)',
    escalation: str(lease.escalationRate),
    nextEscalation: str(lease.nextEscalationDate),
    dueDay: str(lease.paymentDueDay) || '1',
    graceDays: str(lease.gracePeriodDays) || '5',
    expiryAssumption: str(lease.expiryAssumption),
    extensionYears: str(lease.extensionYears) || '5',
    extensionRentChangePct: str(lease.extensionRentChangePct) || '0',
    reletVacancyMonths: str(lease.reletVacancyMonths) || String(getExpiryDefaults().vacancyMonths),
    reletRentChangePct: str(lease.reletRentChangePct) || '0',
    reletCosts: str(lease.reletCosts) || '0',
    gla: str(i.gla || i.buildingSqFt),
    unitCount: str(i.unitCount || i.numUnits),
    storageUnits: str(i.storageUnitCount || i.unitCount),
    storageSqft: str(i.storageSqFt || i.totalSqFt || i.gla),
    storageAutomated: String(!!i.isAutomated),
    arv: str(i.arv),
  } as Form;
}

/**
 * Port of legacy getEditModalInputs (same keys the engine and the legacy page use). A blank field becomes `undefined`, which clears the
 * saved value and leaves the deal asking for it: nothing is substituted for what the owner did not state.
 */
export function buildInputs(f: Form, deal: DealRecord): Record<string, any> {
  const prev: any = deal.inputs ?? {};
  const a = String(deal.asset_class ?? 'commercial');
  const opt = (v: string | undefined): number | undefined => {
    if (v === undefined || v.trim() === '') return undefined;
    const n = parseFloat(v);
    return Number.isNaN(n) ? undefined : n;
  };
  const optInt = (v: string | undefined): number | undefined => {
    const n = opt(v);
    return n === undefined ? undefined : Math.round(n);
  };
  const nonNeg = (v: string | undefined): number | null => { const n = opt(v); return n === undefined ? null : Math.max(0, n); };
  const cents = (n: number): number => Math.round(n * 100) / 100;
  const annual = nonNeg(f.grossRentAnnual);
  const monthly = nonNeg(f.grossRentMonthly);
  const isIncomeValued = a === 'commercial' || a === 'storage';
  const app = opt(f.appreciation);
  const amort = optInt(f.amortization);
  const capex = opt(f.capexValue);
  const hold = optInt(f.exitYear);

  const o: Record<string, any> = {
    purchasePrice: opt(f.price),
    downPaymentPercent: opt(f.downPayment),
    loanAmount: opt(f.loanAmount),
    interestRate: opt(f.interestRate),
    amortizationYears: amort,
    loanTerm: amort,
    loanMaturityYears: optInt(f.maturity),
    expenseRatio: opt(f.opexRatio),
    operatingExpenseRatio: opt(f.opexRatio),
    expenseGrowth: opt(f.expenseGrowth),
    expenseInflation: opt(f.expenseGrowth),
    vacancyRate: opt(f.vacancyRate),
    rentGrowth: opt(f.rentGrowth),
    annualRentGrowth: opt(f.rentGrowth),
    // Commercial/storage are valued off NOI and an exit cap rate; residential is valued by appreciation. One form
    // field feeds only the key its asset class uses, and the other key is left as saved.
    ...(isIncomeValued
      ? { targetCapRate: app, targetExitCapRate: app }
      : { appreciationRate: app }),
    sellingCostPercent: opt(f.sellingCost),
    rehabCosts: opt(f.rehabCosts) ?? 0,
    rehabBudget: opt(f.rehabCosts) ?? 0,
    rehabFinancingMode: f.rehabMode || 'out_of_pocket',
    financeRehabAndClosingCosts: f.rehabMode === 'roll_into_loan',
    closingCosts: opt(f.closingCosts),
    closingDate: f.closingDate || undefined,
    leaseType: f.leaseType || undefined,
    exitYear: hold,
    holdingPeriod: hold,
    discountRate: opt(f.discountRate),
    financingType: f.financingType || 'fixed',
    armInitialYears: optInt(f.armInitial),
    armAdjustmentRate: opt(f.armRate),
    armRateCap: opt(f.armCap),
    interestOnlyYears: optInt(f.ioYears),
    manageProperty: f.manageProperty === 'true',
    managementFeePercent: opt(f.managementFee),
    // Reserves are stated as dollars a year or a share of income, never both; the old `capexReserve` key folds into the new one
    capexReserveAnnual: f.capexKind === 'percent' ? undefined : capex,
    capexReservePercent: f.capexKind === 'percent' ? capex : undefined,
    capexReserve: undefined,
    annualTaxes: opt(f.taxes),
    annualInsurance: opt(f.insurance),
    annualMaintenance: opt(f.maintenance),
    annualUtilities: opt(f.utilities),
    exitCapTiming: f.exitCapTiming || 'amortized',
    marketTier: f.marketTier || 'Tier 2',
    propertyClass: f.propertyClass || 'Class B',
    facilityType: (f.facilityType || '').trim(),
  };
  if (a === 'storage') o.payrollMarketingPercent = opt(f.payroll);

  if (a === 'single-family') {
    o.monthlyRent = monthly !== null ? monthly : annual !== null ? Math.round(annual / 12) : prev.monthlyRent;
    o.grossRentPerMonth = o.monthlyRent;
    o.grossRentAnnual = o.monthlyRent !== undefined ? cents(o.monthlyRent * 12) : undefined;
    o.arv = opt(f.arv);
  } else if (a === 'multi-unit') {
    const units = optInt(f.unitCount);
    o.unitCount = units;
    o.numUnits = units;
    if (monthly !== null) {
      o.monthlyRentPerUnit = monthly;
      // With no unit count the total cannot be worked out, so it is left blank rather than guessed
      o.grossRentPerMonth = units ? cents(monthly * units) : undefined;
      o.monthlyRent = o.grossRentPerMonth;
      o.grossRentAnnual = o.grossRentPerMonth !== undefined ? cents(o.grossRentPerMonth * 12) : undefined;
    } else if (annual !== null) {
      o.monthlyRentPerUnit = units ? Math.round(annual / 12 / units) : undefined;
      o.grossRentAnnual = annual;
      o.grossRentPerMonth = Math.round(annual / 12);
      o.monthlyRent = o.grossRentPerMonth;
    } else {
      o.grossRentAnnual = prev.grossRentAnnual;
      o.grossRentPerMonth = prev.grossRentPerMonth;
      o.monthlyRent = o.grossRentPerMonth;
      o.monthlyRentPerUnit = prev.monthlyRentPerUnit;
    }
  } else if (a === 'commercial') {
    if (annual !== null) {
      o.grossRentAnnual = annual;
      o.grossRentPerMonth = Math.round(annual / 12);
      o.monthlyRent = o.grossRentPerMonth;
    } else if (monthly !== null) {
      o.grossRentAnnual = cents(monthly * 12);
      o.grossRentPerMonth = monthly;
      o.monthlyRent = monthly;
    } else {
      o.grossRentAnnual = prev.grossRentAnnual;
      o.grossRentPerMonth = prev.grossRentPerMonth;
      o.monthlyRent = o.grossRentPerMonth;
    }
    o.gla = opt(f.gla);
  } else if (a === 'storage') {
    const units = optInt(f.storageUnits);
    o.storageUnitCount = units;
    o.unitCount = units;
    o.storageSqFt = opt(f.storageSqft);
    o.totalSqFt = o.storageSqFt;
    o.isAutomated = f.storageAutomated === 'true';
    if (monthly !== null) {
      o.monthlyRentPerUnit = monthly;
      o.storageRentPerUnit = monthly;
      o.grossRentPerMonth = units ? cents(monthly * units) : undefined;
      o.monthlyRent = o.grossRentPerMonth;
      o.grossRentAnnual = o.grossRentPerMonth !== undefined ? cents(o.grossRentPerMonth * 12) : undefined;
    } else if (annual !== null) {
      o.monthlyRentPerUnit = units ? Math.round(annual / 12 / units) : undefined;
      o.storageRentPerUnit = o.monthlyRentPerUnit;
      o.grossRentAnnual = annual;
      o.grossRentPerMonth = Math.round(annual / 12);
      o.monthlyRent = o.grossRentPerMonth;
    } else {
      o.grossRentAnnual = prev.grossRentAnnual;
      o.grossRentPerMonth = prev.grossRentPerMonth;
      o.monthlyRent = o.grossRentPerMonth;
    }
  }
  return o;
}
