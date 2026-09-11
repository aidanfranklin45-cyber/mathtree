import { DealInputs, DealMetrics, ProFormaYear, AmortizationScheduleEntry, AssetClass } from './types';

export function calculateMonthlyPayment(loanAmount: number, annualRate: number, termYears: number): number {
  if (loanAmount <= 0 || termYears <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loanAmount / n;
  return (loanAmount * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}

export function calculateRemainingBalance(loanAmount: number, annualRate: number, termYears: number, elapsedYears: number): number {
  if (loanAmount <= 0) return 0;
  if (elapsedYears >= termYears) return 0;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  const p = elapsedYears * 12;
  if (r === 0) return loanAmount * (1 - p / n);
  const monthlyPayment = calculateMonthlyPayment(loanAmount, annualRate, termYears);
  return loanAmount * Math.pow(1 + r, p) - (monthlyPayment * (Math.pow(1 + r, p) - 1)) / r;
}

export function getAnnualAmortization(
  loanAmount: number,
  annualRate: number,
  termYears: number,
  options: any = {}
): AmortizationScheduleEntry[] {
  const schedule: AmortizationScheduleEntry[] = [];
  const finType = String(options.financingType || 'fixed').toLowerCase();
  const holdYears = parseInt(options.holdingPeriod || options.exitYear || '10', 10);
  const maxYears = Math.max(1, Math.min(30, isNaN(holdYears) ? 10 : holdYears));
  const ioYears = parseInt(options.interestOnlyYears !== undefined ? options.interestOnlyYears : (finType === 'interest_only' ? 3 : 0), 10);

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
  const monthlyPayment = calculateMonthlyPayment(loanAmount, annualRate, termYears);
  const monthlyRate = annualRate / 100 / 12;

  for (let year = 1; year <= maxYears; year++) {
    const isIO = year <= ioYears;
    const begBal = currentBalance;
    let yearPrincipal = 0;
    let yearInterest = 0;

    for (let m = 1; m <= 12; m++) {
      if (currentBalance <= 0) break;
      const interest = currentBalance * monthlyRate;
      let principal = isIO ? 0 : monthlyPayment - interest;
      if (principal > currentBalance) principal = currentBalance;
      currentBalance = Math.max(0, currentBalance - principal);
      yearInterest += interest;
      yearPrincipal += principal;
    }

    cumulativePrincipal += yearPrincipal;
    schedule.push({
      year,
      appliedRate: annualRate,
      beginningBalance: Math.round(begBal),
      totalPayment: Math.round(yearPrincipal + yearInterest),
      principalPaid: Math.round(yearPrincipal),
      interestPaid: Math.round(yearInterest),
      endingBalance: Math.round(currentBalance),
      cumulativePrincipalPaid: Math.round(cumulativePrincipal),
      isInterestOnly: isIO,
      isArmAdjusted: false,
      operatingMonths: 12,
    });
  }

  return schedule;
}

export function calculateNPV(rate: number, cashFlows: number[]): number {
  const r = rate / 100;
  let npv = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    npv += cashFlows[t] / Math.pow(1 + r, t);
  }
  return Math.round(npv);
}

export function calculateIRR(cashFlows: number[], guess = 0.1): number {
  const maxIter = 1000;
  const tol = 1e-7;
  let r = guess;

  for (let i = 0; i < maxIter; i++) {
    let fValue = 0;
    let fDerivative = 0;

    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + r, t);
      fValue += cashFlows[t] / denom;
      if (t > 0) {
        fDerivative -= (t * cashFlows[t]) / Math.pow(1 + r, t + 1);
      }
    }

    if (Math.abs(fValue) < tol) return Math.round(r * 10000) / 100;
    if (Math.abs(fDerivative) < 1e-12) break;
    const nextR = r - fValue / fDerivative;
    if (Math.abs(nextR - r) < tol) return Math.round(nextR * 10000) / 100;
    r = nextR;
  }
  return Math.round(r * 10000) / 100;
}

export function calculateProjections(assetClass: AssetClass, inputs: DealInputs): DealMetrics {
  const price = inputs.purchasePrice || 0;
  const holdYears = Math.max(1, Math.min(30, inputs.holdingPeriod || inputs.exitYear || 10));
  const dpPct = inputs.downPaymentPercent !== undefined ? inputs.downPaymentPercent : 25;
  const equity = inputs.initialEquity || (price * (dpPct / 100));
  const loanAmt = inputs.loanAmount !== undefined ? inputs.loanAmount : Math.max(0, price - equity);
  const rate = inputs.interestRate || 6.5;
  const termYears = inputs.amortizationYears || inputs.loanTermYears || 30;

  // Base revenue & expenses
  let baseGrossRent = inputs.grossRentAnnual || 0;
  if (!baseGrossRent && inputs.monthlyRent) baseGrossRent = inputs.monthlyRent * 12;
  if (!baseGrossRent && inputs.grossRentPerMonth) baseGrossRent = inputs.grossRentPerMonth * 12;
  if (!baseGrossRent && inputs.leases && inputs.leases.length > 0) {
    baseGrossRent = inputs.leases.reduce((sum, l) => sum + (l.monthlyRent * 12), 0);
  }
  if (!baseGrossRent && price > 0) baseGrossRent = price * 0.09;

  let baseOpex = inputs.operatingExpensesAnnual || 0;
  if (!baseOpex && price > 0) baseOpex = baseGrossRent * 0.25;

  const rentGrowth = (inputs.rentGrowthPercent !== undefined ? inputs.rentGrowthPercent : 3.0) / 100;
  const expGrowth = (inputs.expenseGrowthPercent !== undefined ? inputs.expenseGrowthPercent : 2.5) / 100;
  const vacancyRate = (inputs.vacancyRatePercent !== undefined ? inputs.vacancyRatePercent : 5.0) / 100;
  const exitCapRate = (inputs.exitCapRatePercent !== undefined ? inputs.exitCapRatePercent : 6.5) / 100;
  const sellingCost = (inputs.sellingCostPercent !== undefined ? inputs.sellingCostPercent : 3.0) / 100;
  const discountRate = inputs.discountRatePercent !== undefined ? inputs.discountRatePercent : 8.0;

  const amortSchedule = getAnnualAmortization(loanAmt, rate, termYears, inputs);

  let startYear = new Date().getFullYear();
  if (inputs.closingDate) {
    const parsed = new Date(inputs.closingDate).getFullYear();
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

    const amort = amortSchedule[y - 1] || { debtService: 0, totalPayment: 0, principalPaid: 0, interestPaid: 0, endingBalance: 0 };
    const debtService = amort.totalPayment || 0;
    const cf = noi - debtService;
    cumulativeCashFlow += cf;

    const propVal = exitCapRate > 0 ? (noi / exitCapRate) : price;
    let exitNet = 0;
    if (y === holdYears) {
      const grossProceeds = propVal * (1 - sellingCost);
      exitNet = Math.max(0, grossProceeds - amort.endingBalance);
      cashFlowsForIRR.push(cf + exitNet);
    } else {
      cashFlowsForIRR.push(cf);
    }

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
      cashOnCash: equity > 0 ? Math.round((cf / equity) * 10000) / 100 : 0,
      cumulativeCashFlow: Math.round(cumulativeCashFlow),
      endingLoanBalance: Math.round(amort.endingBalance),
      propertyValue: Math.round(propVal),
      exitProceedsNet: Math.round(exitNet),
      dscr: debtService > 0 ? Math.round((noi / debtService) * 100) / 100 : 'N/A',
    });
  }

  const p0 = projections[0] || {};
  const y1Noi = p0.netOperatingIncome || 0;
  const y1Cf = p0.cashFlow || 0;
  const irr = calculateIRR(cashFlowsForIRR);
  const npv = calculateNPV(discountRate, cashFlowsForIRR);

  let totalReturned = 0;
  for (let i = 1; i < cashFlowsForIRR.length; i++) {
    totalReturned += cashFlowsForIRR[i];
  }
  const equityMultiplier = equity > 0 ? Math.round((totalReturned / equity) * 100) / 100 : 1.0;

  return {
    purchasePrice: price,
    initialEquity: Math.round(equity),
    loanAmount: Math.round(loanAmt),
    ltv: price > 0 ? Math.round((loanAmt / price) * 100) : 0,
    noi: Math.round(y1Noi),
    capRate: price > 0 ? Math.round((y1Noi / price) * 10000) / 100 : 0,
    year1Cashflow: Math.round(y1Cf),
    cashOnCash: equity > 0 ? Math.round((y1Cf / equity) * 10000) / 100 : 0,
    irr: isNaN(irr) ? 0 : irr,
    equityMultiplier,
    npv,
    dscr: p0.dscr || 'N/A',
    projections,
    amortizationSchedule: amortSchedule,
  };
}
