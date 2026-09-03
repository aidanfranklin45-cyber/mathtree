/**
 * Real Estate Financial Calculator and 10-Year Projector
 * Supports 4 presets: Single-Family, Multi-Unit, Commercial, and Storage.
 */

// Helper to compute monthly mortgage payment
function calculateMonthlyPayment(loanAmount, annualRate, termYears) {
  if (loanAmount <= 0 || termYears <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loanAmount / n;
  return loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Helper to compute remaining loan balance after t years
function calculateRemainingBalance(loanAmount, annualRate, termYears, elapsedYears) {
  if (loanAmount <= 0) return 0;
  if (elapsedYears >= termYears) return 0;
  
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  const p = elapsedYears * 12;
  
  if (r === 0) {
    return loanAmount * (1 - p / n);
  }
  
  const monthlyPayment = calculateMonthlyPayment(loanAmount, annualRate, termYears);
  return loanAmount * Math.pow(1 + r, p) - (monthlyPayment * (Math.pow(1 + r, p) - 1) / r);
}

// Helper to compute a 10-year annual amortization schedule
function getAnnualAmortization(loanAmount, annualRate, termYears) {
  const schedule = [];
  if (loanAmount <= 0 || termYears <= 0) {
    for (let year = 1; year <= 10; year++) {
      schedule.push({
        year,
        beginningBalance: 0,
        totalPayment: 0,
        principalPaid: 0,
        interestPaid: 0,
        endingBalance: 0
      });
    }
    return schedule;
  }

  let currentBalance = loanAmount;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  const monthlyPayment = calculateMonthlyPayment(loanAmount, annualRate, termYears);

  for (let year = 1; year <= 10; year++) {
    let principalPaidThisYear = 0;
    let interestPaidThisYear = 0;
    let totalPaymentThisYear = 0;
    const startBalance = currentBalance;

    for (let month = 1; month <= 12; month++) {
      const elapsedMonths = (year - 1) * 12 + month - 1;
      if (elapsedMonths >= n) {
        break;
      }
      
      let interestDue = currentBalance * r;
      let principalDue = monthlyPayment - interestDue;
      
      if (r === 0) {
        interestDue = 0;
        principalDue = monthlyPayment;
      }

      if (currentBalance < principalDue) {
        principalDue = currentBalance;
      }

      const actualPayment = principalDue + interestDue;
      totalPaymentThisYear += actualPayment;
      interestPaidThisYear += interestDue;
      principalPaidThisYear += principalDue;
      currentBalance -= principalDue;
    }

    schedule.push({
      year,
      beginningBalance: Math.round(startBalance * 100) / 100,
      totalPayment: Math.round(totalPaymentThisYear * 100) / 100,
      principalPaid: Math.round(principalPaidThisYear * 100) / 100,
      interestPaid: Math.round(interestPaidThisYear * 100) / 100,
      endingBalance: Math.max(0, Math.round(currentBalance * 100) / 100)
    });
  }
  return schedule;
}

// Helper to compute Internal Rate of Return (IRR) using bisection
function calculateIRR(initialCash, cashFlows) {
  if (initialCash <= 0) return 0;
  
  function getNPV(rate) {
    let sum = -initialCash;
    for (let i = 0; i < cashFlows.length; i++) {
      sum += cashFlows[i] / Math.pow(1 + rate, i + 1);
    }
    return sum;
  }
  
  let low = -0.99;
  let high = 1.0;
  
  let iterations = 0;
  while (getNPV(high) > 0 && iterations < 100) {
    high *= 2;
    iterations++;
  }
  
  iterations = 0;
  while (getNPV(low) < 0 && low > -0.999 && iterations < 100) {
    low = (low - 1) / 2;
    iterations++;
  }
  
  if (getNPV(low) * getNPV(high) > 0) {
    return 0;
  }
  
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const npvVal = getNPV(mid);
    if (Math.abs(npvVal) < 1e-4) {
      return mid * 100;
    }
    if (npvVal > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return ((low + high) / 2) * 100;
}

/**
 * Main calculate function that supports presets and returns standardized inputs and projections.
 * 
 * @param {string} assetType - 'single-family', 'multi-unit', 'commercial', 'storage'
 * @param {Object} inputs - User input values
 * @returns {Object} Standardized calculations and 10-year projection lines
 */
function calculateProjections(assetType, inputs) {
  // Common inputs parsing
  const purchasePrice = parseFloat(inputs.purchasePrice) || 0;
  const downPaymentPercent = parseFloat(inputs.downPaymentPercent) || 0;
  const interestRate = parseFloat(inputs.interestRate) || 0;
  const loanTerm = parseInt(inputs.loanTerm) || 0;
  const rehabCosts = parseFloat(inputs.rehabCosts) || 0;
  const closingCosts = parseFloat(inputs.closingCosts) || 0;
  const appreciationRate = parseFloat(inputs.appreciationRate) || 0;
  const vacancyRate = parseFloat(inputs.vacancyRate) || 0;
  const rentGrowth = parseFloat(inputs.rentGrowth) || 0;
  const expenseRatio = parseFloat(inputs.expenseRatio) || 0; // % of GPI or EGI (we will use GPI)
  const targetCapRate = parseFloat(inputs.targetCapRate) || parseFloat(inputs.appreciationRate) || 0;
  const rawExitYear = parseInt(inputs.exitYear);
  const exitYear = Math.max(1, Math.min(10, isNaN(rawExitYear) ? 10 : rawExitYear));

  // Asset-specific initializations
  let initialPropertyValue = purchasePrice;
  let year1GrossIncome = 0;
  let unitCount = 1;

  switch (assetType) {
    case 'single-family':
      // ARV (After Repair Value) serves as the property value after rehab
      const arv = parseFloat(inputs.arv) || 0;
      initialPropertyValue = arv > 0 ? arv : purchasePrice;
      const sfRent = parseFloat(inputs.monthlyRent) || 0;
      year1GrossIncome = sfRent * 12;
      unitCount = 1;
      break;

    case 'multi-unit':
      unitCount = parseInt(inputs.unitCount) || 1;
      const muRent = parseFloat(inputs.monthlyRentPerUnit) || 0;
      year1GrossIncome = unitCount * muRent * 12;
      break;

    case 'commercial':
      const commRent = parseFloat(inputs.grossRentAnnual) || 0;
      year1GrossIncome = commRent;
      unitCount = 1;
      break;

    case 'storage':
      unitCount = parseInt(inputs.unitCount) || parseInt(inputs.storageUnitCount) || 0;
      const storageRent = parseFloat(inputs.monthlyRentPerUnit) || parseFloat(inputs.storageRentPerUnit) || 0;
      const totalSqFt = parseFloat(inputs.totalSqFt) || parseFloat(inputs.storageSqFt) || 0;
      const rentPerSqFt = parseFloat(inputs.rentPerSqFt) || parseFloat(inputs.storageRentPerSqFt) || 0;
      if (storageRent > 0) {
        year1GrossIncome = unitCount * storageRent * 12;
      } else if (totalSqFt > 0 && rentPerSqFt > 0) {
        year1GrossIncome = totalSqFt * rentPerSqFt * 12;
      }
      break;
  }

  // Debt & Equity calculations
  const downPaymentAmount = purchasePrice * (downPaymentPercent / 100);
  const loanAmount = Math.max(0, purchasePrice - downPaymentAmount);
  const initialCashInvested = downPaymentAmount + rehabCosts + closingCosts;
  const initialEquity = initialPropertyValue - loanAmount;

  const monthlyPayment = calculateMonthlyPayment(loanAmount, interestRate, loanTerm);
  const annualDebtService = monthlyPayment * 12;

  const projections = [];
  let currentPropertyValue = initialPropertyValue;
  let currentGrossIncome = year1GrossIncome;
  let cumulativeCashInvested = initialCashInvested;
  let purchaseCapRate = 0;
  let entryCapRate = targetCapRate;

  for (let year = 1; year <= 10; year++) {
    // 1. Property Value appreciation & Rent growth
    if (year > 1) {
      currentGrossIncome = currentGrossIncome * (1 + rentGrowth / 100);
      if (assetType !== 'commercial' && assetType !== 'storage') {
        currentPropertyValue = currentPropertyValue * (1 + appreciationRate / 100);
      }
    }

    // 2. Vacancy loss
    let appliedVacancyRate = vacancyRate;
    let vacancyLoss = 0;
    
    if (assetType === 'multi-unit') {
      // Fannie Mae economic vacancy floor of 5%
      appliedVacancyRate = Math.max(5, vacancyRate);
      vacancyLoss = currentGrossIncome * (appliedVacancyRate / 100);
    } else if (assetType === 'storage') {
      // Concessions add 5% to the physical vacancy rate to get Economic Vacancy
      appliedVacancyRate = vacancyRate + 5;
      vacancyLoss = currentGrossIncome * (appliedVacancyRate / 100);
    } else {
      vacancyLoss = currentGrossIncome * (vacancyRate / 100);
    }
    
    const effectiveGrossIncome = currentGrossIncome - vacancyLoss;

    // 3. Operating Expenses & Capital Reserves
    let operatingExpenses = 0;
    let capexReserve = 0;

    if (assetType === 'single-family') {
      // Routine Maintenance (1% of current Value)
      const routineMaintenance = currentPropertyValue * 0.01;
      // Turnover leasing costs: 50% of 1 month's rent scaled by vacancy rate
      const monthlyRentAtYear = (currentGrossIncome / 12);
      const turnoverFriction = monthlyRentAtYear * 0.5 * (vacancyRate / 100 * 12);
      
      const managementFee = inputs.manageProperty ? currentGrossIncome * 0.10 : 0;
      
      operatingExpenses = (currentGrossIncome * (expenseRatio / 100)) + managementFee + routineMaintenance + turnoverFriction;
      
      // CapEx reserves: 8% of GSR with a $500/yr floor
      capexReserve = Math.max(500, currentGrossIncome * 0.08);
    } 
    else if (assetType === 'multi-unit') {
      // Management: 9% for small multi (<=4 units), 5% for large. Self-mgmt floor of 3% EGI
      let managementFee = 0;
      if (inputs.manageProperty) {
        managementFee = currentGrossIncome * (unitCount <= 4 ? 0.09 : 0.05);
      } else {
        managementFee = effectiveGrossIncome * 0.03;
      }
      
      operatingExpenses = (currentGrossIncome * (expenseRatio / 100)) + managementFee;
      
      // CapEx reserves: $500/unit (<=4) or $300/unit (>4)
      capexReserve = unitCount * (unitCount <= 4 ? 500 : 300);
    } 
    else if (assetType === 'commercial') {
      // Commercial: PM (3.5% for Gross Leases, passed through for NNN)
      if (inputs.leaseType === 'NNN') {
        operatingExpenses = currentGrossIncome * (expenseRatio / 100);
      } else {
        const managementFee = inputs.manageProperty ? currentGrossIncome * 0.035 : 0;
        operatingExpenses = (currentGrossIncome * (expenseRatio / 100)) + managementFee;
      }
      
      // TI / LC below-the-line reserves ($1.50 per sqft of GLA)
      const gla = parseFloat(inputs.gla) || 15000;
      capexReserve = gla * 1.50;
    } 
    else if (assetType === 'storage') {
      // Storage: PM (6%), Payroll & Marketing (13% manned, 4% automated)
      const managementFee = inputs.manageProperty ? currentGrossIncome * 0.06 : 0;
      const payrollMarketingRatio = inputs.isAutomated ? 0.04 : 0.13;
      
      operatingExpenses = (currentGrossIncome * (expenseRatio / 100)) + managementFee + (currentGrossIncome * payrollMarketingRatio);
      
      // CapEx reserves: 3% of Effective Gross Income (EGI)
      capexReserve = effectiveGrossIncome * 0.03;
    }

    // 4. Net Operating Income
    const netOperatingIncome = effectiveGrossIncome - operatingExpenses;

    if (year === 1) {
      if (initialPropertyValue > 0 && netOperatingIncome > 0) {
        entryCapRate = (netOperatingIncome / initialPropertyValue) * 100;
      } else {
        entryCapRate = targetCapRate;
      }
    }

    // Commercial and Storage valuation capitalization mechanism
    if (assetType === 'commercial' || assetType === 'storage') {
      if (year === 1) {
        currentPropertyValue = initialPropertyValue;
      } else {
        let currentCapRate = targetCapRate;
        if (targetCapRate > 0) {
          const tExit = exitYear > 1 ? exitYear : 10;
          if (year <= tExit) {
            currentCapRate = entryCapRate + ((year - 1) / (tExit - 1)) * (targetCapRate - entryCapRate);
          } else {
            currentCapRate = targetCapRate;
          }
        }
        if (currentCapRate > 0 && netOperatingIncome > 0) {
          currentPropertyValue = netOperatingIncome / (currentCapRate / 100);
        } else {
          currentPropertyValue = initialPropertyValue;
        }
      }
    }

    // 5. Debt Service
    const currentDebtService = year <= loanTerm ? annualDebtService : 0;

    // 6. Cash Flow (Net Operating Income minus Annual Debt Service)
    const cashFlow = netOperatingIncome - currentDebtService;

    // We track cash injections if cashFlow is negative:
    let cashInjection = 0;
    if (cashFlow < 0) {
      cashInjection = Math.abs(cashFlow);
      cumulativeCashInvested += cashInjection;
    }

    // 7. Cash-on-Cash Return
    const cashOnCash = cumulativeCashInvested > 0 ? (cashFlow / cumulativeCashInvested) * 100 : 0;

    // 8. Capitalization Rate
    const capRate = currentPropertyValue > 0 ? (netOperatingIncome / currentPropertyValue) * 100 : 0;

    // 9. Remaining Loan Balance
    const remainingLoanBalance = calculateRemainingBalance(loanAmount, interestRate, loanTerm, year);

    // 10. Equity
    const equity = currentPropertyValue - remainingLoanBalance;

    // 11. Debt Metrics
    const dscr = currentDebtService > 0 ? (netOperatingIncome / currentDebtService) : null;
    const debtYield = loanAmount > 0 ? (netOperatingIncome / loanAmount) * 100 : null;
    const ltv = currentPropertyValue > 0 ? (remainingLoanBalance / currentPropertyValue) * 100 : 0;

    projections.push({
      year,
      propertyValue: Math.round(currentPropertyValue * 100) / 100,
      grossPotentialIncome: Math.round(currentGrossIncome * 100) / 100,
      vacancyLoss: Math.round(vacancyLoss * 100) / 100,
      effectiveGrossIncome: Math.round(effectiveGrossIncome * 100) / 100,
      operatingExpenses: Math.round(operatingExpenses * 100) / 100,
      netOperatingIncome: Math.round(netOperatingIncome * 100) / 100,
      debtService: Math.round(currentDebtService * 100) / 100,
      capexReserve: Math.round(capexReserve * 100) / 100,
      cashFlow: Math.round(cashFlow * 100) / 100,
      cashInjection: Math.round(cashInjection * 100) / 100,
      cumulativeCashInvested: Math.round(cumulativeCashInvested * 100) / 100,
      cashOnCash: Math.round(cashOnCash * 100) / 100,
      capRate: Math.round(capRate * 100) / 100,
      loanBalanceRemaining: Math.round(remainingLoanBalance * 100) / 100,
      equity: Math.round(equity * 100) / 100,
      dscr: dscr !== null ? Math.round(dscr * 100) / 100 : null,
      debtYield: debtYield !== null ? Math.round(debtYield * 100) / 100 : null,
      ltv: Math.round(ltv * 100) / 100
    });
  }

  // Parse advanced analytics parameters
  const discountRate = isNaN(parseFloat(inputs.discountRate)) ? 8 : parseFloat(inputs.discountRate);

  // NPV calculation
  let npv = -initialCashInvested;
  for (let t = 1; t <= exitYear; t++) {
    let cf = projections[t - 1].cashFlow;
    if (t === exitYear) {
      cf += projections[t - 1].equity;
    }
    npv += cf / Math.pow(1 + discountRate / 100, t);
  }

  // IRR calculation
  const irrCashFlows = [];
  for (let t = 1; t <= exitYear; t++) {
    let cf = projections[t - 1].cashFlow;
    if (t === exitYear) {
      cf += projections[t - 1].equity;
    }
    irrCashFlows.push(cf);
  }
  const irr = calculateIRR(initialCashInvested, irrCashFlows);

  // Equity Multiplier calculation
  let totalReturned = 0;
  let totalInvested = initialCashInvested;
  for (let t = 1; t <= exitYear; t++) {
    const cf = projections[t - 1].cashFlow;
    if (cf < 0) {
      totalInvested += Math.abs(cf);
    } else {
      totalReturned += cf;
    }
  }
  totalReturned += projections[exitYear - 1].equity;
  const equityMultiplier = totalInvested > 0 ? (totalReturned / totalInvested) : 0;

  // Break-Even Year calculation
  let cumulativeCash = -initialCashInvested;
  let breakEvenYear = "N/A";
  if (cumulativeCash >= 0) {
    breakEvenYear = 0;
  } else {
    for (let t = 1; t <= projections.length; t++) {
      cumulativeCash += projections[t - 1].cashFlow;
      if (cumulativeCash >= 0) {
        breakEvenYear = t;
        break;
      }
    }
  }

  const acquisitionLtv = purchasePrice > 0 ? (loanAmount / purchasePrice) * 100 : 0;
  const amortizationSchedule = getAnnualAmortization(loanAmount, interestRate, loanTerm);

  return {
    purchasePrice: Math.round(purchasePrice * 100) / 100,
    downPaymentAmount: Math.round(downPaymentAmount * 100) / 100,
    loanAmount: Math.max(0, Math.round(loanAmount * 100) / 100),
    initialCashInvested: Math.round(initialCashInvested * 100) / 100,
    initialEquity: Math.round(initialEquity * 100) / 100,
    annualDebtService: Math.round(annualDebtService * 100) / 100,
    npv: Math.round(npv * 100) / 100,
    irr: Math.round(irr * 100) / 100,
    equityMultiplier: Math.round(equityMultiplier * 100) / 100,
    breakEvenYear,
    ltv: Math.round(acquisitionLtv * 100) / 100,
    monthlyMortgagePayment: Math.round(monthlyPayment * 100) / 100,
    amortizationSchedule,
    projections
  };
}

/**
 * 1. Calculate 2D Sensitivity Matrix (e.g. Interest Rate vs Exit Cap Rate or Purchase Price vs Vacancy Rate)
 */
function calculateSensitivityMatrix(assetType, baseInputs, rowParam, rowValues, colParam, colValues) {
  const matrix = [];

  for (let r = 0; r < rowValues.length; r++) {
    const rowVal = rowValues[r];
    const rowCells = [];
    for (let c = 0; c < colValues.length; c++) {
      const colVal = colValues[c];
      const testInputs = {
        ...baseInputs,
        [rowParam]: rowVal,
        [colParam]: colVal
      };
      const res = calculateProjections(assetType, testInputs);
      rowCells.push({
        rowValue: rowVal,
        colValue: colVal,
        irr: res.irr,
        npv: res.npv,
        cashOnCashY1: res.projections[0] ? res.projections[0].cashOnCash : 0,
        cashFlowY1: res.projections[0] ? res.projections[0].cashFlow : 0,
        equityMultiplier: res.equityMultiplier
      });
    }
    matrix.push(rowCells);
  }

  return {
    rowParam,
    rowValues,
    colParam,
    colValues,
    matrix
  };
}

/**
 * Helper: Box-Muller Gaussian Random Variable Generator
 */
function gaussianRandom(mean = 0, stdDev = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + num * stdDev;
}

/**
 * 2. Run Monte Carlo Probabilistic Simulation
 */
function runMonteCarloSimulation(assetType, baseInputs, iterations = 1000) {
  const irrs = [];
  const npvs = [];
  const y1CashFlows = [];
  let negativeCashFlowCount = 0;
  let negativeIrrCount = 0;

  const baseApprec = parseFloat(baseInputs.appreciationRate) || 0;
  const baseRentGrowth = parseFloat(baseInputs.rentGrowth) || 0;
  const baseVacancy = parseFloat(baseInputs.vacancyRate) || 5;

  for (let i = 0; i < iterations; i++) {
    // Generate stochastic variations
    const sampledApprec = gaussianRandom(baseApprec, 1.5);
    const sampledRentGrowth = gaussianRandom(baseRentGrowth, 1.0);
    const sampledVacancy = Math.max(0, Math.min(50, gaussianRandom(baseVacancy, 2.5)));

    const simInputs = {
      ...baseInputs,
      appreciationRate: sampledApprec,
      rentGrowth: sampledRentGrowth,
      vacancyRate: sampledVacancy
    };

    const res = calculateProjections(assetType, simInputs);
    irrs.push(res.irr);
    npvs.push(res.npv);
    const cf1 = res.projections[0] ? res.projections[0].cashFlow : 0;
    y1CashFlows.push(cf1);

    if (cf1 < 0) negativeCashFlowCount++;
    if (res.irr < 0) negativeIrrCount++;
  }

  irrs.sort((a, b) => a - b);
  npvs.sort((a, b) => a - b);

  const sumIrr = irrs.reduce((a, b) => a + b, 0);
  const meanIrr = sumIrr / iterations;

  const sumNpv = npvs.reduce((a, b) => a + b, 0);
  const meanNpv = sumNpv / iterations;

  const p5Index = Math.floor(iterations * 0.05);
  const p50Index = Math.floor(iterations * 0.50);
  const p95Index = Math.floor(iterations * 0.95);

  const p5Irr = irrs[p5Index];
  const medianIrr = irrs[p50Index];
  const p95Irr = irrs[p95Index];

  // Create 10 histogram bins for IRR distribution visual
  const minIrr = irrs[0];
  const maxIrr = irrs[irrs.length - 1];
  const binWidth = (maxIrr - minIrr) / 10 || 1;
  const bins = [];

  for (let b = 0; b < 10; b++) {
    const binStart = minIrr + b * binWidth;
    const binEnd = binStart + binWidth;
    const count = irrs.filter(val => val >= binStart && (b === 9 ? val <= binEnd : val < binEnd)).length;
    bins.push({
      label: `${Math.round(binStart)}% - ${Math.round(binEnd)}%`,
      binStart: Math.round(binStart * 10) / 10,
      binEnd: Math.round(binEnd * 10) / 10,
      count
    });
  }

  return {
    iterations,
    meanIrr: Math.round(meanIrr * 100) / 100,
    medianIrr: Math.round(medianIrr * 100) / 100,
    p5Irr: Math.round(p5Irr * 100) / 100,
    p95Irr: Math.round(p95Irr * 100) / 100,
    meanNpv: Math.round(meanNpv * 100) / 100,
    probNegativeCashFlow: Math.round((negativeCashFlowCount / iterations) * 1000) / 10,
    probNegativeIrr: Math.round((negativeIrrCount / iterations) * 1000) / 10,
    histogramBins: bins
  };
}

/**
 * 3. Tax Depreciation & After-Tax ROI Engine
 */
function calculateTaxAndDepreciation(assetType, inputs, baseResults) {
  const purchasePrice = parseFloat(inputs.purchasePrice) || 0;
  const rehabCosts = parseFloat(inputs.rehabCosts) || 0;
  const landPercent = parseFloat(inputs.landPercent) || 20; // default 20% land
  const taxRate = parseFloat(inputs.taxRate) || 24; // default 24% marginal tax rate
  const enableCostSeg = inputs.enableCostSeg === true || inputs.enableCostSeg === 'true';

  const landValue = purchasePrice * (landPercent / 100);
  const totalDepreciableBasis = Math.max(0, (purchasePrice - landValue) + rehabCosts);

  // Recovery Period: 27.5 yrs for residential (single-family, multi-unit), 39 yrs for commercial/storage
  const recoveryPeriod = (assetType === 'single-family' || assetType === 'multi-unit') ? 27.5 : 39.0;
  
  let annualDepreciation = totalDepreciableBasis / recoveryPeriod;
  let year1Depreciation = annualDepreciation;

  if (enableCostSeg) {
    // Cost seg: 15% bonus/5-year property, rest straight line
    const bonusBasis = totalDepreciableBasis * 0.15;
    const remainingBasis = totalDepreciableBasis * 0.85;
    const bonusYr1 = bonusBasis * 0.80; // 80% bonus depreciation year 1
    const straightLineYr1 = remainingBasis / recoveryPeriod;
    year1Depreciation = bonusYr1 + straightLineYr1;
  }

  const yearlyTaxDetails = [];
  const afterTaxCashFlows = [];
  let accumDepreciation = 0;

  for (let year = 1; year <= 10; year++) {
    const proj = baseResults.projections[year - 1];
    const amort = baseResults.amortizationSchedule[year - 1];
    const interestExpense = amort ? amort.interestPaid : 0;
    
    const depForYear = (year === 1 && enableCostSeg) ? year1Depreciation : annualDepreciation;
    accumDepreciation += depForYear;

    // Taxable Income = NOI - Interest Expense - Depreciation
    const taxableIncome = proj.netOperatingIncome - interestExpense - depForYear;
    const taxLiability = taxableIncome * (taxRate / 100); // negative means tax shield / savings
    const afterTaxCashFlow = proj.cashFlow - taxLiability;

    afterTaxCashFlows.push(afterTaxCashFlow);

    yearlyTaxDetails.push({
      year,
      noi: proj.netOperatingIncome,
      interestExpense: Math.round(interestExpense * 100) / 100,
      depreciation: Math.round(depForYear * 100) / 100,
      taxableIncome: Math.round(taxableIncome * 100) / 100,
      taxLiability: Math.round(taxLiability * 100) / 100,
      preTaxCashFlow: proj.cashFlow,
      afterTaxCashFlow: Math.round(afterTaxCashFlow * 100) / 100
    });
  }

  // After-Tax Exit Analysis at exitYear
  const rawExitYear = parseInt(inputs.exitYear);
  const exitYear = Math.max(1, Math.min(10, isNaN(rawExitYear) ? 10 : rawExitYear));
  const exitProj = baseResults.projections[exitYear - 1];
  const exitValue = exitProj ? exitProj.propertyValue : purchasePrice;
  const exitLoanBalance = exitProj ? exitProj.loanBalanceRemaining : 0;

  // Capital Gains Tax
  const adjustedBasis = Math.max(0, purchasePrice + rehabCosts - accumDepreciation);
  const totalGain = Math.max(0, exitValue - adjustedBasis);
  const depRecaptureTax = accumDepreciation * 0.25; // 25% recapture rate
  const capitalGainTaxable = Math.max(0, totalGain - accumDepreciation);
  const capitalGainsTax = capitalGainTaxable * 0.15; // 15% long-term cap gains rate
  const totalExitTax = depRecaptureTax + capitalGainsTax;

  const preTaxNetSaleProceeds = exitValue - exitLoanBalance;
  const afterTaxNetSaleProceeds = Math.max(0, preTaxNetSaleProceeds - totalExitTax);

  // After-tax IRR calculation
  const afterTaxIrrFlows = [];
  for (let t = 1; t <= exitYear; t++) {
    let cf = yearlyTaxDetails[t - 1].afterTaxCashFlow;
    if (t === exitYear) {
      cf += afterTaxNetSaleProceeds;
    }
    afterTaxIrrFlows.push(cf);
  }
  const afterTaxIrr = calculateIRR(baseResults.initialCashInvested, afterTaxIrrFlows);

  return {
    depreciableBasis: Math.round(totalDepreciableBasis * 100) / 100,
    recoveryPeriod,
    annualDepreciation: Math.round(annualDepreciation * 100) / 100,
    accumulatedDepreciation: Math.round(accumDepreciation * 100) / 100,
    afterTaxIrr: Math.round(afterTaxIrr * 100) / 100,
    afterTaxCoCY1: yearlyTaxDetails[0] && baseResults.initialCashInvested > 0 ? Math.round((yearlyTaxDetails[0].afterTaxCashFlow / baseResults.initialCashInvested) * 10000) / 100 : 0,
    totalExitTax: Math.round(totalExitTax * 100) / 100,
    afterTaxNetSaleProceeds: Math.round(afterTaxNetSaleProceeds * 100) / 100,
    yearlyTaxDetails
  };
}

/**
 * 4. Mid-Hold Refinance & BRRRR Strategy Builder
 */
function calculateRefinanceEvent(assetType, baseInputs, refiYear = 3, refiLtv = 75, refiRate = 6.5, refiTerm = 30) {
  const baseRes = calculateProjections(assetType, baseInputs);
  const targetYear = Math.max(1, Math.min(9, parseInt(refiYear) || 3));

  const projAtRefi = baseRes.projections[targetYear - 1];
  if (!projAtRefi) return baseRes;

  const refiValue = projAtRefi.propertyValue;
  const newLoanAmount = refiValue * (refiLtv / 100);
  const oldLoanBalance = projAtRefi.loanBalanceRemaining;
  const refiClosingCosts = newLoanAmount * 0.02; // 2% refi closing costs
  const netCashOut = newLoanAmount - oldLoanBalance - refiClosingCosts;

  const newMonthlyPayment = calculateMonthlyPayment(newLoanAmount, refiRate, refiTerm);
  const newAnnualDebtService = newMonthlyPayment * 12;

  const updatedProjections = JSON.parse(JSON.stringify(baseRes.projections));
  let updatedCashInvested = baseRes.initialCashInvested;

  for (let y = 1; y <= 10; y++) {
    const p = updatedProjections[y - 1];
    if (y === targetYear) {
      // Cash out distribution at refi year
      p.refiProceeds = Math.round(netCashOut * 100) / 100;
      p.cashFlow = Math.round((p.cashFlow + netCashOut) * 100) / 100;
      updatedCashInvested = Math.max(0, updatedCashInvested - netCashOut);
    } else if (y > targetYear) {
      // Recalculate post-refi debt service
      p.debtService = Math.round(newAnnualDebtService * 100) / 100;
      p.netOperatingIncome = p.effectiveGrossIncome - p.operatingExpenses;
      p.cashFlow = Math.round((p.netOperatingIncome - p.debtService) * 100) / 100;
      
      const newBalance = calculateRemainingBalance(newLoanAmount, refiRate, refiTerm, y - targetYear);
      p.loanBalanceRemaining = Math.round(newBalance * 100) / 100;
      p.equity = Math.round((p.propertyValue - newBalance) * 100) / 100;
      p.dscr = p.debtService > 0 ? Math.round((p.netOperatingIncome / p.debtService) * 100) / 100 : null;
    }
  }

  // Recalculate Refi IRR
  const exitYear = baseRes.projections.length;
  const irrFlows = [];
  for (let t = 1; t <= exitYear; t++) {
    let cf = updatedProjections[t - 1].cashFlow;
    if (t === exitYear) {
      cf += updatedProjections[t - 1].equity;
    }
    irrFlows.push(cf);
  }
  const refiIrr = calculateIRR(baseRes.initialCashInvested, irrFlows);

  return {
    refiYear: targetYear,
    refiValue: Math.round(refiValue * 100) / 100,
    newLoanAmount: Math.round(newLoanAmount * 100) / 100,
    oldLoanBalance: Math.round(oldLoanBalance * 100) / 100,
    netCashOut: Math.round(netCashOut * 100) / 100,
    newAnnualDebtService: Math.round(newAnnualDebtService * 100) / 100,
    remainingCapitalInDeal: Math.round(updatedCashInvested * 100) / 100,
    refiIrr: Math.round(refiIrr * 100) / 100,
    projections: updatedProjections
  };
}

/**
 * 5. Reverse Deal Solver (Maximum Allowable Purchase Price for Target IRR)
 */
function solveTargetPurchasePrice(assetType, baseInputs, targetIRR = 15) {
  let lowPrice = 10000;
  let highPrice = 50000000;
  let bestPrice = parseFloat(baseInputs.purchasePrice) || 200000;

  for (let i = 0; i < 50; i++) {
    const midPrice = (lowPrice + highPrice) / 2;
    const testInputs = { ...baseInputs, purchasePrice: midPrice };
    const res = calculateProjections(assetType, testInputs);

    if (Math.abs(res.irr - targetIRR) < 0.05) {
      bestPrice = midPrice;
      break;
    }

    if (res.irr > targetIRR) {
      // Higher purchase price reduces IRR
      lowPrice = midPrice;
    } else {
      highPrice = midPrice;
    }
    bestPrice = midPrice;
  }

  const solvedResults = calculateProjections(assetType, { ...baseInputs, purchasePrice: Math.round(bestPrice) });

  return {
    targetIRR,
    solvedPurchasePrice: Math.round(bestPrice),
    solvedResults
  };
}

/**
 * 6. Portfolio Aggregator
 */
function aggregatePortfolio(dealsList) {
  if (!dealsList || dealsList.length === 0) {
    return {
      dealCount: 0,
      totalPurchasePrice: 0,
      totalCashInvested: 0,
      totalLoanAmount: 0,
      portfolioIrr: 0,
      combinedProjections: []
    };
  }

  let totalPurchasePrice = 0;
  let totalCashInvested = 0;
  let totalLoanAmount = 0;
  let totalUnitsOrDoors = 0;

  const combinedProjections = [];
  for (let year = 1; year <= 10; year++) {
    combinedProjections.push({
      year,
      propertyValue: 0,
      grossPotentialIncome: 0,
      effectiveGrossIncome: 0,
      operatingExpenses: 0,
      netOperatingIncome: 0,
      debtService: 0,
      cashFlow: 0,
      equity: 0
    });
  }

  const portfolioIrrFlows = [];
  for (let year = 1; year <= 10; year++) {
    portfolioIrrFlows.push(0);
  }

  dealsList.forEach(deal => {
    const qty = (typeof deal.quantity === 'number' && deal.quantity > 0) ? deal.quantity : 1;
    totalUnitsOrDoors += qty;
    const res = deal.results || calculateProjections(deal.assetType, deal.inputs);
    totalPurchasePrice += res.purchasePrice * qty;
    totalCashInvested += res.initialCashInvested * qty;
    totalLoanAmount += res.loanAmount * qty;

    res.projections.forEach((p, idx) => {
      if (combinedProjections[idx]) {
        combinedProjections[idx].propertyValue += p.propertyValue * qty;
        combinedProjections[idx].grossPotentialIncome += p.grossPotentialIncome * qty;
        combinedProjections[idx].effectiveGrossIncome += p.effectiveGrossIncome * qty;
        combinedProjections[idx].operatingExpenses += p.operatingExpenses * qty;
        combinedProjections[idx].netOperatingIncome += p.netOperatingIncome * qty;
        combinedProjections[idx].debtService += p.debtService * qty;
        combinedProjections[idx].cashFlow += p.cashFlow * qty;
        combinedProjections[idx].equity += p.equity * qty;

        portfolioIrrFlows[idx] += (p.cashFlow * qty) + (idx === 9 ? (p.equity * qty) : 0);
      }
    });
  });

  // Round combined projections & compute per-year portfolio DSCR and CoC
  let cumulativeCashFlow = 0;
  combinedProjections.forEach(cp => {
    cp.propertyValue = Math.round(cp.propertyValue * 100) / 100;
    cp.grossPotentialIncome = Math.round(cp.grossPotentialIncome * 100) / 100;
    cp.effectiveGrossIncome = Math.round(cp.effectiveGrossIncome * 100) / 100;
    cp.operatingExpenses = Math.round(cp.operatingExpenses * 100) / 100;
    cp.netOperatingIncome = Math.round(cp.netOperatingIncome * 100) / 100;
    cp.debtService = Math.round(cp.debtService * 100) / 100;
    cp.cashFlow = Math.round(cp.cashFlow * 100) / 100;
    cp.equity = Math.round(cp.equity * 100) / 100;

    cumulativeCashFlow += cp.cashFlow;
    cp.cumulativeCashFlow = Math.round(cumulativeCashFlow * 100) / 100;
    cp.dscr = cp.debtService > 0 ? Math.round((cp.netOperatingIncome / cp.debtService) * 100) / 100 : null;
    cp.cashOnCash = totalCashInvested > 0 ? Math.round((cp.cashFlow / totalCashInvested) * 10000) / 100 : 0;
  });

  const portfolioIrr = calculateIRR(totalCashInvested, portfolioIrrFlows);
  const blendedYear1CoC = combinedProjections.length > 0 ? combinedProjections[0].cashOnCash : 0;
  const blendedYear1CapRate = totalPurchasePrice > 0 && combinedProjections.length > 0
    ? Math.round((combinedProjections[0].netOperatingIncome / totalPurchasePrice) * 10000) / 100
    : 0;
  const total10YearCashFlow = Math.round(cumulativeCashFlow * 100) / 100;
  const finalYearEquity = combinedProjections.length > 0 ? combinedProjections[combinedProjections.length - 1].equity : 0;
  const equityMultiple = totalCashInvested > 0
    ? Math.round(((total10YearCashFlow + finalYearEquity) / totalCashInvested) * 100) / 100
    : 0;
  const portfolioLtv = totalPurchasePrice > 0
    ? Math.round((totalLoanAmount / totalPurchasePrice) * 10000) / 100
    : 0;

  return {
    dealCount: dealsList.length,
    totalUnitsOrDoors,
    totalPurchasePrice: Math.round(totalPurchasePrice * 100) / 100,
    totalCashInvested: Math.round(totalCashInvested * 100) / 100,
    totalLoanAmount: Math.round(totalLoanAmount * 100) / 100,
    portfolioLtv,
    portfolioIrr: Math.round(portfolioIrr * 100) / 100,
    blendedYear1CoC,
    blendedYear1CapRate,
    total10YearCashFlow,
    equityMultiple,
    combinedProjections
  };
}

/**
 * Helper to generate Bull, Base, and Bear variants for scenario sensitivity
 */
function generateScenarioVariants(assetType, baseInputs) {
  const base = { ...baseInputs };

  // Bull Case: +8% rent, -1.5% vacancy, +0.5% rent growth, +0.5% appreciation
  const bull = { ...baseInputs };
  if (bull.monthlyRent) bull.monthlyRent = Math.round(parseFloat(bull.monthlyRent) * 1.08);
  if (bull.grossRentMonthly) bull.grossRentMonthly = Math.round(parseFloat(bull.grossRentMonthly) * 1.08);
  if (bull.monthlyRentPerUnit) bull.monthlyRentPerUnit = Math.round(parseFloat(bull.monthlyRentPerUnit) * 1.08);
  if (bull.rentPerSqFt) bull.rentPerSqFt = Math.round(parseFloat(bull.rentPerSqFt) * 1.08 * 100) / 100;
  if (bull.vacancyRate) bull.vacancyRate = Math.max(1, Math.round((parseFloat(bull.vacancyRate) - 1.5) * 10) / 10);
  if (bull.rentGrowthRate) bull.rentGrowthRate = Math.round((parseFloat(bull.rentGrowthRate) + 0.5) * 10) / 10;
  if (bull.appreciationRate) bull.appreciationRate = Math.round((parseFloat(bull.appreciationRate) + 0.5) * 10) / 10;

  // Bear Case: -8% rent, +3% vacancy, -0.5% rent growth, +0.5% interest rate, +0.5% exit cap
  const bear = { ...baseInputs };
  if (bear.monthlyRent) bear.monthlyRent = Math.round(parseFloat(bear.monthlyRent) * 0.92);
  if (bear.grossRentMonthly) bear.grossRentMonthly = Math.round(parseFloat(bear.grossRentMonthly) * 0.92);
  if (bear.monthlyRentPerUnit) bear.monthlyRentPerUnit = Math.round(parseFloat(bear.monthlyRentPerUnit) * 0.92);
  if (bear.rentPerSqFt) bear.rentPerSqFt = Math.round(parseFloat(bear.rentPerSqFt) * 0.92 * 100) / 100;
  if (bear.vacancyRate) bear.vacancyRate = Math.min(25, Math.round((parseFloat(bear.vacancyRate) + 3) * 10) / 10);
  if (bear.rentGrowthRate) bear.rentGrowthRate = Math.max(0, Math.round((parseFloat(bear.rentGrowthRate) - 0.75) * 10) / 10);
  if (bear.interestRate) bear.interestRate = Math.round((parseFloat(bear.interestRate) + 0.5) * 100) / 100;

  return {
    base: { inputs: base, results: calculateProjections(assetType, base) },
    bull: { inputs: bull, results: calculateProjections(assetType, bull) },
    bear: { inputs: bear, results: calculateProjections(assetType, bear) }
  };
}

/**
 * 7. Automated Deal Auditor (Heuristic Risk Analysis)
 */
function auditDealRisks(assetType, inputs, results) {
  const warnings = [];

  if (!results || !results.projections || results.projections.length === 0) {
    return warnings;
  }

  // Check 1: DSCR Coverage
  const minDscr = Math.min(...results.projections.filter(p => p.dscr !== null).map(p => p.dscr));
  if (minDscr < 1.0) {
    warnings.push({
      level: 'danger',
      title: 'Critical Debt Service Risk (DSCR < 1.0x)',
      description: `Property NOI falls below annual mortgage payments (min DSCR is ${minDscr.toFixed(2)}x), causing negative leverage.`
    });
  } else if (minDscr < 1.25) {
    warnings.push({
      level: 'warning',
      title: 'Tight Lenders Coverage (DSCR < 1.25x)',
      description: `Minimum DSCR is ${minDscr.toFixed(2)}x, which may fail traditional commercial underwriting standards (1.25x minimum).`
    });
  }

  // Check 2: Negative Cash Flow Years
  const negYears = results.projections.filter(p => p.cashFlow < 0).map(p => p.year);
  if (negYears.length > 0) {
    warnings.push({
      level: 'warning',
      title: `Negative Net Cash Flow (Years: ${negYears.join(', ')})`,
      description: `Deal requires supplemental out-of-pocket capital injections during projected operational years.`
    });
  }

  // Check 3: Leverage Risk
  if (results.ltv > 80) {
    warnings.push({
      level: 'warning',
      title: 'High Initial Leverage (LTV > 80%)',
      description: `Acquisition down payment is under 20%, increasing interest rate risk and default vulnerability.`
    });
  }

  // Check 4: Break-Even Horizon
  if (results.breakEvenYear === 'N/A' || results.breakEvenYear > 6) {
    warnings.push({
      level: 'info',
      title: 'Extended Payback Horizon',
      description: `Break-even year is ${results.breakEvenYear}, indicating longer equity payback duration.`
    });
  }

  // Check 5: Healthy Metrics Confirmation
  if (warnings.length === 0) {
    warnings.push({
      level: 'success',
      title: 'Robust Financial Profile',
      description: 'Deal passes core DSCR, positive cash flow, and leverage health benchmarks.'
    });
  }

  return warnings;
}

// Export functions for ES Modules environment, and attach to global scope for standard browser environment.
if (typeof exports !== 'undefined') {
  exports.calculateProjections = calculateProjections;
  exports.calculateMonthlyPayment = calculateMonthlyPayment;
  exports.calculateRemainingBalance = calculateRemainingBalance;
  exports.calculateSensitivityMatrix = calculateSensitivityMatrix;
  exports.runMonteCarloSimulation = runMonteCarloSimulation;
  exports.calculateTaxAndDepreciation = calculateTaxAndDepreciation;
  exports.calculateRefinanceEvent = calculateRefinanceEvent;
  exports.solveTargetPurchasePrice = solveTargetPurchasePrice;
  exports.aggregatePortfolio = aggregatePortfolio;
  exports.auditDealRisks = auditDealRisks;
  exports.generateScenarioVariants = generateScenarioVariants;
}
if (typeof window !== 'undefined') {
  window.PropertyMath = {
    calculateProjections,
    calculateMonthlyPayment,
    calculateRemainingBalance,
    calculateSensitivityMatrix,
    runMonteCarloSimulation,
    calculateTaxAndDepreciation,
    calculateRefinanceEvent,
    solveTargetPurchasePrice,
    aggregatePortfolio,
    auditDealRisks,
    generateScenarioVariants
  };
}

