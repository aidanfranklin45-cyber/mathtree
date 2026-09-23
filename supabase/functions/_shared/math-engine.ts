// supabase/functions/_shared/math-engine.ts
// Canonical shared financial computation engine for MathTree Supabase Edge Functions.

import type {
  AssetClass,
  DealInputs,
  DealMetrics,
  ProFormaYear,
  AmortizationScheduleEntry,
  TaxMetrics,
  SensitivityMatrix,
} from './types.ts';

// ---------------------------------------------------------------------------
// Utility: safe numeric coercion
// ---------------------------------------------------------------------------
function n(v: unknown, fallback = 0): number {
  const parsed = parseFloat(String(v ?? fallback));
  return isNaN(parsed) ? fallback : parsed;
}

function ni(v: unknown, fallback = 0): number {
  const parsed = parseInt(String(v ?? fallback), 10);
  return isNaN(parsed) ? fallback : parsed;
}

// ---------------------------------------------------------------------------
// Primitive: Monthly Payment (standard amortization)
// ---------------------------------------------------------------------------
export function calculateMonthlyPayment(
  loanAmount: number,
  annualRate: number,
  termYears: number,
): number {
  if (loanAmount <= 0 || termYears <= 0) return 0;
  const r = annualRate / 100 / 12;
  const numPayments = termYears * 12;
  if (r === 0) return loanAmount / numPayments;
  return (loanAmount * (r * Math.pow(1 + r, numPayments))) /
    (Math.pow(1 + r, numPayments) - 1);
}

// ---------------------------------------------------------------------------
// Primitive: Remaining Loan Balance at elapsed years
// ---------------------------------------------------------------------------
export function calculateRemainingBalance(
  loanAmount: number,
  annualRate: number,
  termYears: number,
  elapsedYears: number,
): number {
  if (loanAmount <= 0) return 0;
  if (elapsedYears >= termYears) return 0;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  const p = elapsedYears * 12;
  if (r === 0) return loanAmount * (1 - p / n);
  const mp = calculateMonthlyPayment(loanAmount, annualRate, termYears);
  return loanAmount * Math.pow(1 + r, p) -
    (mp * (Math.pow(1 + r, p) - 1)) / r;
}

// ---------------------------------------------------------------------------
// Primitive: Annual Amortization Schedule
// ---------------------------------------------------------------------------
export function getAnnualAmortization(
  loanAmount: number,
  annualRate: number,
  termYears: number,
  options: DealInputs = {},
): AmortizationScheduleEntry[] {
  const schedule: AmortizationScheduleEntry[] = [];
  const finType = String(options.financingType ?? 'fixed').toLowerCase();
  const holdYears = Math.max(
    1,
    Math.min(
      30,
      ni(options.holdingPeriod ?? options.exitYear ?? 10),
    ),
  );
  const maxYears = holdYears;

  // Interest-only years
  const ioYearsRaw = options.interestOnlyYears !== undefined
    ? ni(options.interestOnlyYears)
    : (finType === 'interest_only' ? 3 : 0);
  const ioYears = ioYearsRaw;

  if (loanAmount <= 0 || termYears <= 0) {
    for (let year = 1; year <= maxYears; year++) {
      schedule.push({
        year,
        appliedRate: annualRate,
        beginningBalance: 0,
        totalPayment: 0,
        principalPaid: 0,
        interestPaid: 0,
        endingBalance: 0,
        cumulativePrincipalPaid: 0,
        isInterestOnly: false,
        isArmAdjusted: false,
        operatingMonths: 12,
      });
    }
    return schedule;
  }

  let currentBalance = loanAmount;
  let cumulativePrincipal = 0;
  const monthlyRate = annualRate / 100 / 12;

  // ARM parameters
  const armInitialYears = ni(options.armInitialYears ?? 5);
  const armAdjRate = n(options.armAdjustmentRate ?? 0);
  const armCap = n(options.armRateCap ?? annualRate + 5);

  for (let year = 1; year <= maxYears; year++) {
    const isIO = year <= ioYears;
    const isArm = finType === 'arm';
    let appliedAnnualRate = annualRate;
    let isArmAdjusted = false;

    if (isArm && year > armInitialYears) {
      appliedAnnualRate = Math.min(
        armCap,
        annualRate + armAdjRate * (year - armInitialYears),
      );
      isArmAdjusted = true;
    }

    const appliedMonthlyRate = appliedAnnualRate / 100 / 12;
    const mp = isIO
      ? 0
      : calculateMonthlyPayment(currentBalance, appliedAnnualRate, termYears);

    const begBal = currentBalance;
    let yearPrincipal = 0;
    let yearInterest = 0;

    for (let m = 1; m <= 12; m++) {
      if (currentBalance <= 0) break;
      const interest = currentBalance * appliedMonthlyRate;
      let principal = isIO ? 0 : mp - interest;
      if (principal < 0) principal = 0;
      if (principal > currentBalance) principal = currentBalance;
      currentBalance = Math.max(0, currentBalance - principal);
      yearInterest += interest;
      yearPrincipal += principal;
    }

    cumulativePrincipal += yearPrincipal;
    schedule.push({
      year,
      appliedRate: appliedAnnualRate,
      beginningBalance: Math.round(begBal),
      totalPayment: Math.round(yearPrincipal + yearInterest),
      principalPaid: Math.round(yearPrincipal),
      interestPaid: Math.round(yearInterest),
      endingBalance: Math.round(currentBalance),
      cumulativePrincipalPaid: Math.round(cumulativePrincipal),
      isInterestOnly: isIO,
      isArmAdjusted,
      operatingMonths: 12,
    });
  }

  return schedule;
}

// ---------------------------------------------------------------------------
// Primitive: NPV
// ---------------------------------------------------------------------------
export function calculateNPV(rate: number, cashFlows: number[]): number {
  const r = rate / 100;
  let npv = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    npv += cashFlows[t] / Math.pow(1 + r, t);
  }
  return Math.round(npv);
}

// ---------------------------------------------------------------------------
// Primitive: IRR (Newton-Raphson)
// ---------------------------------------------------------------------------
export function calculateIRR(cashFlows: number[], guess = 0.1): number {
  const maxIter = 1000;
  const tol = 1e-7;
  let r = guess;

  for (let i = 0; i < maxIter; i++) {
    let fv = 0;
    let fd = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + r, t);
      fv += cashFlows[t] / denom;
      if (t > 0) fd -= (t * cashFlows[t]) / Math.pow(1 + r, t + 1);
    }
    if (Math.abs(fv) < tol) return Math.round(r * 10000) / 100;
    if (Math.abs(fd) < 1e-12) break;
    const nextR = r - fv / fd;
    if (Math.abs(nextR - r) < tol) return Math.round(nextR * 10000) / 100;
    r = nextR;
  }
  return Math.round(r * 10000) / 100;
}

// ---------------------------------------------------------------------------
// Revenue resolution: derive base gross rent from many possible input shapes
// ---------------------------------------------------------------------------
function resolveBaseGrossRent(inputs: DealInputs, price: number): number {
  let base = n(inputs.grossRentAnnual);
  if (!base && inputs.monthlyRent) base = n(inputs.monthlyRent) * 12;
  if (!base && inputs.grossRentPerMonth) base = n(inputs.grossRentPerMonth) * 12;
  if (!base && Array.isArray(inputs.leases) && inputs.leases.length > 0) {
    base = (inputs.leases as Array<{ monthlyRent?: number }>).reduce(
      (sum, l) => sum + (n(l.monthlyRent)),
      0,
    ) * 12;
  }
  if (!base && price > 0) base = price * 0.09; // fallback: 9% of value
  return base;
}

// ---------------------------------------------------------------------------
// Core: Full Pro-Forma Projection
// ---------------------------------------------------------------------------
export function calculateProjections(
  assetClass: AssetClass,
  inputs: DealInputs,
): DealMetrics {
  const price = n(inputs.purchasePrice);
  const holdYears = Math.max(
    1,
    Math.min(30, ni(inputs.holdingPeriod ?? inputs.exitYear ?? 10)),
  );
  const dpPct = inputs.downPaymentPercent !== undefined
    ? n(inputs.downPaymentPercent)
    : 25;
  const downPaymentAmount = price * (dpPct / 100);
  const closingCosts = n(inputs.closingCosts);
  const rehabCosts = n(inputs.rehabCosts);
  const initialCashInvested = inputs.initialEquity !== undefined
    ? n(inputs.initialEquity)
    : (downPaymentAmount + closingCosts + rehabCosts);
  const equity = initialCashInvested;
  const loanAmt = inputs.loanAmount !== undefined
    ? n(inputs.loanAmount)
    : Math.max(0, price - downPaymentAmount);
  const rate = inputs.interestRate !== undefined ? n(inputs.interestRate) : 6.5;
  const termYears = inputs.amortizationYears !== undefined
    ? ni(inputs.amortizationYears)
    : (inputs.loanTermYears !== undefined ? ni(inputs.loanTermYears) : 30);

  const baseGrossRent = resolveBaseGrossRent(inputs, price);
  let baseOpex = n(inputs.operatingExpensesAnnual);
  if (!baseOpex) baseOpex = baseGrossRent * 0.25;

  const rentGrowth = (inputs.rentGrowthPercent !== undefined
    ? n(inputs.rentGrowthPercent)
    : 3.0) / 100;
  const expGrowth = (inputs.expenseGrowthPercent !== undefined
    ? n(inputs.expenseGrowthPercent)
    : 2.5) / 100;
  const vacancyRate = (inputs.vacancyRatePercent !== undefined
    ? n(inputs.vacancyRatePercent)
    : 5.0) / 100;
  const exitCapRate = (inputs.exitCapRatePercent !== undefined
    ? n(inputs.exitCapRatePercent)
    : 6.5) / 100;
  const sellingCost = (inputs.sellingCostPercent !== undefined
    ? n(inputs.sellingCostPercent)
    : 3.0) / 100;
  const discountRate = inputs.discountRatePercent !== undefined
    ? n(inputs.discountRatePercent)
    : 8.0;

  const amortSchedule = getAnnualAmortization(loanAmt, rate, termYears, inputs);

  let startYear = new Date().getFullYear();
  if (inputs.closingDate) {
    const parsed = new Date(String(inputs.closingDate)).getFullYear();
    if (!isNaN(parsed) && parsed > 2000) startYear = parsed;
  }

  const projections: ProFormaYear[] = [];
  const cashFlowsForIRR: number[] = [-equity];
  let cumulativeCashFlow = 0;

  for (let y = 1; y <= holdYears; y++) {
    const gpr = baseGrossRent * Math.pow(1 + rentGrowth, y - 1);
    const vac = gpr * vacancyRate;
    const egi = gpr - vac;
    const opex = baseOpex * Math.pow(1 + expGrowth, y - 1);
    const noi = egi - opex;

    const amort = amortSchedule[y - 1] ?? {
      totalPayment: 0,
      principalPaid: 0,
      interestPaid: 0,
      endingBalance: 0,
    };
    const debtService = amort.totalPayment;
    const cf = noi - debtService;
    cumulativeCashFlow += cf;

    const propVal = exitCapRate > 0 ? noi / exitCapRate : price;
    let exitNet = 0;
    if (y === holdYears) {
      const grossProceeds = propVal * (1 - sellingCost);
      exitNet = Math.max(0, grossProceeds - amort.endingBalance);
      cashFlowsForIRR.push(cf + exitNet);
    } else {
      cashFlowsForIRR.push(cf);
    }

    // Break-even occupancy: opex + debtService / gpr
    const breakEvenOccupancyPct = gpr > 0
      ? Math.round(((opex + debtService) / gpr) * 10000) / 100
      : 0;

    projections.push({
      year: y,
      calendarYear: startYear + y - 1,
      grossPotentialRent: Math.round(gpr),
      vacancyLoss: Math.round(vac),
      effectiveGrossIncome: Math.round(egi),
      operatingExpenses: Math.round(opex),
      netOperatingIncome: Math.round(noi),
      debtService: Math.round(debtService),
      principalPaid: Math.round(amort.principalPaid),
      interestPaid: Math.round(amort.interestPaid),
      cashFlow: Math.round(cf),
      netCashFlow: Math.round(cf),
      cashOnCash: equity > 0
        ? Math.round((cf / equity) * 10000) / 100
        : 0,
      cumulativeCashFlow: Math.round(cumulativeCashFlow),
      endingLoanBalance: Math.round(amort.endingBalance),
      propertyValue: Math.round(propVal),
      exitProceedsNet: Math.round(exitNet),
      dscr: debtService > 0
        ? Math.round((noi / debtService) * 100) / 100
        : 'N/A',
      breakEvenOccupancyPct,
      isInterestOnly: amort.isInterestOnly,
    });
  }

  const p0 = projections[0] ?? ({} as ProFormaYear);
  const y1Noi = p0.netOperatingIncome ?? 0;
  const y1Cf = p0.cashFlow ?? 0;
  const irr = calculateIRR(cashFlowsForIRR);
  const npv = calculateNPV(discountRate, cashFlowsForIRR);

  let totalReturned = 0;
  for (let i = 1; i < cashFlowsForIRR.length; i++) totalReturned += cashFlowsForIRR[i];
  const equityMultiplier = equity > 0
    ? Math.round((totalReturned / equity) * 100) / 100
    : 1.0;

  return {
    purchasePrice: price,
    initialEquity: Math.round(equity),
    initialCashInvested: Math.round(equity),
    loanAmount: Math.round(loanAmt),
    ltv: price > 0 ? Math.round((loanAmt / price) * 100) : 0,
    noi: Math.round(y1Noi),
    capRate: price > 0 ? Math.round((y1Noi / price) * 10000) / 100 : 0,
    year1Cashflow: Math.round(y1Cf),
    cashOnCash: equity > 0 ? Math.round((y1Cf / equity) * 10000) / 100 : 0,
    irr: isNaN(irr) ? 0 : irr,
    equityMultiplier,
    npv,
    dscr: p0.dscr ?? 'N/A',
    projections,
    amortizationSchedule: amortSchedule,
  };
}

// ---------------------------------------------------------------------------
// Tax: MACRS Straight-Line Depreciation
// ---------------------------------------------------------------------------
export function calculateTaxMetrics(
  assetClass: AssetClass,
  inputs: DealInputs,
): TaxMetrics {
  const isResidential = assetClass === 'residential' || assetClass === 'multi_family';
  const depYears: 27.5 | 39.0 = isResidential ? 27.5 : 39.0;
  const price = n(inputs.purchasePrice);
  const landAllocationPct = inputs.landAllocationPercent !== undefined
    ? n(inputs.landAllocationPercent) / 100
    : 0.20;
  const effectiveTaxRate = inputs.effectiveTaxRatePercent !== undefined
    ? n(inputs.effectiveTaxRatePercent) / 100
    : 0.35;
  const depreciableBasis = price * (1 - landAllocationPct);
  const annualDepreciation = depYears > 0 ? depreciableBasis / depYears : 0;
  const annualTaxShield = annualDepreciation * effectiveTaxRate;

  return {
    depYears,
    depreciableBasis: Math.round(depreciableBasis),
    annualDepreciation: Math.round(annualDepreciation),
    annualTaxShield: Math.round(annualTaxShield),
    landAllocationPct,
    effectiveTaxRate,
  };
}

// ---------------------------------------------------------------------------
// Sensitivity: 2-way IRR matrix (exit cap rate × vacancy)
// ---------------------------------------------------------------------------
const DEFAULT_VACANCY_STEPS = [0, 2.5, 5.0, 7.5, 10.0];
const DEFAULT_CAP_RATE_STEPS = [5.5, 6.0, 6.5, 7.0, 7.5];

export function calculateSensitivityMatrix(
  assetClass: AssetClass,
  inputs: DealInputs,
  vacancySteps: number[] = DEFAULT_VACANCY_STEPS,
  capRateSteps: number[] = DEFAULT_CAP_RATE_STEPS,
): SensitivityMatrix {
  const irrGrid: number[][] = [];

  for (let ci = 0; ci < capRateSteps.length; ci++) {
    const row: number[] = [];
    for (let vi = 0; vi < vacancySteps.length; vi++) {
      const simInputs: DealInputs = {
        ...inputs,
        exitCapRatePercent: capRateSteps[ci],
        vacancyRatePercent: vacancySteps[vi],
      };
      const result = calculateProjections(assetClass, simInputs);
      row.push(result.irr);
    }
    irrGrid.push(row);
  }

  return { vacancySteps, capRateSteps, irrGrid };
}

// ---------------------------------------------------------------------------
// Deal Risk Audit: programmatic underwriting checks
// ---------------------------------------------------------------------------
export interface DealRiskItem {
  level: 'low' | 'medium' | 'high';
  category: string;
  message: string;
}

export function auditDealRisks(
  assetType: string,
  inputs: DealInputs,
  metrics: DealMetrics,
): DealRiskItem[] {
  const risks: DealRiskItem[] = [];
  const y1 = metrics.projections[0];

  if (typeof y1?.dscr === 'number' && y1.dscr < 1.2) {
    risks.push({
      level: 'high',
      category: 'Debt Coverage',
      message: `Initial DSCR of ${y1.dscr.toFixed(2)}x is below the institutional threshold (1.20x).`,
    });
  }

  if (metrics.ltv > 75) {
    risks.push({
      level: 'medium',
      category: 'Leverage',
      message: `LTV of ${metrics.ltv.toFixed(1)}% exceeds standard 75% commercial leverage benchmark.`,
    });
  }

  if (y1?.breakEvenOccupancyPct && y1.breakEvenOccupancyPct > 85) {
    risks.push({
      level: 'high',
      category: 'Occupancy',
      message: `Break-even occupancy (${y1.breakEvenOccupancyPct.toFixed(1)}%) requires high in-place tenancy.`,
    });
  }

  return risks;
}

