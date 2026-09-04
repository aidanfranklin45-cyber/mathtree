// math-engine.ts - Robust institutional Deno computation engine for MathTree

export interface DealInputs {
  purchasePrice?: number | string;
  price?: number | string;
  downPaymentPercent?: number | string;
  downPayment?: number | string;
  down?: number | string;
  interestRate?: number | string;
  rate?: number | string;
  loanTerm?: number | string;
  loanTermYears?: number | string;
  amortizationYears?: number | string;
  amort?: number | string;
  rehabCosts?: number | string;
  rehabBudget?: number | string;
  rehab?: number | string;
  closingCosts?: number | string;
  closing?: number | string;
  appreciationRate?: number | string;
  apprec?: number | string;
  vacancyRate?: number | string;
  vacancy?: number | string;
  rentGrowth?: number | string;
  annualRentGrowth?: number | string;
  expenseRatio?: number | string;
  operatingExpenseRatio?: number | string;
  opexRatio?: number | string;
  targetCapRate?: number | string;
  targetExitCapRate?: number | string;
  exitCap?: number | string;
  exitYear?: number | string;
  discountRate?: number | string;
  otherIncome?: number | string;

  // Asset-specific
  monthlyRent?: number | string;
  grossRentPerMonth?: number | string;
  rent?: number | string;
  arv?: number | string;
  manageProperty?: boolean;

  unitCount?: number | string;
  numUnits?: number | string;
  monthlyRentPerUnit?: number | string;

  grossRentAnnual?: number | string;
  leaseType?: 'NNN' | 'Gross';
  gla?: number | string;

  isAutomated?: boolean;
  totalSqFt?: number | string;
  rentPerSqFt?: number | string;
  storageUnitCount?: number | string;
  totalStorageUnits?: number | string;
  storageRentPerUnit?: number | string;
  storageSqFt?: number | string;
  storageRentPerSqFt?: number | string;

  // Institutional Classification
  marketTier?: string;
  propertyClass?: string;
  facilityType?: string;
  commTier?: string;
  commClass?: string;
  storageTier?: string;
  storageClass?: string;
}

export interface ProjectionYear {
  year: number;
  propertyValue: number;
  grossPotentialIncome: number;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  debtService: number;
  cashFlow: number;
  netCashFlow: number;
  cumulativeCashFlow: number;
  cashOnCash: number;
  cashOnCashDisplay?: string;
  isCoCNotMeaningful?: boolean;
  capRate: number;
  loanBalanceRemaining: number;
  equity: number;
  dscr: number | null;
  ltv: number;
}

export interface ProjectionResults {
  purchasePrice: number;
  loanAmount: number;
  downPaymentAmount: number;
  initialCashInvested: number;
  initialEquity: number;
  annualDebtService: number;
  npv: number;
  irr: number;
  equityMultiplier: number;
  equityMultiplierDisplay?: string;
  irrDisplay?: string;
  isZeroEquity?: boolean;
  cashOnCashDisplay?: string;
  breakEvenYear: string | number;
  ltv: number;
  projections: ProjectionYear[];
}

export interface DealRisk {
  level: 'danger' | 'warning' | 'info' | 'safe' | 'success';
  title: string;
  description: string;
}

export function calculateMonthlyPayment(loanAmount: number, annualRate: number, loanTermYears: number): number {
  if (loanAmount <= 0 || loanTermYears <= 0) return 0;
  if (annualRate <= 0) return loanAmount / (loanTermYears * 12);
  const monthlyRate = annualRate / 100 / 12;
  const totalPayments = loanTermYears * 12;
  const growthFactor = Math.pow(1 + monthlyRate, totalPayments);
  if (!isFinite(growthFactor) || growthFactor <= 1) return loanAmount / totalPayments;
  return loanAmount * (monthlyRate * growthFactor) / (growthFactor - 1);
}

export function calculateRemainingBalance(
  loanAmount: number,
  annualRate: number,
  loanTermYears: number,
  elapsedYears: number
): number {
  if (loanAmount <= 0 || elapsedYears >= loanTermYears) return 0;
  if (annualRate <= 0) {
    const principalPaid = (loanAmount / loanTermYears) * elapsedYears;
    return Math.max(0, loanAmount - principalPaid);
  }
  const monthlyRate = annualRate / 100 / 12;
  const totalPayments = loanTermYears * 12;
  const elapsedPayments = elapsedYears * 12;
  const numerator = Math.pow(1 + monthlyRate, totalPayments) - Math.pow(1 + monthlyRate, elapsedPayments);
  const denominator = Math.pow(1 + monthlyRate, totalPayments) - 1;
  if (denominator === 0 || !isFinite(numerator) || !isFinite(denominator)) return 0;
  return Math.max(0, loanAmount * (numerator / denominator));
}

export function calculateIRR(initialInvestment: number, cashFlows: number[]): number {
  if (initialInvestment <= 0 || cashFlows.length === 0) return 0;

  const totalInflows = cashFlows.reduce((sum, cf) => sum + Math.max(0, cf), 0);
  if (totalInflows <= 0) return -100;

  function getNPV(rate: number): number {
    let sum = -initialInvestment;
    for (let t = 0; t < cashFlows.length; t++) {
      sum += cashFlows[t] / Math.pow(1 + rate, t + 1);
    }
    return sum;
  }

  let low = -0.99;
  let high = 2.0;

  let iterations = 0;
  while (getNPV(high) > 0 && iterations < 50 && high < 50) {
    high *= 2;
    iterations++;
  }

  if (getNPV(low) <= 0) return -100;
  if (getNPV(high) >= 0) return Math.min(500, Math.round(high * 10000) / 100);

  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const npv = getNPV(mid);
    if (Math.abs(npv) < 1e-4) {
      const res = mid * 100;
      return isNaN(res) || !isFinite(res) ? 0 : Math.round(res * 100) / 100;
    }
    if (npv > 0) low = mid;
    else high = mid;
  }

  const finalRate = ((low + high) / 2) * 100;
  return isNaN(finalRate) || !isFinite(finalRate) ? 0 : Math.max(-100, Math.min(500, Math.round(finalRate * 100) / 100));
}

export function calculateProjections(assetType: string, inputs: DealInputs): ProjectionResults {
  const normalizedAsset = String(assetType || 'single-family').toLowerCase();

  // Common inputs parsing with resilient alias resolution
  const purchasePrice = Math.max(0, parseFloat(String(inputs.purchasePrice ?? inputs.price ?? 0)) || 0);
  const rawDownPct = inputs.downPaymentPercent ?? inputs.downPayment ?? inputs.down ?? 25;
  const downPaymentPercent = Math.max(0, Math.min(100, parseFloat(String(rawDownPct)) || 0));
  const interestRate = Math.max(0, parseFloat(String(inputs.interestRate ?? inputs.rate ?? 0)) || 0);

  const rawLoanTerm = inputs.loanTerm ?? inputs.loanTermYears ?? inputs.amortizationYears ?? inputs.amort ?? 30;
  const loanTerm = Math.max(0, parseInt(String(rawLoanTerm)) || 30);

  const rehabCosts = Math.max(0, parseFloat(String(inputs.rehabCosts ?? inputs.rehabBudget ?? inputs.rehab ?? 0)) || 0);
  const closingCosts = Math.max(0, parseFloat(String(inputs.closingCosts ?? inputs.closing ?? 0)) || 0);
  const appreciationRate = parseFloat(String(inputs.appreciationRate ?? inputs.apprec ?? 0)) || 0;
  const vacancyRate = Math.max(0, Math.min(100, parseFloat(String(inputs.vacancyRate ?? inputs.vacancy ?? 0)) || 0));
  const rentGrowth = parseFloat(String(inputs.rentGrowth ?? inputs.annualRentGrowth ?? 0)) || 0;
  const expenseRatio = Math.max(0, parseFloat(String(inputs.expenseRatio ?? inputs.operatingExpenseRatio ?? inputs.opexRatio ?? 0)) || 0);
  const targetCapRate = parseFloat(String(inputs.targetCapRate ?? inputs.targetExitCapRate ?? inputs.exitCap ?? appreciationRate)) || appreciationRate || 0;

  const rawExitYear = parseInt(String(inputs.exitYear));
  const exitYear = Math.max(1, Math.min(10, isNaN(rawExitYear) ? 10 : rawExitYear));
  const otherIncomeAnnual = Math.max(0, parseFloat(String(inputs.otherIncome ?? 0)) || 0) * 12;

  let initialPropertyValue = purchasePrice;
  let year1GrossIncome = 0;
  let unitCount = 1;

  switch (normalizedAsset) {
    case 'single-family': {
      const arv = Math.max(0, parseFloat(String(inputs.arv ?? 0)) || 0);
      initialPropertyValue = arv > 0 ? arv : purchasePrice;
      const sfRent = Math.max(0, parseFloat(String(inputs.monthlyRent ?? inputs.grossRentPerMonth ?? inputs.rent ?? 0)) || 0);
      year1GrossIncome = (sfRent * 12) + otherIncomeAnnual;
      break;
    }
    case 'multi-unit': {
      unitCount = Math.max(1, parseInt(String(inputs.unitCount ?? inputs.numUnits ?? 1)) || 1);
      const muRent = Math.max(0, parseFloat(String(inputs.monthlyRentPerUnit ?? 0)) || 0);
      const grossMonthly = Math.max(0, parseFloat(String(inputs.grossRentPerMonth ?? inputs.monthlyRent ?? inputs.rent ?? 0)) || 0);
      if (muRent > 0) {
        year1GrossIncome = (unitCount * muRent * 12) + otherIncomeAnnual;
      } else if (grossMonthly > 0) {
        year1GrossIncome = (grossMonthly * 12) + otherIncomeAnnual;
      }
      break;
    }
    case 'commercial': {
      const grossAnnual = Math.max(0, parseFloat(String(inputs.grossRentAnnual ?? 0)) || 0);
      const grossMonthly = Math.max(0, parseFloat(String(inputs.grossRentPerMonth ?? inputs.monthlyRent ?? inputs.rent ?? 0)) || 0);
      if (grossAnnual > 0) {
        year1GrossIncome = grossAnnual + otherIncomeAnnual;
      } else if (grossMonthly > 0) {
        year1GrossIncome = (grossMonthly * 12) + otherIncomeAnnual;
      }
      break;
    }
    case 'storage': {
      unitCount = Math.max(0, parseInt(String(inputs.unitCount ?? inputs.storageUnitCount ?? inputs.totalStorageUnits ?? 0)) || 0);
      const sRent = Math.max(0, parseFloat(String(inputs.monthlyRentPerUnit ?? inputs.storageRentPerUnit ?? 0)) || 0);
      const sqFt = Math.max(0, parseFloat(String(inputs.totalSqFt ?? inputs.storageSqFt ?? inputs.gla ?? 0)) || 0);
      const rentSqFt = Math.max(0, parseFloat(String(inputs.rentPerSqFt ?? inputs.storageRentPerSqFt ?? 0)) || 0);
      const grossMonthly = Math.max(0, parseFloat(String(inputs.grossRentPerMonth ?? inputs.monthlyRent ?? inputs.rent ?? 0)) || 0);

      if (sRent > 0 && unitCount > 0) {
        year1GrossIncome = (unitCount * sRent * 12) + otherIncomeAnnual;
      } else if (sqFt > 0 && rentSqFt > 0) {
        year1GrossIncome = (sqFt * rentSqFt * 12) + otherIncomeAnnual;
      } else if (grossMonthly > 0) {
        year1GrossIncome = (grossMonthly * 12) + otherIncomeAnnual;
      }
      break;
    }
    default: {
      const defaultRent = Math.max(0, parseFloat(String(inputs.monthlyRent ?? inputs.grossRentPerMonth ?? inputs.rent ?? 0)) || 0);
      year1GrossIncome = (defaultRent * 12) + otherIncomeAnnual;
      break;
    }
  }

  const downPaymentAmount = purchasePrice * (downPaymentPercent / 100);
  const loanAmount = Math.max(0, purchasePrice - downPaymentAmount);
  const initialCashInvested = downPaymentAmount + rehabCosts + closingCosts;
  const initialEquity = initialPropertyValue - loanAmount;

  const monthlyPayment = calculateMonthlyPayment(loanAmount, interestRate, loanTerm);
  const annualDebtService = monthlyPayment * 12;

  const projections: ProjectionYear[] = [];
  let currentPropertyValue = initialPropertyValue;
  let currentGrossIncome = year1GrossIncome;
  let cumulativeCashInvested = initialCashInvested;
  let cumulativeCashFlow = 0;
  let entryCapRate = targetCapRate;

  for (let year = 1; year <= 10; year++) {
    if (year > 1) {
      currentGrossIncome *= (1 + rentGrowth / 100);
      if (normalizedAsset !== 'commercial' && normalizedAsset !== 'storage') {
        currentPropertyValue *= (1 + appreciationRate / 100);
      }
    }

    let appliedVacancyRate = vacancyRate;
    if (normalizedAsset === 'multi-unit') appliedVacancyRate = Math.max(5, vacancyRate);
    else if (normalizedAsset === 'storage') appliedVacancyRate = vacancyRate + 5;
    const vacancyLoss = currentGrossIncome * (appliedVacancyRate / 100);
    const effectiveGrossIncome = currentGrossIncome - vacancyLoss;

    let operatingExpenses = 0;
    if (normalizedAsset === 'single-family') {
      const routineMaintenance = currentPropertyValue * 0.01;
      const turnover = (currentGrossIncome / 12) * 0.5 * (vacancyRate / 100 * 12);
      const mgmt = inputs.manageProperty ? currentGrossIncome * 0.10 : 0;
      operatingExpenses = (currentGrossIncome * (expenseRatio / 100)) + mgmt + routineMaintenance + turnover;
    } else if (normalizedAsset === 'multi-unit') {
      const mgmt = inputs.manageProperty ? currentGrossIncome * (unitCount <= 4 ? 0.09 : 0.05) : effectiveGrossIncome * 0.03;
      operatingExpenses = (currentGrossIncome * (expenseRatio / 100)) + mgmt;
    } else if (normalizedAsset === 'commercial') {
      const mgmt = inputs.leaseType === 'NNN' ? 0 : (inputs.manageProperty ? currentGrossIncome * 0.035 : 0);
      operatingExpenses = (currentGrossIncome * (expenseRatio / 100)) + mgmt;
    } else if (normalizedAsset === 'storage') {
      const mgmt = inputs.manageProperty ? currentGrossIncome * 0.06 : 0;
      const overhead = inputs.isAutomated ? 0.04 : 0.13;
      operatingExpenses = (currentGrossIncome * (expenseRatio / 100)) + mgmt + (currentGrossIncome * overhead);
    } else {
      operatingExpenses = currentGrossIncome * (expenseRatio / 100);
    }

    const netOperatingIncome = effectiveGrossIncome - operatingExpenses;
    if (year === 1) {
      entryCapRate = (initialPropertyValue > 0 && netOperatingIncome > 0)
        ? (netOperatingIncome / initialPropertyValue) * 100
        : targetCapRate;
    }

    if (normalizedAsset === 'commercial' || normalizedAsset === 'storage') {
      if (year === 1) currentPropertyValue = initialPropertyValue;
      else {
        const tExit = exitYear > 1 ? exitYear : 10;
        const currentCapRate = year <= tExit
          ? entryCapRate + ((year - 1) / (tExit - 1)) * (targetCapRate - entryCapRate)
          : targetCapRate;
        currentPropertyValue = (currentCapRate > 0 && netOperatingIncome > 0)
          ? (netOperatingIncome / (currentCapRate / 100))
          : initialPropertyValue;
      }
    }

    const currentDebtService = year <= loanTerm ? annualDebtService : 0;
    const cashFlow = netOperatingIncome - currentDebtService;

    if (cashFlow < 0) {
      cumulativeCashInvested += Math.abs(cashFlow);
    }
    cumulativeCashFlow += cashFlow;

    const isZeroInitialCash = cumulativeCashInvested <= 0;
    const isCoCNotMeaningful = isZeroInitialCash && cashFlow > 0;
    const cashOnCash = cumulativeCashInvested > 0 ? (cashFlow / cumulativeCashInvested) * 100 : 0;
    const cashOnCashDisplay = isCoCNotMeaningful ? 'N/M' : `${(Math.round(cashOnCash * 100) / 100).toFixed(2)}%`;
    const capRate = currentPropertyValue > 0 ? (netOperatingIncome / currentPropertyValue) * 100 : 0;
    const remainingLoan = calculateRemainingBalance(loanAmount, interestRate, loanTerm, year);
    const equity = currentPropertyValue - remainingLoan;
    const dscr = currentDebtService > 0 ? (netOperatingIncome / currentDebtService) : null;
    const ltv = currentPropertyValue > 0 ? (remainingLoan / currentPropertyValue) * 100 : 0;

    projections.push({
      year,
      propertyValue: Math.round(currentPropertyValue * 100) / 100,
      grossPotentialIncome: Math.round(currentGrossIncome * 100) / 100,
      vacancyLoss: Math.round(vacancyLoss * 100) / 100,
      effectiveGrossIncome: Math.round(effectiveGrossIncome * 100) / 100,
      operatingExpenses: Math.round(operatingExpenses * 100) / 100,
      netOperatingIncome: Math.round(netOperatingIncome * 100) / 100,
      debtService: Math.round(currentDebtService * 100) / 100,
      cashFlow: Math.round(cashFlow * 100) / 100,
      netCashFlow: Math.round(cashFlow * 100) / 100,
      cumulativeCashFlow: Math.round(cumulativeCashFlow * 100) / 100,
      cashOnCash: Math.round(cashOnCash * 100) / 100,
      cashOnCashDisplay,
      isCoCNotMeaningful,
      capRate: Math.round(capRate * 100) / 100,
      loanBalanceRemaining: Math.round(remainingLoan * 100) / 100,
      equity: Math.round(equity * 100) / 100,
      dscr: dscr !== null ? Math.round(dscr * 100) / 100 : null,
      ltv: Math.round(ltv * 100) / 100
    });
  }

  const discountRate = isNaN(parseFloat(String(inputs.discountRate))) ? 8 : parseFloat(String(inputs.discountRate));
  let npv = -initialCashInvested;
  const irrFlows: number[] = [];
  let totalReturned = 0;
  let totalInvested = initialCashInvested;

  for (let t = 1; t <= exitYear; t++) {
    let cf = projections[t - 1].cashFlow;
    if (cf < 0) totalInvested += Math.abs(cf);
    else totalReturned += cf;

    if (t === exitYear) {
      cf += projections[t - 1].equity;
      totalReturned += projections[t - 1].equity;
    }
    npv += cf / Math.pow(1 + discountRate / 100, t);
    irrFlows.push(cf);
  }

  const irr = calculateIRR(initialCashInvested, irrFlows);
  const equityMultiplier = totalInvested > 0 ? (totalReturned / totalInvested) : 0;

  let cumulativeCash = -initialCashInvested;
  let breakEvenYear: string | number = 'N/A';
  for (let t = 1; t <= projections.length; t++) {
    cumulativeCash += projections[t - 1].cashFlow;
    if (cumulativeCash >= 0) {
      breakEvenYear = t;
      break;
    }
  }

  return {
    purchasePrice: Math.round(purchasePrice * 100) / 100,
    loanAmount: Math.round(loanAmount * 100) / 100,
    downPaymentAmount: Math.round(downPaymentAmount * 100) / 100,
    initialCashInvested: Math.round(initialCashInvested * 100) / 100,
    initialEquity: Math.round(initialEquity * 100) / 100,
    annualDebtService: Math.round(annualDebtService * 100) / 100,
    npv: Math.round(npv * 100) / 100,
    irr: Math.round(irr * 100) / 100,
    equityMultiplier: Math.round(equityMultiplier * 100) / 100,
    breakEvenYear,
    ltv: purchasePrice > 0 ? Math.round((loanAmount / purchasePrice) * 10000) / 100 : 0,
    isZeroEquity: initialCashInvested <= 0 && purchasePrice > 0,
    irrDisplay: (initialCashInvested <= 0 && purchasePrice > 0) ? 'N/M (100% Financed)' : `${(Math.round(irr * 100) / 100).toFixed(2)}%`,
    equityMultiplierDisplay: (initialCashInvested <= 0 && purchasePrice > 0) ? 'N/M (Zero Initial Outlay)' : `${(Math.round(equityMultiplier * 100) / 100).toFixed(2)}x`,
    cashOnCashDisplay: projections[0]?.cashOnCashDisplay ?? '0.00%',
    projections
  };
}

export function auditDealRisks(
  _assetType: string,
  _inputs: DealInputs,
  res: ProjectionResults
): DealRisk[] {
  const risks: DealRisk[] = [];
  if (!res || !res.projections || res.projections.length === 0) return risks;

  const y1 = res.projections[0];

  // 1. Multi-year DSCR Coverage check
  const dscrValues = res.projections.map(p => p.dscr).filter((d): d is number => d !== null);
  if (dscrValues.length > 0) {
    const minDscr = Math.min(...dscrValues);
    if (minDscr < 1.0) {
      risks.push({
        level: 'danger',
        title: `Critical Debt Service Risk (Min DSCR: ${minDscr.toFixed(2)}x)`,
        description: 'Net operating income fails to cover scheduled debt service, triggering negative leverage.'
      });
    } else if (minDscr < 1.15) {
      risks.push({
        level: 'danger',
        title: `Low Debt Coverage (Min DSCR: ${minDscr.toFixed(2)}x)`,
        description: 'Lenders typically require a minimum 1.20x - 1.25x DSCR for term debt.'
      });
    } else if (minDscr < 1.25) {
      risks.push({
        level: 'warning',
        title: `Tight Debt Coverage (Min DSCR: ${minDscr.toFixed(2)}x)`,
        description: 'Adequate but sensitive to minor vacancy spikes or unexpected maintenance.'
      });
    } else {
      risks.push({
        level: 'safe',
        title: `Healthy Debt Coverage (Min DSCR: ${minDscr.toFixed(2)}x)`,
        description: 'Strong cash flow margin protecting against mortgage default.'
      });
    }
  } else {
    risks.push({
      level: 'safe',
      title: 'Unlevered Acquisition (No Debt Risk)',
      description: '100% equity capitalization with zero mortgage default vulnerability.'
    });
  }

  // 2. Multi-year Cash Flow Check
  const negYears = res.projections.filter(p => p.cashFlow < 0).map(p => p.year);
  if (negYears.length > 0) {
    risks.push({
      level: 'danger',
      title: `Negative Cash Flow (Years: ${negYears.join(', ')})`,
      description: 'Property requires supplemental out-of-pocket operational cash injections.'
    });
  } else {
    risks.push({
      level: 'safe',
      title: 'Positive Operating Cash Flow',
      description: `Property self-funds debt service with $${(y1.cashFlow ?? 0).toLocaleString()} in net Year 1 cash flow.`
    });
  }

  // 3. Leverage Check
  if (res.ltv > 80) {
    risks.push({
      level: 'warning',
      title: `High Leverage (${res.ltv}% LTV)`,
      description: 'High initial debt increases vulnerability during market downturns.'
    });
  }

  // 4. Payback Horizon Check
  if (res.breakEvenYear === 'N/A' || (typeof res.breakEvenYear === 'number' && res.breakEvenYear > 6)) {
    risks.push({
      level: 'info',
      title: 'Extended Payback Horizon',
      description: `Cumulative cash-flow break-even is ${res.breakEvenYear === 'N/A' ? 'unreached within 10 years' : `Year ${res.breakEvenYear}`}.`
    });
  }

  // 5. Success confirmation if no warnings or dangers
  const hasIssues = risks.some(r => r.level === 'danger' || r.level === 'warning');
  if (!hasIssues) {
    risks.push({
      level: 'success',
      title: 'Robust Financial Profile',
      description: 'Deal passes core DSCR, positive cash flow, and leverage health benchmarks.'
    });
  }

  return risks;
}

export function getBenchmarkCapRateRange(assetType: string, marketTier: string = 'Tier2', propertyClass: string = 'ClassB', subType: string = ''): { min: number; max: number } {
  const tier = String(marketTier || 'Tier2').replace(/[^a-zA-Z0-9]/g, '');
  const pClass = String(propertyClass || 'ClassB').replace(/[^a-zA-Z0-9]/g, '');
  const sub = String(subType || '').toLowerCase();

  if (assetType === 'commercial') {
    const isIndustrial = sub.includes('industrial') || sub.includes('logistics') || sub.includes('warehouse');
    const isOffice = sub.includes('office') || sub.includes('medical');
    if (isIndustrial) {
      if (tier.includes('1')) return pClass.includes('A') ? { min: 4.75, max: 5.50 } : (pClass.includes('B') ? { min: 5.25, max: 6.00 } : { min: 6.00, max: 7.00 });
      if (tier.includes('2')) return pClass.includes('A') ? { min: 5.50, max: 6.25 } : (pClass.includes('B') ? { min: 6.00, max: 6.75 } : { min: 6.75, max: 7.75 });
      return pClass.includes('A') ? { min: 6.25, max: 7.00 } : (pClass.includes('B') ? { min: 6.75, max: 7.75 } : { min: 7.50, max: 8.75 });
    } else if (isOffice) {
      if (tier.includes('1')) return pClass.includes('A') ? { min: 6.25, max: 7.25 } : (pClass.includes('B') ? { min: 7.00, max: 8.00 } : { min: 8.00, max: 9.50 });
      if (tier.includes('2')) return pClass.includes('A') ? { min: 7.00, max: 8.00 } : (pClass.includes('B') ? { min: 7.75, max: 8.75 } : { min: 8.75, max: 10.00 });
      return pClass.includes('A') ? { min: 8.00, max: 9.00 } : (pClass.includes('B') ? { min: 8.75, max: 9.75 } : { min: 9.50, max: 11.00 });
    } else {
      if (tier.includes('1')) return pClass.includes('A') ? { min: 5.75, max: 6.50 } : (pClass.includes('B') ? { min: 6.25, max: 7.25 } : { min: 7.00, max: 8.25 });
      if (tier.includes('2')) return pClass.includes('A') ? { min: 6.50, max: 7.25 } : (pClass.includes('B') ? { min: 7.00, max: 8.00 } : { min: 7.75, max: 9.00 });
      return pClass.includes('A') ? { min: 7.25, max: 8.25 } : (pClass.includes('B') ? { min: 7.75, max: 8.75 } : { min: 8.50, max: 10.00 });
    }
  } else if (assetType === 'multi-unit') {
    if (tier.includes('1')) return pClass.includes('A') ? { min: 4.50, max: 5.25 } : (pClass.includes('B') ? { min: 5.00, max: 5.75 } : { min: 5.75, max: 6.50 });
    if (tier.includes('2')) return pClass.includes('A') ? { min: 5.00, max: 5.75 } : (pClass.includes('B') ? { min: 5.50, max: 6.50 } : { min: 6.25, max: 7.25 });
    return pClass.includes('A') ? { min: 5.75, max: 6.75 } : (pClass.includes('B') ? { min: 6.50, max: 7.50 } : { min: 7.25, max: 8.50 });
  } else if (assetType === 'storage') {
    if (tier.includes('1')) return pClass.includes('A') ? { min: 5.00, max: 5.75 } : (pClass.includes('B') ? { min: 5.50, max: 6.50 } : { min: 6.25, max: 7.25 });
    if (tier.includes('2')) return pClass.includes('A') ? { min: 5.75, max: 6.50 } : (pClass.includes('B') ? { min: 6.25, max: 7.25 } : { min: 7.00, max: 8.00 });
    return pClass.includes('A') ? { min: 6.75, max: 7.75 } : (pClass.includes('B') ? { min: 7.25, max: 8.25 } : { min: 7.75, max: 9.00 });
  } else {
    if (tier.includes('1')) return pClass.includes('A') ? { min: 4.50, max: 5.50 } : { min: 5.25, max: 6.50 };
    if (tier.includes('2')) return pClass.includes('A') ? { min: 5.25, max: 6.25 } : { min: 6.00, max: 7.25 };
    return pClass.includes('A') ? { min: 6.00, max: 7.25 } : { min: 7.00, max: 8.50 };
  }
}


export function calculateHoldingPeriodWealth(inputs: DealInputs, projections: ProjectionYear[], _schedule?: any[], holdYear: number = 1) {
  if (!projections || projections.length === 0) return null;
  const year = Math.max(1, Math.min(projections.length, parseInt(String(holdYear)) || 1));
  const yearIdx = year - 1;
  const proj = projections[yearIdx];
  const purchasePrice = parseFloat(String(inputs.purchasePrice ?? inputs.price ?? 0)) || 0;
  const downPaymentPercent = isNaN(parseFloat(String(inputs.downPaymentPercent ?? inputs.down ?? 25))) ? 25 : parseFloat(String(inputs.downPaymentPercent ?? inputs.down ?? 25));
  const downPaymentAmount = purchasePrice * (downPaymentPercent / 100);
  const rehabCosts = parseFloat(String(inputs.rehabCosts ?? inputs.rehab ?? 0)) || 0;
  const closingCosts = parseFloat(String(inputs.closingCosts ?? inputs.closing ?? 0)) || 0;
  const initialCashInvested = downPaymentAmount + rehabCosts + closingCosts;
  const initialLoan = Math.max(0, purchasePrice - downPaymentAmount);

  const currentPropertyValue = proj ? proj.propertyValue : purchasePrice;
  const remainingLoanBalance = proj ? proj.loanBalanceRemaining : initialLoan;

  const principalPaydownEquity = Math.max(0, initialLoan - remainingLoanBalance);
  const appreciationEquity = Math.max(0, currentPropertyValue - purchasePrice);
  const totalNetEquity = Math.max(0, currentPropertyValue - remainingLoanBalance);

  let cumulativeCashFlow = 0;
  for (let i = 0; i <= yearIdx; i++) {
    cumulativeCashFlow += (projections[i] ? projections[i].cashFlow : 0);
  }

  // 5. Total Net Wealth Position & Net Profit
  // Total Net Wealth = Net Owned Equity (NAV) + Cumulative Cash Flow
  const totalNetWealth = totalNetEquity + cumulativeCashFlow;
  const netProfit = totalNetWealth - initialCashInvested;
  const totalNetBenefit = totalNetWealth;

  const prevEquity = yearIdx === 0 ? initialCashInvested : (projections[yearIdx - 1] ? projections[yearIdx - 1].equity : 0);
  const currentCashFlow = proj ? proj.cashFlow : 0;
  let roe: number | null = null;
  let roeDisplay = 'N/M';
  if (prevEquity > 0) {
    roe = (currentCashFlow / prevEquity) * 100;
    roeDisplay = roe.toFixed(2) + '%';
  } else if (currentCashFlow > 0) {
    roeDisplay = 'N/M (100% Financed)';
  }

  const discountRate = isNaN(parseFloat(String(inputs.discountRate))) ? 8 : parseFloat(String(inputs.discountRate));
  let holdNpv = -initialCashInvested;
  for (let t = 1; t <= year; t++) {
    let cf = projections[t - 1] ? projections[t - 1].cashFlow : 0;
    if (t === year) {
      cf += (projections[t - 1] ? projections[t - 1].equity : 0);
    }
    holdNpv += cf / Math.pow(1 + discountRate / 100, t);
  }

  return {
    holdYear: year,
    propertyValue: Math.round(currentPropertyValue * 100) / 100,
    initialLoan: Math.round(initialLoan * 100) / 100,
    remainingLoanBalance: Math.round(remainingLoanBalance * 100) / 100,
    principalPaydownEquity: Math.round(principalPaydownEquity * 100) / 100,
    appreciationEquity: Math.round(appreciationEquity * 100) / 100,
    totalNetEquity: Math.round(totalNetEquity * 100) / 100,
    initialCashInvested: Math.round(initialCashInvested * 100) / 100,
    cumulativeCashFlow: Math.round(cumulativeCashFlow * 100) / 100,
    totalNetBenefit: Math.round(totalNetBenefit * 100) / 100,
    totalNetWealth: Math.round(totalNetWealth * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    currentCashFlow: Math.round(currentCashFlow * 100) / 100,
    roe: roe !== null ? Math.round(roe * 100) / 100 : null,
    roeDisplay,
    holdNpv: Math.round(holdNpv * 100) / 100
  };
}
