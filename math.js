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

    // 6. Cash Flow (Net of Debt Service)
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

// Export functions for ES Modules environment, and attach to global scope for standard browser environment.
if (typeof exports !== 'undefined') {
  exports.calculateProjections = calculateProjections;
  exports.calculateMonthlyPayment = calculateMonthlyPayment;
  exports.calculateRemainingBalance = calculateRemainingBalance;
}
if (typeof window !== 'undefined') {
  window.PropertyMath = {
    calculateProjections,
    calculateMonthlyPayment,
    calculateRemainingBalance
  };
}
