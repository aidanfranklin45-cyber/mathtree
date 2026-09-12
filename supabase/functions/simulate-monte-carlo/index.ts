// simulate-monte-carlo/index.ts
// Institutional Stochastic Market Volatility & Monte Carlo Simulation Engine for MathTree
// Powered by Unified Multi-Asset Pro-Forma Engine (Single-Family, Multi-Unit, Commercial, Storage)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function randomGaussian(mean: number, stdDev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

// -------------------------------------------------------------------------
// 1. UNIFIED FINANCIAL ENGINE (Standardized from math.js)
// -------------------------------------------------------------------------

function calculateMonthlyPayment(loanAmount: number, annualRate: number, termYears: number): number {
  if (loanAmount <= 0 || termYears <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loanAmount / n;
  return loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function calculateRemainingBalance(loanAmount: number, annualRate: number, termYears: number, elapsedYears: number): number {
  if (loanAmount <= 0) return 0;
  if (elapsedYears >= termYears) return 0;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  const p = elapsedYears * 12;
  if (r === 0) return loanAmount * (1 - p / n);
  const monthlyPayment = calculateMonthlyPayment(loanAmount, annualRate, termYears);
  return loanAmount * Math.pow(1 + r, p) - (monthlyPayment * (Math.pow(1 + r, p) - 1) / r);
}

function getAnnualAmortization(loanAmount: number, annualRate: number, termYears: number, options: any = {}): any[] {
  const schedule: any[] = [];
  const finType = String(options.financingType || 'fixed').toLowerCase();
  const armInitial = parseInt(options.armInitialYears || 5, 10);
  const armAdjRate = options.armAdjustmentRate !== undefined ? parseFloat(options.armAdjustmentRate) : (annualRate + 1.5);
  const armCap = options.armRateCap !== undefined ? parseFloat(options.armRateCap) : (annualRate + 4.0);
  const ioYears = parseInt(options.interestOnlyYears !== undefined ? options.interestOnlyYears : (finType === 'interest_only' ? 3 : 0), 10);
  const holdYears = parseInt(options.holdingPeriod || options.exitYear || 10, 10);
  const maxYears = Math.max(1, Math.min(30, isNaN(holdYears) ? 10 : holdYears));

  if (loanAmount <= 0 || termYears <= 0) {
    for (let year = 1; year <= maxYears; year++) {
      schedule.push({
        year,
        appliedRate: annualRate,
        isInterestOnly: false,
        beginningBalance: 0,
        totalPayment: 0,
        principalPaid: 0,
        interestPaid: 0,
        endingBalance: 0,
        cumulativePrincipalPaid: 0
      });
    }
    return schedule;
  }

  let currentBalance = loanAmount;
  let cumulativePrincipal = 0;

  for (let year = 1; year <= maxYears; year++) {
    const startBalance = currentBalance;
    let principalPaidThisYear = 0;
    let interestPaidThisYear = 0;
    let totalPaymentThisYear = 0;

    if (currentBalance <= 0 || year > termYears) {
      schedule.push({
        year,
        appliedRate: annualRate,
        isInterestOnly: false,
        beginningBalance: 0,
        totalPayment: 0,
        principalPaid: 0,
        interestPaid: 0,
        endingBalance: 0,
        cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100
      });
      continue;
    }

    let yearRate = annualRate;
    if (finType === 'arm' && year > armInitial) {
      yearRate = Math.min(armCap, Math.max(0, armAdjRate));
    }

    const isInterestOnly = (finType === 'interest_only' || finType === 'bridge') && year <= ioYears;
    const r = yearRate / 100 / 12;

    if (isInterestOnly) {
      const monthlyInterest = currentBalance * r;
      interestPaidThisYear = monthlyInterest * 12;
      principalPaidThisYear = 0;
      totalPaymentThisYear = interestPaidThisYear;
    } else {
      let remainingYearsForPayment = termYears - (year - 1);
      if (finType === 'interest_only') {
        remainingYearsForPayment = Math.max(1, (termYears - ioYears) - (year - ioYears - 1));
      }
      if (remainingYearsForPayment < 1) remainingYearsForPayment = 1;

      const monthlyPayment = calculateMonthlyPayment(currentBalance, yearRate, remainingYearsForPayment);

      for (let month = 1; month <= 12; month++) {
        let interestDue = currentBalance * r;
        let principalDue = monthlyPayment - interestDue;
        if (r === 0) {
          interestDue = 0;
          principalDue = monthlyPayment;
        }
        if (currentBalance < principalDue) principalDue = currentBalance;
        totalPaymentThisYear += principalDue + interestDue;
        interestPaidThisYear += interestDue;
        principalPaidThisYear += principalDue;
        currentBalance -= principalDue;
        if (currentBalance <= 0) break;
      }
    }

    cumulativePrincipal += principalPaidThisYear;

    schedule.push({
      year,
      appliedRate: Math.round(yearRate * 100) / 100,
      isInterestOnly,
      beginningBalance: Math.round(startBalance * 100) / 100,
      totalPayment: Math.round(totalPaymentThisYear * 100) / 100,
      principalPaid: Math.round(principalPaidThisYear * 100) / 100,
      interestPaid: Math.round(interestPaidThisYear * 100) / 100,
      endingBalance: Math.max(0, Math.round(currentBalance * 100) / 100),
      cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100
    });
  }

  return schedule;
}

function calculateIRR(initialCash: number, cashFlows: number[]): number {
  if (initialCash <= 0) return 0;

  function getNPV(rate: number): number {
    let sum = -initialCash;
    for (let i = 0; i < cashFlows.length; i++) {
      sum += cashFlows[i] / Math.pow(1 + rate, i + 1);
    }
    return sum;
  }

  let low = -0.99;
  let high = 5.0;

  let iterations = 0;
  while (getNPV(high) > 0 && iterations < 80) {
    high *= 2;
    iterations++;
  }

  iterations = 0;
  while (getNPV(low) < 0 && low > -0.999 && iterations < 80) {
    low = (low - 1) / 2;
    iterations++;
  }

  if (getNPV(low) * getNPV(high) > 0) {
    if (getNPV(low) < 0 && getNPV(high) < 0) return -100;
    if (getNPV(low) > 0 && getNPV(high) > 0) return Math.round(high * 10000) / 100;
    return 0;
  }

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    const npvVal = getNPV(mid);
    if (Math.abs(npvVal) < 1e-4) return Math.round(mid * 10000) / 100;
    if (npvVal > 0) low = mid;
    else high = mid;
  }

  return Math.round(((low + high) / 2) * 10000) / 100;
}

function runDealProjections(assetType: string, inputs: any): { irr: number; cashFlows: number[]; initialCash: number } {
  const purchasePrice = parseFloat(inputs.purchasePrice || inputs.price) || 0;
  const downPaymentPercent = parseFloat(inputs.downPaymentPercent) || 0;
  const interestRate = parseFloat(inputs.interestRate) || 0;
  const loanTerm = parseInt(inputs.loanTerm || inputs.loanTermYears) || 30;
  const rehabCosts = parseFloat(inputs.rehabCosts) || 0;
  const closingCosts = parseFloat(inputs.closingCosts) || 0;
  const appreciationRate = parseFloat(inputs.appreciationRate) || 0;
  const vacancyRate = parseFloat(inputs.vacancyRate) || 0;
  const rentGrowth = parseFloat(inputs.rentGrowth) || 0;
  const expenseRatio = parseFloat(inputs.expenseRatio || inputs.operatingExpenseRatio) || 0;
  const targetCapRate = parseFloat(inputs.targetCapRate || inputs.targetExitCapRate || inputs.exitCapRate || inputs.appreciationRate) || 0;
  const exitYear = Math.max(1, Math.min(30, parseInt(inputs.exitYear || inputs.holdingPeriod || 10, 10)));

  let initialPropertyValue = purchasePrice;
  let year1GrossIncome = 0;
  let unitCount = 1;

  switch (assetType) {
    case 'single-family': {
      const arv = parseFloat(inputs.arv) || 0;
      initialPropertyValue = arv > 0 ? arv : purchasePrice;
      let sfRent = parseFloat(inputs.monthlyRent) || parseFloat(inputs.grossRentPerMonth) || parseFloat(inputs.rent) || (parseFloat(inputs.grossRentAnnual) ? parseFloat(inputs.grossRentAnnual) / 12 : 0) || 0;
      if (sfRent === 0 && Array.isArray(inputs.leases) && inputs.leases.length > 0) {
        sfRent = parseFloat(inputs.leases[0].monthlyRent || inputs.leases[0].contractRent || inputs.leases[0].rent || inputs.leases[0].amount) || 0;
      }
      year1GrossIncome = sfRent * 12;
      unitCount = 1;
      break;
    }
    case 'multi-unit': {
      unitCount = parseInt(inputs.unitCount || inputs.numUnits) || 1;
      let explicitMonthly = parseFloat(inputs.grossRentPerMonth) || parseFloat(inputs.monthlyRent) || (parseFloat(inputs.grossRentAnnual) ? parseFloat(inputs.grossRentAnnual) / 12 : 0) || 0;
      if (explicitMonthly === 0 && Array.isArray(inputs.leases) && inputs.leases.length > 0) {
        explicitMonthly = inputs.leases.reduce((sum: number, l: any) => sum + (parseFloat(l.monthlyRent || l.contractRent || l.rent || l.amount) || 0), 0);
      }
      let muRent = parseFloat(inputs.monthlyRentPerUnit || inputs.rentPerUnit) || 0;
      if (explicitMonthly > 0 && unitCount > 0 && (!muRent || Math.abs((unitCount * muRent) - explicitMonthly) > 1)) {
        muRent = explicitMonthly / unitCount;
      }
      year1GrossIncome = (muRent > 0 ? unitCount * muRent : explicitMonthly) * 12;
      break;
    }
    case 'commercial': {
      let commAnnualRent = parseFloat(inputs.grossRentAnnual) || (parseFloat(inputs.grossRentPerMonth) ? parseFloat(inputs.grossRentPerMonth) * 12 : 0) || (parseFloat(inputs.monthlyRent) ? parseFloat(inputs.monthlyRent) * 12 : 0) || 0;
      if (commAnnualRent === 0 && Array.isArray(inputs.leases) && inputs.leases.length > 0) {
        commAnnualRent = inputs.leases.reduce((sum: number, l: any) => {
          const mRent = parseFloat(l.monthlyRent || l.contractRent || l.rent || l.amount) || 0;
          return sum + (mRent * 12);
        }, 0);
      }
      year1GrossIncome = commAnnualRent;
      unitCount = 1;
      break;
    }
    case 'storage': {
      unitCount = parseInt(inputs.unitCount || inputs.storageUnitCount) || 0;
      const storageRent = parseFloat(inputs.monthlyRentPerUnit || inputs.storageRentPerUnit) || 0;
      const totalSqFt = parseFloat(inputs.totalSqFt || inputs.storageSqFt || inputs.gla) || 0;
      const rentPerSqFt = parseFloat(inputs.rentPerSqFt || inputs.storageRentPerSqFt) || 0;
      const explicitMonthly = parseFloat(inputs.grossRentPerMonth || inputs.monthlyRent) || (parseFloat(inputs.grossRentAnnual) ? parseFloat(inputs.grossRentAnnual) / 12 : 0);

      if (explicitMonthly > 0) {
        year1GrossIncome = explicitMonthly * 12;
      } else if (storageRent > 0) {
        year1GrossIncome = (unitCount || 1) * storageRent * 12;
      } else if (totalSqFt > 0 && rentPerSqFt > 0) {
        year1GrossIncome = totalSqFt * rentPerSqFt * 12;
      }
      break;
    }
    default: {
      const fallbackRent = parseFloat(inputs.monthlyRent || inputs.rent) || (purchasePrice * 0.008);
      year1GrossIncome = fallbackRent * 12;
      break;
    }
  }

  // Debt & Initial Equity
  let loanAmount = 0;
  let downPaymentAmount = 0;
  if (inputs.loanAmount !== undefined && !isNaN(parseFloat(inputs.loanAmount))) {
    loanAmount = Math.max(0, parseFloat(inputs.loanAmount));
    downPaymentAmount = Math.max(0, purchasePrice - loanAmount);
  } else {
    downPaymentAmount = purchasePrice * (downPaymentPercent / 100);
    loanAmount = Math.max(0, purchasePrice - downPaymentAmount);
  }

  const initialCashInvested = downPaymentAmount + rehabCosts + closingCosts;
  const amortSchedule = getAnnualAmortization(loanAmount, interestRate, loanTerm, {
    holdingPeriod: exitYear,
    financingType: inputs.financingType || 'fixed'
  });

  let currentPropertyValue = initialPropertyValue;
  let currentGrossIncome = year1GrossIncome;
  let entryCapRate = targetCapRate;

  const cashFlows: number[] = [];

  for (let year = 1; year <= exitYear; year++) {
    if (year > 1) {
      currentGrossIncome *= (1 + rentGrowth / 100);
      if (assetType !== 'commercial' && assetType !== 'storage') {
        currentPropertyValue *= (1 + appreciationRate / 100);
      }
    }

    let appliedVacancy = vacancyRate;
    if (assetType === 'multi-unit') appliedVacancy = Math.max(5, vacancyRate);
    else if (assetType === 'storage') appliedVacancy = vacancyRate + 5;

    const vacancyLoss = currentGrossIncome * (appliedVacancy / 100);
    const egi = currentGrossIncome - vacancyLoss;

    let operatingExpenses = currentGrossIncome * (expenseRatio / 100);
    let capexReserve = 0;

    if (assetType === 'single-family') {
      const maintenance = currentPropertyValue * 0.01;
      const mgmt = inputs.manageProperty ? currentGrossIncome * 0.10 : 0;
      operatingExpenses += mgmt + maintenance;
      capexReserve = Math.max(500, currentGrossIncome * 0.08);
    } else if (assetType === 'multi-unit') {
      const mgmt = inputs.manageProperty ? currentGrossIncome * (unitCount <= 4 ? 0.09 : 0.05) : egi * 0.03;
      operatingExpenses += mgmt;
      capexReserve = unitCount * (unitCount <= 4 ? 500 : 300);
    } else if (assetType === 'commercial') {
      const mgmt = (String(inputs.leaseType || '').toUpperCase() !== 'NNN' && inputs.manageProperty) ? currentGrossIncome * 0.035 : 0;
      operatingExpenses += mgmt;
      const gla = parseFloat(inputs.gla) || 15000;
      capexReserve = gla * 1.50;
    } else if (assetType === 'storage') {
      const mgmt = inputs.manageProperty ? currentGrossIncome * 0.06 : 0;
      const payroll = currentGrossIncome * (inputs.isAutomated ? 0.04 : 0.13);
      operatingExpenses += mgmt + payroll;
      capexReserve = egi * 0.03;
    }

    const noi = egi - operatingExpenses;

    if (year === 1) {
      if (initialPropertyValue > 0 && noi > 0) entryCapRate = (noi / initialPropertyValue) * 100;
      else entryCapRate = targetCapRate;
    }

    // Commercial / Storage capitalization mechanism
    if (assetType === 'commercial' || assetType === 'storage') {
      if (year === 1) {
        currentPropertyValue = initialPropertyValue;
      } else {
        const tExit = exitYear > 1 ? exitYear : 10;
        const currentCap = targetCapRate > 0
          ? (entryCapRate + ((year - 1) / (tExit - 1)) * (targetCapRate - entryCapRate))
          : entryCapRate;
        if (currentCap > 0 && noi > 0) {
          currentPropertyValue = noi / (currentCap / 100);
        }
      }
    }

    const yearAmort = amortSchedule[year - 1] || {};
    const debtService = yearAmort.totalPayment || 0;
    let netCf = noi - debtService;

    const remainingBal = yearAmort.endingBalance !== undefined ? yearAmort.endingBalance : calculateRemainingBalance(loanAmount, interestRate, loanTerm, year);
    const terminalEquity = currentPropertyValue - remainingBal;

    if (year === exitYear) {
      netCf += terminalEquity;
    }

    cashFlows.push(netCf);
  }

  const irr = calculateIRR(initialCashInvested, cashFlows);
  return { irr, cashFlows, initialCash: initialCashInvested };
}

// -------------------------------------------------------------------------
// 2. SERVERLESS REQUEST HANDLER
// -------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const inputs = payload.inputs || {};
    const assetType = (payload.assetType || inputs.assetType || inputs.asset_class || 'single-family').toLowerCase();
    const runs = Math.min(Math.max(parseInt(payload.runs || '1000', 10), 100), 10000);

    const isCommercialOrStorage = assetType === 'commercial' || assetType === 'storage';

    const baseGrowth = inputs.rentGrowth !== undefined && !isNaN(parseFloat(inputs.rentGrowth)) ? parseFloat(inputs.rentGrowth) : 2.5;
    const baseVacancy = inputs.vacancyRate !== undefined && !isNaN(parseFloat(inputs.vacancyRate)) ? parseFloat(inputs.vacancyRate) : 5.0;
    const baseApprec = inputs.appreciationRate !== undefined && !isNaN(parseFloat(inputs.appreciationRate)) ? parseFloat(inputs.appreciationRate) : 3.0;
    const baseExitCap = (inputs.targetCapRate !== undefined && !isNaN(parseFloat(inputs.targetCapRate)))
      ? parseFloat(inputs.targetCapRate)
      : ((inputs.targetExitCapRate !== undefined && !isNaN(parseFloat(inputs.targetExitCapRate)))
        ? parseFloat(inputs.targetExitCapRate)
        : ((inputs.exitCapRate !== undefined && !isNaN(parseFloat(inputs.exitCapRate))) ? parseFloat(inputs.exitCapRate) : (isCommercialOrStorage ? 6.5 : 0)));

    const growthStdDev = parseFloat(payload.rentGrowthVolPct || 1.5);
    const vacancyStdDev = parseFloat(payload.vacancyVolPct || 2.5);
    const apprecStdDev = parseFloat(payload.apprecVolPct || 1.5);
    const exitCapSpreadPct = (parseFloat(payload.exitCapSpreadBps || 100) / 100);

    const unitCount = parseInt(inputs.unitCount || inputs.storageUnitCount || 0, 10);

    const irrResults: number[] = new Array(runs);
    let totalIrr = 0;
    let negativeIrrRuns = 0;
    let negativeCashFlowRuns = 0;

    for (let r = 0; r < runs; r++) {
      const sampledGrowth = randomGaussian(baseGrowth, growthStdDev);
      const sampledApprec = randomGaussian(baseApprec, apprecStdDev);
      const sampledExitCap = baseExitCap > 0 ? Math.max(3.0, randomGaussian(baseExitCap, exitCapSpreadPct)) : baseExitCap;

      // Asset-specific stochastic vacancy mechanics
      let sampledVacancy = baseVacancy;
      if (assetType === 'single-family') {
        // Single-Family 1-door discrete turnover model
        // Annual turnover chance scaled by baseline vacancy expectation (default ~22%)
        const turnoverChance = Math.min(0.60, Math.max(0.10, (baseVacancy / 5.0) * 0.22));
        if (Math.random() < turnoverChance) {
          const downtimeRoll = Math.random();
          if (downtimeRoll < 0.65) {
            // 1 month turnover (~8.33% annual vacancy)
            sampledVacancy = 8.33;
          } else if (downtimeRoll < 0.88) {
            // 2 months turnover (~16.67% annual vacancy)
            sampledVacancy = 16.67;
          } else {
            // Extended vacancy / eviction / major make-ready (3 to 6 months)
            sampledVacancy = 25.0 + Math.random() * 20.0;
          }
        } else {
          // Tenancy sustained: near-zero operational friction
          sampledVacancy = Math.max(0, randomGaussian(0.5, 0.4));
        }
      } else if (assetType === 'multi-unit') {
        // Multi-Unit portfolio diversification: variance dampens across door count
        const effectiveStdDev = vacancyStdDev / Math.sqrt(Math.max(1, (unitCount || 8) / 4));
        sampledVacancy = Math.max(1.0, Math.min(45.0, randomGaussian(baseVacancy, effectiveStdDev)));
      } else if (assetType === 'commercial') {
        // Commercial: multi-year lease stability with binary lease-roll tail risk
        const rollRiskRoll = Math.random();
        if (rollRiskRoll < 0.06) {
          // Key tenant rollover / renewal failure shock (6-12 months downtime)
          sampledVacancy = Math.min(60.0, 25.0 + Math.random() * 25.0);
        } else {
          sampledVacancy = Math.max(0.5, Math.min(30.0, randomGaussian(baseVacancy, vacancyStdDev * 0.75)));
        }
      } else if (assetType === 'storage') {
        // Storage: high turnover velocity, month-to-month elasticity
        sampledVacancy = Math.max(2.0, Math.min(45.0, randomGaussian(baseVacancy, vacancyStdDev * 1.15)));
      } else {
        sampledVacancy = Math.max(1.0, Math.min(45.0, randomGaussian(baseVacancy, vacancyStdDev)));
      }

      const simInputs = {
        ...inputs,
        rentGrowth: sampledGrowth,
        vacancyRate: sampledVacancy,
        appreciationRate: sampledApprec,
        targetCapRate: sampledExitCap,
        targetExitCapRate: sampledExitCap
      };

      const result = runDealProjections(assetType, simInputs);
      const runIrr = result.irr;
      irrResults[r] = runIrr;
      totalIrr += runIrr;

      if (runIrr < 0) negativeIrrRuns++;
      if (result.cashFlows[0] < 0) negativeCashFlowRuns++;
    }

    irrResults.sort((a, b) => a - b);

    const p5 = irrResults[Math.floor(runs * 0.05)];
    const p10 = irrResults[Math.floor(runs * 0.10)];
    const p25 = irrResults[Math.floor(runs * 0.25)];
    const p50 = irrResults[Math.floor(runs * 0.50)];
    const p75 = irrResults[Math.floor(runs * 0.75)];
    const p90 = irrResults[Math.floor(runs * 0.90)];
    const p95 = irrResults[Math.floor(runs * 0.95)];
    const minIrr = irrResults[0];
    const maxIrr = irrResults[runs - 1];
    const meanIrr = Math.round((totalIrr / runs) * 100) / 100;

    let sumSquares = 0;
    for (let i = 0; i < runs; i++) {
      sumSquares += Math.pow(irrResults[i] - meanIrr, 2);
    }
    const stdDev = Math.round(Math.sqrt(sumSquares / runs) * 100) / 100;
    const probNegativeIrr = Math.round((negativeIrrRuns / runs) * 1000) / 10;
    const probNegativeCashFlow = Math.round((negativeCashFlowRuns / runs) * 1000) / 10;

    // Advanced institutional risk indicators
    const skewnessIndex = Math.round(((meanIrr - p50) / (stdDev || 1)) * 100) / 100;
    const riskFreeRate = 4.25;
    const sharpeRatio = Math.round(((meanIrr - riskFreeRate) / (stdDev || 1)) * 100) / 100;

    let riskClassification = 'Balanced Core-Plus Risk';
    if (p5 > 25 && probNegativeCashFlow === 0) {
      riskClassification = 'High-Yield Outperformer / Strong Downside Buffer';
    } else if (p5 < 0) {
      riskClassification = 'High Leverage / Asymmetric Tail Risk Vulnerable';
    } else if (probNegativeCashFlow > 15) {
      riskClassification = 'Capital Call Vulnerable (Operating Cash Flow Risk)';
    }

    // 10-bin presentation histogram
    const bin10Count = 10;
    const bin10Width = Math.max(0.1, (maxIrr - minIrr) / bin10Count);
    const histogramBins: { label: string; binStart: number; binEnd: number; count: number }[] = [];

    for (let b = 0; b < bin10Count; b++) {
      const bStart = Math.round((minIrr + b * bin10Width) * 10) / 10;
      const bEnd = Math.round((minIrr + (b + 1) * bin10Width) * 10) / 10;
      histogramBins.push({
        label: `${bStart}% - ${bEnd}%`,
        binStart: bStart,
        binEnd: bEnd,
        count: 0
      });
    }

    for (let i = 0; i < runs; i++) {
      const val = irrResults[i];
      let idx = Math.floor((val - minIrr) / bin10Width);
      if (idx >= bin10Count) idx = bin10Count - 1;
      if (idx < 0) idx = 0;
      histogramBins[idx].count++;
    }

    // 20-bin granular histogram
    const binCount = 20;
    const binWidth = Math.max(0.1, (maxIrr - minIrr) / binCount);
    const histogram: { min: number; max: number; count: number; pct: number }[] = [];

    for (let b = 0; b < binCount; b++) {
      const bMin = Math.round((minIrr + b * binWidth) * 10) / 10;
      const bMax = Math.round((minIrr + (b + 1) * binWidth) * 10) / 10;
      histogram.push({ min: bMin, max: bMax, count: 0, pct: 0 });
    }

    for (let i = 0; i < runs; i++) {
      const val = irrResults[i];
      let binIdx = Math.floor((val - minIrr) / binWidth);
      if (binIdx >= binCount) binIdx = binCount - 1;
      if (binIdx < 0) binIdx = 0;
      histogram[binIdx].count++;
    }

    for (let b = 0; b < binCount; b++) {
      histogram[b].pct = Math.round((histogram[b].count / runs) * 1000) / 10;
    }

    return new Response(JSON.stringify({
      success: true,
      runs,
      assetType,
      engine: 'supabase-deno-edge',
      meanIrr,
      medianIrr: p50,
      p5Irr: p5,
      p95Irr: p95,
      probNegativeCashFlow,
      probNegativeIrr,
      skewnessIndex,
      sharpeRatio,
      riskClassification,
      histogramBins,
      telemetry: {
        baselineRentGrowth: baseGrowth,
        baselineVacancy: baseVacancy,
        baselineExitMetric: isCommercialOrStorage ? baseExitCap : baseApprec,
        exitMetricType: isCommercialOrStorage ? 'Exit Cap Rate' : 'Annual Appreciation',
        rentGrowthRange: [Math.round((baseGrowth - growthStdDev) * 10) / 10, Math.round((baseGrowth + growthStdDev) * 10) / 10],
        vacancyRange: assetType === 'single-family' ? [0.0, 25.0] : [Math.round(Math.max(0, baseVacancy - vacancyStdDev) * 10) / 10, Math.round((baseVacancy + vacancyStdDev) * 10) / 10],
        exitMetricRange: isCommercialOrStorage
          ? [Math.round(Math.max(1, baseExitCap - exitCapSpreadPct) * 100) / 100, Math.round((baseExitCap + exitCapSpreadPct) * 100) / 100]
          : [Math.round((baseApprec - apprecStdDev) * 10) / 10, Math.round((baseApprec + apprecStdDev) * 10) / 10]
      },
      summary: {
        p5,
        p10,
        p25,
        p50,
        p75,
        p90,
        p95,
        mean: meanIrr,
        stdDev,
        min: minIrr,
        max: maxIrr,
        probOfLossPct: probNegativeIrr,
        probNegativeCashFlowPct: probNegativeCashFlow,
        skewnessIndex,
        sharpeRatio,
        riskClassification
      },
      histogram
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
