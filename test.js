const assert = require('assert');
const { calculateProjections, calculateMonthlyPayment, calculateRemainingBalance, calculateHoldingPeriodWealth } = require('./math.js');

console.log('--- Starting math.js Unit Test Suite ---\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    testsFailed++;
  }
}

// 1. Helper Mortgage Calculations
runTest('calculateMonthlyPayment - normal case', () => {
  // $300,000 loan, 4% interest rate, 30 years
  const payment = calculateMonthlyPayment(300000, 4, 30);
  assert.ok(Math.abs(payment - 1432.25) < 0.1, `Expected payment around $1432.25, got ${payment}`);
});

runTest('calculateMonthlyPayment - zero interest rate', () => {
  const payment = calculateMonthlyPayment(300000, 0, 30);
  assert.strictEqual(payment, 300000 / (30 * 12));
});

runTest('calculateMonthlyPayment - zero loan or term', () => {
  assert.strictEqual(calculateMonthlyPayment(0, 5, 30), 0);
  assert.strictEqual(calculateMonthlyPayment(300000, 5, 0), 0);
});

runTest('calculateRemainingBalance - normal case', () => {
  const balance = calculateRemainingBalance(300000, 4, 30, 5);
  // Amortized balance after 5 years should be exactly $271,342.54
  assert.ok(Math.abs(balance - 271342.54) < 1.0, `Expected balance around $271,342.54, got ${balance}`);
});

runTest('calculateRemainingBalance - zero interest rate', () => {
  const balance = calculateRemainingBalance(300000, 0, 30, 10);
  assert.ok(Math.abs(balance - 200000) < 1e-9, `Expected balance near 200000, got ${balance}`);
});

runTest('calculateRemainingBalance - elapsed >= term', () => {
  const balance = calculateRemainingBalance(300000, 4, 30, 31);
  assert.strictEqual(balance, 0);
});


// 2. Single-Family Property Preset & ARV Logic
runTest('Single-Family Model with ARV and standard inputs', () => {
  const inputs = {
    purchasePrice: '200000',
    downPaymentPercent: '20',
    interestRate: '5',
    loanTerm: '30',
    rehabCosts: '30000',
    closingCosts: '5000',
    appreciationRate: '3',
    vacancyRate: '5',
    rentGrowth: '2',
    expenseRatio: '35',
    arv: '250000',
    monthlyRent: '2000'
  };

  const results = calculateProjections('single-family', inputs);
  
  // Verify purchase and initial metrics
  assert.strictEqual(results.purchasePrice, 200000);
  assert.strictEqual(results.loanAmount, 160000); // 200000 * 0.8
  assert.strictEqual(results.downPaymentAmount, 40000); // 200000 * 0.2
  assert.strictEqual(results.initialCashInvested, 40000 + 30000 + 5000); // down payment + rehab + closing = 75000
  
  // Year 1 Gross Income: 2000 * 12 = 24000
  // Year 1 Projections
  const y1 = results.projections[0];
  assert.strictEqual(y1.year, 1);
  assert.strictEqual(y1.propertyValue, 250000); // initial property value is ARV (250000)
  assert.strictEqual(y1.grossPotentialIncome, 24000);
  assert.strictEqual(y1.vacancyLoss, 1200); // 5% of 24000
  assert.strictEqual(y1.effectiveGrossIncome, 22800);
  assert.strictEqual(y1.operatingExpenses, 11500); // 35% of 24000 (8400) + 1% of 250000 (2500) + turnover (600)
  assert.strictEqual(y1.netOperatingIncome, 22800 - 11500); // 11300
  
  // Year 2 appreciation check
  const y2 = results.projections[1];
  assert.strictEqual(y2.propertyValue, 250000 * 1.03); // appreciated by 3%
  assert.strictEqual(y2.grossPotentialIncome, 24000 * 1.02); // rent growth by 2%
});


// 3. Multi-Unit Preset
runTest('Multi-Unit Model calculations', () => {
  const inputs = {
    purchasePrice: '500000',
    downPaymentPercent: '25',
    interestRate: '6',
    loanTerm: '30',
    rehabCosts: '0',
    closingCosts: '10000',
    appreciationRate: '4',
    vacancyRate: '8',
    rentGrowth: '3',
    expenseRatio: '45',
    unitCount: '4',
    monthlyRentPerUnit: '1200'
  };

  const results = calculateProjections('multi-unit', inputs);
  
  // Year 1 Gross Income = 4 * 1200 * 12 = 57600
  const y1 = results.projections[0];
  assert.strictEqual(y1.grossPotentialIncome, 57600);
  assert.strictEqual(y1.vacancyLoss, Math.round(57600 * 0.08 * 100) / 100);
});


// 4. Commercial Preset & NNN Lease Pass-Through Logic
runTest('Commercial Model - Gross Lease vs NNN Lease', () => {
  const commonInputs = {
    purchasePrice: '1000000',
    downPaymentPercent: '30',
    interestRate: '5.5',
    loanTerm: '25',
    rehabCosts: '0',
    closingCosts: '15000',
    targetCapRate: '9',
    vacancyRate: '5',
    rentGrowth: '2.5',
    expenseRatio: '20', // landlord pays 20% on Gross Lease
    grossRentAnnual: '120000'
  };

  // 1. Gross Lease (Standard operating expenses apply)
  const resultsGross = calculateProjections('commercial', { ...commonInputs, leaseType: 'Gross' });
  const y1Gross = resultsGross.projections[0];
  assert.strictEqual(y1Gross.operatingExpenses, 24000); // 20% of 120000
  assert.strictEqual(y1Gross.netOperatingIncome, 120000 - 6000 - 24000); // GPI (120000) - Vacancy (6000) - Expenses (24000) = 90000

  // 2. NNN Lease (Landlord operating expenses should equal the OER base, e.g. un-reimbursed admin)
  const resultsNNN = calculateProjections('commercial', { ...commonInputs, leaseType: 'NNN' });
  const y1NNN = resultsNNN.projections[0];
  assert.strictEqual(y1NNN.operatingExpenses, 24000); // 20% of 120000
  assert.strictEqual(y1NNN.netOperatingIncome, 120000 - 6000 - 24000); // EGI (114000) - Expenses (24000) = 90000
});


// 5. Storage Preset
runTest('Storage Model with Rent per Unit', () => {
  const inputs = {
    purchasePrice: '300000',
    downPaymentPercent: '20',
    interestRate: '6.5',
    loanTerm: '20',
    rehabCosts: '5000',
    closingCosts: '3000',
    appreciationRate: '2',
    vacancyRate: '10',
    rentGrowth: '3',
    expenseRatio: '40',
    unitCount: '50',
    monthlyRentPerUnit: '100'
  };

  const results = calculateProjections('storage', inputs);
  // Year 1 Gross Income = 50 * 100 * 12 = 60000
  const y1 = results.projections[0];
  assert.strictEqual(y1.grossPotentialIncome, 60000);
});

runTest('Storage Model with SqFt and Rent per SqFt', () => {
  const inputs = {
    purchasePrice: '300000',
    downPaymentPercent: '20',
    interestRate: '6.5',
    loanTerm: '20',
    rehabCosts: '5000',
    closingCosts: '3000',
    appreciationRate: '2',
    vacancyRate: '10',
    rentGrowth: '3',
    expenseRatio: '40',
    totalSqFt: '10000',
    rentPerSqFt: '0.75' // monthly rent per sqft
  };

  const results = calculateProjections('storage', inputs);
  // Year 1 Gross Income = 10000 * 0.75 * 12 = 90000
  const y1 = results.projections[0];
  assert.strictEqual(y1.grossPotentialIncome, 90000);
});


// 6. Edge Cases
runTest('Edge Case: Zero Purchase Price', () => {
  const inputs = {
    purchasePrice: '0',
    downPaymentPercent: '20',
    interestRate: '5',
    loanTerm: '30',
    rehabCosts: '10000',
    closingCosts: '2000',
    monthlyRent: '1500'
  };
  const results = calculateProjections('single-family', inputs);
  assert.strictEqual(results.purchasePrice, 0);
  assert.strictEqual(results.loanAmount, 0);
  assert.strictEqual(results.initialCashInvested, 12000); // 0 down + 10k rehab + 2k closing
});

runTest('Edge Case: Zero Interest Rate', () => {
  const inputs = {
    purchasePrice: '120000',
    downPaymentPercent: '10',
    interestRate: '0',
    loanTerm: '10',
    monthlyRent: '1000'
  };
  const results = calculateProjections('single-family', inputs);
  assert.strictEqual(results.annualDebtService, 120000 * 0.9 / 10); // $108,000 / 10 years = 10800 annual debt service
});

runTest('Edge Case: 100% Vacancy Rate', () => {
  const inputs = {
    purchasePrice: '100000',
    downPaymentPercent: '20',
    interestRate: '5',
    loanTerm: '30',
    vacancyRate: '100',
    monthlyRent: '1000',
    expenseRatio: '30'
  };
  const results = calculateProjections('single-family', inputs);
  const y1 = results.projections[0];
  assert.strictEqual(y1.vacancyLoss, 12000);
  assert.strictEqual(y1.effectiveGrossIncome, 0);
  assert.strictEqual(y1.netOperatingIncome, -10600); // EGI(0) - (OEx(3600) + maint(1000) + turnover(6000)) = -10600
});

runTest('Edge Case: Zero Initial Cash Invested (Divide-by-zero check)', () => {
  const inputs = {
    purchasePrice: '0',
    downPaymentPercent: '0',
    interestRate: '0',
    loanTerm: '10',
    rehabCosts: '0',
    closingCosts: '0',
    monthlyRent: '1000'
  };
  const results = calculateProjections('single-family', inputs);
  assert.strictEqual(results.initialCashInvested, 0);
  
  // check cash on cash of year 1 is 0 instead of NaN or Infinity
  assert.strictEqual(results.projections[0].cashOnCash, 0);
  assert.strictEqual(results.equityMultiplier, 0);
});

runTest('Edge Case: Empty Input Fields', () => {
  const inputs = {
    purchasePrice: '',
    downPaymentPercent: '',
    interestRate: '',
    loanTerm: '',
    rehabCosts: '',
    closingCosts: '',
    monthlyRent: ''
  };
  const results = calculateProjections('single-family', inputs);
  assert.strictEqual(results.purchasePrice, 0);
  assert.strictEqual(results.initialCashInvested, 0);
  assert.strictEqual(results.projections[0].grossPotentialIncome, 0);
});

runTest('Cash Injections and Equity Multiplier for Negative Cash Flow scenario', () => {
  const inputs = {
    purchasePrice: '100000',
    downPaymentPercent: '100', // All cash initially
    interestRate: '0',
    loanTerm: '30',
    rehabCosts: '0',
    closingCosts: '0',
    appreciationRate: '0',
    vacancyRate: '100', // Force EGI to 0
    rentGrowth: '0',
    expenseRatio: '50', // Expenses = 50% of GPI
    monthlyRent: '1000', // Gross Rent = 12000
    exitYear: '2',
    manageProperty: false
  };
  const results = calculateProjections('single-family', inputs);
  
  const y1 = results.projections[0];
  assert.ok(y1.cashFlow < 0, `Expected negative cash flow, got ${y1.cashFlow}`);
  
  assert.ok(y1.cumulativeCashInvested > results.initialCashInvested, `Expected cumulative cash invested to increase: initial=${results.initialCashInvested}, cumulative=${y1.cumulativeCashInvested}`);
  
  const expectedCoC = (y1.cashFlow / y1.cumulativeCashInvested) * 100;
  assert.ok(Math.abs(y1.cashOnCash - Math.round(expectedCoC * 100) / 100) < 0.1, `Expected CoC to be calculated with cumulative cash invested. Got ${y1.cashOnCash}, expected ${expectedCoC}`);

  const y2 = results.projections[1];
  const totalInjections = Math.abs(y1.cashFlow) + Math.abs(y2.cashFlow);
  const expectedTotalInvested = 100000 + totalInjections;
  const expectedEquityMultiplier = y2.equity / expectedTotalInvested;
  assert.ok(Math.abs(results.equityMultiplier - expectedEquityMultiplier) < 0.05, `Expected Equity Multiplier around ${expectedEquityMultiplier}, got ${results.equityMultiplier}`);
});

runTest('Debt Metrics (LTV, DSCR, Debt Yield) and Amortization Schedule', () => {
  const inputs = {
    purchasePrice: '300000',
    downPaymentPercent: '20', // loanAmount = 240000
    interestRate: '6',
    loanTerm: '30',
    rehabCosts: '0',
    closingCosts: '0',
    monthlyRent: '2000', // Gross = 24000/yr
    expenseRatio: '30',
    manageProperty: false
  };
  const results = calculateProjections('single-family', inputs);
  
  assert.strictEqual(results.ltv, 80);
  
  const y1 = results.projections[0];
  assert.ok(y1.ltv < 80, `Expected year 1 LTV less than 80%, got ${y1.ltv}%`);
  
  const expectedDscr = y1.netOperatingIncome / y1.debtService;
  assert.ok(Math.abs(y1.dscr - Math.round(expectedDscr * 100) / 100) < 0.05, `Expected DSCR ${expectedDscr}, got ${y1.dscr}`);
  
  const expectedDebtYield = (y1.netOperatingIncome / 240000) * 100;
  assert.ok(Math.abs(y1.debtYield - Math.round(expectedDebtYield * 100) / 100) < 0.05, `Expected Debt Yield ${expectedDebtYield}, got ${y1.debtYield}`);

  const amort = results.amortizationSchedule;
  assert.strictEqual(amort.length, 10);
  assert.strictEqual(amort[0].endingBalance, y1.loanBalanceRemaining);
  assert.ok(Math.abs(amort[0].principalPaid + amort[0].interestPaid - amort[0].totalPayment) < 1.0, "Principal + Interest should equal total payment");
});

runTest('Commercial Valuation - Income Capitalization over multiple years', () => {
  const inputs = {
    purchasePrice: '1000000',
    downPaymentPercent: '30',
    interestRate: '5.5',
    loanTerm: '25',
    rehabCosts: '0',
    closingCosts: '0',
    targetCapRate: '8', // Capitalized at 8% target cap rate
    vacancyRate: '5',
    rentGrowth: '3', // NOI will grow, driving value appreciation
    expenseRatio: '15',
    grossRentAnnual: '100000',
    leaseType: 'NNN',
    exitYear: '3'
  };
  const results = calculateProjections('commercial', inputs);
  
  const y1 = results.projections[0];
  assert.strictEqual(y1.propertyValue, 1000000);
  assert.strictEqual(y1.capRate, 8);
  
  const y2 = results.projections[1];
  assert.strictEqual(y2.propertyValue, 1030000);
  assert.strictEqual(y2.capRate, 8); // Cap rate should remain constant at 8%
});

runTest('Storage Valuation - Income Capitalization over multiple years', () => {
  const inputs = {
    purchasePrice: '1200000',
    downPaymentPercent: '25',
    interestRate: '7.2',
    loanTerm: '20',
    rehabCosts: '0',
    closingCosts: '0',
    targetCapRate: '6.5',
    vacancyRate: '10',
    rentGrowth: '3',
    expenseRatio: '34',
    storageUnitCount: '100',
    storageRentPerUnit: '120',
    isAutomated: false,
    manageProperty: true
  };
  const results = calculateProjections('storage', inputs);
  
  const y1 = results.projections[0];
  assert.strictEqual(y1.propertyValue, 1200000); // Year 1 value should be purchase price
  assert.strictEqual(y1.capRate, 3.84); // 46,080 NOI / 1,200,000 Purchase Price = 3.84% Entry Cap Rate
  
  const y2 = results.projections[1];
  assert.ok(Math.abs(y2.propertyValue - 1147666.85) < 5.0, `Expected Year 2 propertyValue near 1147666.85, got ${y2.propertyValue}`);
  assert.strictEqual(y2.capRate, 4.14); // Interpolated cap rate at Year 2
  
  const y10 = results.projections[9];
  assert.ok(Math.abs(y10.propertyValue - 924983.85) < 5.0, `Expected Year 10 propertyValue near 924983.85, got ${y10.propertyValue}`);
  assert.strictEqual(y10.capRate, 6.5); // Reaches target cap rate at Year 10 (exit year)
});

// 7. Advanced PropTech Modules Tests

runTest('Sensitivity Matrix calculation', () => {
  const { calculateSensitivityMatrix } = require('./math.js');
  const baseInputs = {
    purchasePrice: '300000',
    downPaymentPercent: '20',
    interestRate: '6',
    loanTerm: '30',
    monthlyRent: '2500',
    expenseRatio: '35',
    vacancyRate: '5',
    appreciationRate: '3'
  };
  const matrixRes = calculateSensitivityMatrix('single-family', baseInputs, 'interestRate', [5, 6, 7], 'vacancyRate', [3, 5, 8]);
  assert.strictEqual(matrixRes.matrix.length, 3);
  assert.strictEqual(matrixRes.matrix[0].length, 3);
  assert.ok(typeof matrixRes.matrix[0][0].irr === 'number');
});

runTest('Monte Carlo Simulation run', () => {
  const { runMonteCarloSimulation } = require('./math.js');
  const baseInputs = {
    purchasePrice: '250000',
    downPaymentPercent: '20',
    interestRate: '5.5',
    loanTerm: '30',
    monthlyRent: '2000',
    expenseRatio: '35',
    vacancyRate: '5',
    appreciationRate: '3'
  };
  const mc = runMonteCarloSimulation('single-family', baseInputs, 100);
  assert.strictEqual(mc.iterations, 100);
  assert.ok(typeof mc.meanIrr === 'number');
  assert.strictEqual(mc.histogramBins.length, 10);
});

runTest('Tax Depreciation and After-Tax Analysis', () => {
  const { calculateTaxAndDepreciation } = require('./math.js');
  const inputs = {
    purchasePrice: '400000',
    downPaymentPercent: '20',
    interestRate: '6',
    loanTerm: '30',
    rehabCosts: '20000',
    monthlyRent: '3200',
    expenseRatio: '35',
    taxRate: '24',
    landPercent: '20'
  };
  const baseRes = calculateProjections('single-family', inputs);
  const taxRes = calculateTaxAndDepreciation('single-family', inputs, baseRes);
  assert.strictEqual(taxRes.depreciableBasis, (400000 * 0.8) + 20000); // 320k + 20k = 340k
  assert.strictEqual(taxRes.annualDepreciation, Math.round((340000 / 27.5) * 100) / 100);
  assert.ok(typeof taxRes.afterTaxIrr === 'number');
});

runTest('Mid-Hold Refinance & BRRRR Model', () => {
  const { calculateRefinanceEvent } = require('./math.js');
  const inputs = {
    purchasePrice: '200000',
    downPaymentPercent: '20',
    interestRate: '6',
    loanTerm: '30',
    monthlyRent: '2200',
    expenseRatio: '35',
    appreciationRate: '5'
  };
  const refiRes = calculateRefinanceEvent('single-family', inputs, 3, 75, 6.5, 30);
  assert.strictEqual(refiRes.refiYear, 3);
  assert.ok(refiRes.newLoanAmount > refiRes.oldLoanBalance);
  assert.ok(refiRes.netCashOut > 0);
  assert.strictEqual(refiRes.projections.length, 10);
});

runTest('Target Purchase Price Solver', () => {
  const { solveTargetPurchasePrice } = require('./math.js');
  const inputs = {
    downPaymentPercent: '20',
    interestRate: '6',
    loanTerm: '30',
    monthlyRent: '2500',
    expenseRatio: '35',
    vacancyRate: '5',
    appreciationRate: '3'
  };
  const solver = solveTargetPurchasePrice('single-family', inputs, 12);
  assert.ok(solver.solvedPurchasePrice > 0);
  assert.ok(Math.abs(solver.solvedResults.irr - 12) < 0.5);
});

runTest('Portfolio Aggregator', () => {
  const { aggregatePortfolio } = require('./math.js');
  const deal1 = {
    assetType: 'single-family',
    inputs: { purchasePrice: '200000', downPaymentPercent: '20', interestRate: '6', loanTerm: '30', monthlyRent: '1800' }
  };
  const deal2 = {
    assetType: 'multi-unit',
    inputs: { purchasePrice: '600000', downPaymentPercent: '25', interestRate: '6.5', loanTerm: '30', unitCount: '4', monthlyRentPerUnit: '1200' }
  };
  const pf = aggregatePortfolio([deal1, deal2]);
  assert.strictEqual(pf.dealCount, 2);
  assert.strictEqual(pf.totalPurchasePrice, 800000);
  assert.ok(pf.combinedProjections.length === 10);
  assert.ok(typeof pf.blendedYear1CoC === 'number');
  assert.ok(typeof pf.blendedYear1CapRate === 'number');
  assert.ok(typeof pf.equityMultiple === 'number');
  assert.ok(pf.portfolioLtv > 0);
  assert.ok(pf.combinedProjections[0].dscr > 0);

  // Test with quantity multiplier (e.g., 3 single-family units)
  const dealWithQty = {
    assetType: 'single-family',
    quantity: 3,
    inputs: { purchasePrice: '200000', downPaymentPercent: '20', interestRate: '6', loanTerm: '30', monthlyRent: '1800' }
  };
  const pfMulti = aggregatePortfolio([dealWithQty]);
  assert.strictEqual(pfMulti.totalPurchasePrice, 600000);
  assert.strictEqual(pfMulti.totalUnitsOrDoors, 3);
});

runTest('Scenario Variants Generator (Base, Bull, Bear)', () => {
  const { generateScenarioVariants } = require('./math.js');
  const baseInputs = {
    purchasePrice: '300000',
    downPaymentPercent: '20',
    interestRate: '6.5',
    loanTerm: '30',
    monthlyRent: '2500',
    vacancyRate: '5',
    rentGrowthRate: '2',
    appreciationRate: '3'
  };
  const scenarios = generateScenarioVariants('single-family', baseInputs);
  assert.ok(scenarios.base && scenarios.bull && scenarios.bear);
  assert.ok(scenarios.bull.results.irr >= scenarios.base.results.irr, 'Bull IRR should be higher or equal to Base');
  assert.ok(scenarios.bear.results.irr <= scenarios.base.results.irr, 'Bear IRR should be lower or equal to Base');
  assert.ok(parseFloat(scenarios.bull.inputs.monthlyRent) > parseFloat(scenarios.base.inputs.monthlyRent));
  assert.ok(parseFloat(scenarios.bear.inputs.monthlyRent) < parseFloat(scenarios.base.inputs.monthlyRent));
});

runTest('Deal Auditor Risk Detection', () => {
  const { auditDealRisks } = require('./math.js');
  const badInputs = {
    purchasePrice: '500000',
    downPaymentPercent: '5', // High leverage
    interestRate: '9', // High interest
    loanTerm: '30',
    monthlyRent: '1500', // Low rent -> low DSCR
    vacancyRate: '10'
  };
  const res = calculateProjections('single-family', badInputs);
  const risks = auditDealRisks('single-family', badInputs, res);
  assert.ok(risks.length > 0);
  assert.ok(risks.some(r => r.level === 'danger' || r.level === 'warning'));
});

// 8. Session & Inactivity Timeout Tests

runTest('MathTreeSession - Activity recording & remaining time', () => {
  const store = {};
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const MathTreeSession = require('./session.js');

  MathTreeSession.recordActivity();
  const last = MathTreeSession.getLastActivity();
  assert.ok(last > 0);
  assert.strictEqual(MathTreeSession.isTimedOut(), false);

  const remaining = MathTreeSession.getRemainingTime();
  assert.ok(remaining > 0 && remaining <= 30 * 60 * 1000);
});

runTest('MathTreeSession - Timeout detection after 30 minutes', () => {
  const store = {};
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const MathTreeSession = require('./session.js');

  // Set activity to 31 minutes ago
  const thirtyOneMinAgo = Date.now() - (31 * 60 * 1000);
  store['mathtree_last_activity'] = String(thirtyOneMinAgo);

  assert.strictEqual(MathTreeSession.isTimedOut(), true);
  assert.strictEqual(MathTreeSession.getRemainingTime(), 0);

  // Set activity to 20 minutes ago
  const twentyMinAgo = Date.now() - (20 * 60 * 1000);
  store['mathtree_last_activity'] = String(twentyMinAgo);

  assert.strictEqual(MathTreeSession.isTimedOut(), false);
  const remaining = MathTreeSession.getRemainingTime();
  assert.ok(remaining > 9 * 60 * 1000 && remaining <= 10 * 60 * 1000 + 1000);
});

runTest('MathTreeSession - Logout clears session storage and triggers signOut', () => {
  const store = {
    'mathtree_last_activity': String(Date.now()),
    'mathtree_demo_mode': JSON.stringify({ demo: true })
  };
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  let signOutCalled = false;
  const mockSupabase = {
    auth: {
      signOut: () => {
        signOutCalled = true;
        return Promise.resolve();
      }
    }
  };
  const MathTreeSession = require('./session.js');
  MathTreeSession.logout('timeout', mockSupabase);

  assert.strictEqual(store['mathtree_last_activity'], undefined);
  assert.strictEqual(store['mathtree_demo_mode'], undefined);
  assert.strictEqual(signOutCalled, true);
});

runTest('Pitch Deck - project.html exposes openDealPitchDeck & openPitchDeck globally and matches buttons', () => {
  const fs = require('fs');
  const projHtml = fs.readFileSync('project.html', 'utf8');

  // Verify header button exists with ID and onclick handler
  assert.ok(projHtml.includes('id="btn-pitch-deck"'), 'Header pitch deck button should have id="btn-pitch-deck"');
  assert.ok(projHtml.includes('onclick="openDealPitchDeck()"'), 'Header button calls openDealPitchDeck()');

  // Verify global window attachment for openDealPitchDeck
  assert.ok(projHtml.includes('window.openDealPitchDeck = openDealPitchDeck'), 'openDealPitchDeck must be attached to window');
  assert.ok(projHtml.includes('window.openPitchDeck = openPitchDeck'), 'openPitchDeck must be attached to window');
  assert.ok(projHtml.includes('window.closePitchDeck = closePitchDeck'), 'closePitchDeck must be attached to window');

  // Verify modal elements exist
  assert.ok(projHtml.includes('id="pitch-deck-modal"'), 'Modal element must exist in project.html');
  assert.ok(projHtml.includes('id="btn-pitch-close"'), 'Close button must exist in project.html modal');
});

runTest('Pitch Deck - dashboard.html exposes openProjectPitchDeck & openPitchDeck globally with propagation protection', () => {
  const fs = require('fs');
  const dashHtml = fs.readFileSync('dashboard.html', 'utf8');

  // Verify card dropdown pitch deck button stops propagation
  assert.ok(dashHtml.includes("event.stopPropagation(); openProjectPitchDeck('${d.id}')"), 'Dashboard card pitch deck button stops event bubbling');

  // Verify openProjectPitchDeck and openPitchDeck are attached to window
  assert.ok(dashHtml.includes('window.openProjectPitchDeck = openProjectPitchDeck'), 'openProjectPitchDeck must be attached to window');
  assert.ok(dashHtml.includes('window.openPitchDeck = openPitchDeck'), 'openPitchDeck must be attached to window');
  assert.ok(dashHtml.includes('window.closePitchDeck = closePitchDeck'), 'closePitchDeck must be attached to window');

  // Verify modal elements exist
  assert.ok(dashHtml.includes('id="pitch-deck-modal"'), 'Modal element must exist in dashboard.html');
  assert.ok(dashHtml.includes('id="pitch-summary-price"'), 'pitch-summary-price element must exist in dashboard.html');
});

runTest('Zero Equity (0% Down / 100% LTV) - Institutional N/M Return Standards', () => {
  const inputs = {
    purchasePrice: 300000,
    downPaymentPercent: 0,
    interestRate: 4.53,
    loanTerm: 20,
    monthlyRent: 2600,
    expenseRatio: 2,
    vacancyRate: 5,
    appreciationRate: 3
  };
  const results = calculateProjections('single-family', inputs);
  assert.strictEqual(results.initialCashInvested, 0);
  assert.strictEqual(results.isZeroEquity, true);
  assert.strictEqual(results.cashOnCashDisplay, 'N/M');
  assert.strictEqual(results.projections[0].cashOnCashDisplay, 'N/M');
  assert.strictEqual(results.projections[0].isCoCNotMeaningful, true);
  assert.strictEqual(results.irrDisplay, 'N/M (100% Financed)');
  assert.ok(results.projections[0].cashFlow > 0, 'Positive cash flow with zero cash invested');
});

runTest('Amortization Wealth & Holding Period Equity Realization Engine', () => {
  const inputs = {
    purchasePrice: 300000,
    downPaymentPercent: 0,
    interestRate: 4.53,
    loanTerm: 20,
    monthlyRent: 2600,
    expenseRatio: 2,
    vacancyRate: 5,
    appreciationRate: 3
  };
  const results = calculateProjections('single-family', inputs);
  const wealthY1 = calculateHoldingPeriodWealth(inputs, results.projections, results.amortizationSchedule, 1);
  const wealthY2 = calculateHoldingPeriodWealth(inputs, results.projections, results.amortizationSchedule, 2);
  
  assert.ok(wealthY1, 'Holding period wealth must return an object');
  assert.strictEqual(wealthY1.holdYear, 1);
  assert.strictEqual(wealthY1.propertyValue, 300000); // Year 1 base property value
  assert.ok(wealthY1.principalPaydownEquity > 9000, 'Principal paid down in year 1 exceeds 9k');
  assert.ok(Math.abs(wealthY1.totalNetEquity - (wealthY1.propertyValue - wealthY1.remainingLoanBalance)) < 0.01);
  assert.ok(Math.abs(wealthY1.totalNetBenefit - (wealthY1.totalNetEquity + wealthY1.cumulativeCashFlow)) < 0.01);
  assert.strictEqual(wealthY1.totalNetWealth, wealthY1.totalNetBenefit);
  assert.strictEqual(wealthY1.netProfit, wealthY1.totalNetWealth - wealthY1.initialCashInvested);
  assert.ok(wealthY1.totalNetBenefit > 10000, 'Total net wealth in year 1 exceeds 10k');

  // Year 2 has 3% appreciation (309,000)
  assert.strictEqual(wealthY2.holdYear, 2);
  assert.strictEqual(wealthY2.propertyValue, 309000);
  assert.strictEqual(wealthY2.appreciationEquity, 9000);
  assert.ok(wealthY2.totalNetBenefit > 25000, 'Total net benefit in year 2 exceeds 25k');
  assert.strictEqual(wealthY2.totalNetBenefit, wealthY2.totalNetEquity + wealthY2.cumulativeCashFlow);
});

runTest('Amortization Wealth: Total Net Wealth equals Net Owned Equity plus Cumulative Cash Flow with capital outlay profit tracking', () => {
  // Scenario matching user: $300k property, $12k closing/rehab, 0% down
  const inputs = {
    purchasePrice: 300000,
    downPaymentPercent: 0,
    interestRate: 6.5,
    loanTerm: 30,
    grossRentAnnual: 36000,
    expenseRatio: 10,
    closingCosts: 12000
  };

  const res = calculateProjections('commercial', inputs);
  const wealth = calculateHoldingPeriodWealth(inputs, res.projections, res.amortizationSchedule, 1);

  // Total Net Wealth must strictly equal Net Owned Equity + Cumulative Cash Flow
  assert.strictEqual(wealth.totalNetWealth, Math.round((wealth.totalNetEquity + wealth.cumulativeCashFlow) * 100) / 100);
  assert.strictEqual(wealth.totalNetBenefit, wealth.totalNetWealth);

  // Net Profit must strictly equal Total Net Wealth minus Initial Cash Invested ($12k)
  assert.strictEqual(wealth.netProfit, Math.round((wealth.totalNetWealth - wealth.initialCashInvested) * 100) / 100);
  assert.ok(wealth.totalNetWealth > wealth.netProfit, 'Total net wealth exceeds net profit by initial cash invested');
});

runTest('calculateProjections returns identical cashFlow and netCashFlow properties across all projection years', () => {
  const res = calculateProjections('single-family', {
    purchasePrice: 250000,
    downPaymentPercent: 20,
    monthlyRent: 2000,
    expenseRatio: 25,
    interestRate: 6.5,
    loanTerm: 30
  });

  assert.ok(res.projections.length === 10);
  res.projections.forEach((p, idx) => {
    assert.strictEqual(typeof p.cashFlow, 'number', `Year ${idx + 1} cashFlow must be a number`);
    assert.strictEqual(typeof p.netCashFlow, 'number', `Year ${idx + 1} netCashFlow must be a number`);
    assert.strictEqual(p.cashFlow, p.netCashFlow, `Year ${idx + 1} cashFlow and netCashFlow must match exactly`);
  });
});

runTest('Commercial 100% financed (0% Down) yields positive annual cash flow and isZeroEquity true', () => {
  const inputs = {
    purchasePrice: 300000,
    downPaymentPercent: 0,
    interestRate: 6.5,
    loanTerm: 30,
    grossRentAnnual: 26400,
    expenseRatio: 3.5,
    leaseType: 'NNN'
  };
  const res = calculateProjections('commercial', inputs);

  assert.strictEqual(res.isZeroEquity, true);
  assert.strictEqual(res.downPaymentAmount, 0);
  assert.strictEqual(res.loanAmount, 300000);
  assert.strictEqual(res.ltv, 100);

  const y1 = res.projections[0];
  assert.ok(y1.cashFlow > 0, `Year 1 cashFlow must be positive on financed property, got ${y1.cashFlow}`);
  assert.strictEqual(y1.cashFlow, y1.netCashFlow);
  assert.strictEqual(y1.isCoCNotMeaningful, true);
  assert.strictEqual(y1.cashOnCashDisplay, 'N/M');
});

runTest('Dynamic deal metrics recalculation from inputs resolves stale $0 cash flow', () => {
  // Simulate a deal saved in DB or localStorage with stale year1_cashflow: 0
  const staleDeal = {
    id: 'deal-test-stale',
    name: 'Stop and Go Burgers',
    asset_class: 'commercial',
    status: 'owned',
    purchase_price: 300000,
    year1_cashflow: 0, // stale bug value
    cash_on_cash: 0,
    total_equity: 0,
    inputs: {
      purchasePrice: 300000,
      downPaymentPercent: 0,
      interestRate: 6.5,
      loanTerm: 30,
      grossRentAnnual: 26400,
      expenseRatio: 3.5,
      leaseType: 'NNN'
    }
  };

  // Simulate ensureDynamicDealMetrics function
  const res = calculateProjections(staleDeal.asset_class, staleDeal.inputs);
  const p1 = res.projections[0];
  staleDeal.year1_cashflow = p1.cashFlow ?? p1.netCashFlow ?? 0;
  staleDeal.cash_on_cash = p1.cashOnCash ?? 0;
  staleDeal.irr = res.irr;
  staleDeal.equity_multiple = res.equityMultiplier;
  staleDeal.total_equity = res.initialCashInvested;

  assert.ok(staleDeal.year1_cashflow > 2000, `Dynamic calculation must revive cash flow from $0 to >$2,000, got ${staleDeal.year1_cashflow}`);
  assert.strictEqual(staleDeal.total_equity, 0);
});

runTest('Comprehensive underwriting baseline parameters (vacancy, rehab, closing costs, rent growth, appreciation, exit year) affect projections', () => {
  const baseInputs = {
    purchasePrice: 500000,
    downPaymentPercent: 20,
    interestRate: 6.0,
    loanTerm: 30,
    monthlyRent: 4000,
    expenseRatio: 30,
    vacancyRate: 0,
    rehabCosts: 0,
    closingCosts: 0,
    rentGrowth: 0,
    appreciationRate: 0,
    exitYear: 10
  };

  const underwritingInputs = {
    ...baseInputs,
    vacancyRate: 10, // 10% vacancy decreases cash flow
    rehabCosts: 25000, // increases initial cash invested
    closingCosts: 10000, // increases initial cash invested
    rentGrowth: 4, // compound rent growth increases later cash flow
    appreciationRate: 4, // appreciation increases property value & total equity
    exitYear: 5
  };

  const resBase = calculateProjections('single-family', baseInputs);
  const resUnderwritten = calculateProjections('single-family', underwritingInputs);

  // Initial cash invested includes down payment (100k) + rehab (25k) + closing costs (10k) = 135k
  assert.strictEqual(resUnderwritten.initialCashInvested, 100000 + 25000 + 10000);
  assert.strictEqual(resBase.initialCashInvested, 100000);

  // Year 1 cash flow should be lower due to 10% vacancy
  assert.ok(resUnderwritten.projections[0].cashFlow < resBase.projections[0].cashFlow, 'Vacancy must reduce Year 1 cash flow');

  // Total equity at exit must be higher due to 4% annual appreciation
  const exitYearIdx = underwritingInputs.exitYear - 1;
  assert.ok(resUnderwritten.projections[exitYearIdx].propertyValue > baseInputs.purchasePrice, 'Property value at exit must reflect appreciation');
});

runTest('Exit Cap Rate Calculation Method: Amortize Over Hold Period vs Day 1 Immediate Shift', () => {
  const baseCommercial = {
    purchasePrice: 1000000,
    downPaymentPercent: 25,
    interestRate: 6.0,
    loanTerm: 30,
    grossRentAnnual: 100000,
    expenseRatio: 30,
    targetCapRate: 8.0, // Exit cap rate (higher than going-in cap rate of 7.0%)
    exitYear: 5
  };

  // 1. Amortized Spread Method (Default)
  const resAmortized = calculateProjections('commercial', {
    ...baseCommercial,
    exitCapTiming: 'amortized'
  });

  // Year 1 property value equals purchase price ($1,000,000) under amortized mode
  assert.strictEqual(resAmortized.projections[0].propertyValue, 1000000);
  assert.strictEqual(resAmortized.projections[0].capRate, 7.0);

  // Year 5 (Exit Year) cap rate reaches target exit cap rate (8.0%)
  assert.strictEqual(resAmortized.projections[4].capRate, 8.0);

  // 2. Day 1 Immediate Shift Method
  const resDay1 = calculateProjections('commercial', {
    ...baseCommercial,
    exitCapTiming: 'day1'
  });

  // Year 1 property value immediately reflects the exit cap rate ($70,000 NOI / 8.0% = $875,000)
  assert.strictEqual(resDay1.projections[0].capRate, 8.0);
  assert.strictEqual(resDay1.projections[0].propertyValue, 875000);
  assert.ok(resDay1.projections[0].propertyValue < resAmortized.projections[0].propertyValue, 'Day 1 shift with higher exit cap immediately adjusts Year 1 valuation');
});

// 42. Global Investor Profile & Hurdle Rate (Opportunity Cost) Resolution
runTest('Global Investor Profile & Hurdle Rate Hierarchy', () => {
  const Profile = require('./profile.js');
  assert.ok(Profile, 'Profile module should export cleanly');
  assert.strictEqual(Profile.DEFAULT_PROFILE.discountRate, 8.0, 'Default hurdle rate should be 8.0%');
  assert.strictEqual(Profile.DEFAULT_PROFILE.exitYear, 10, 'Default hold period should be 10 years');
  assert.strictEqual(Profile.DEFAULT_PROFILE.exitCapTiming, 'amortized', 'Default exit cap timing should be amortized');

  // Hierarchy test: Deal-level override takes top precedence
  const dealOverride = Profile.resolveHurdleRate(12.5, { discountRate: 10.0 });
  assert.strictEqual(dealOverride, 12.5, 'Deal-level discount rate must override profile setting');

  // Hierarchy test: Profile hurdle rate takes precedence when deal rate not specified
  const profileRate = Profile.resolveHurdleRate(undefined, { discountRate: 10.0 });
  assert.strictEqual(profileRate, 10.0, 'Profile setting must apply when deal rate is undefined');

  // Hierarchy test: Baseline fallback to 8.0% when both are empty
  const defaultRate = Profile.resolveHurdleRate(undefined, null);
  assert.strictEqual(defaultRate, 8.0, 'Fallback to 8.0% when neither deal nor profile specified');
});

// 43. Target Discount Rate / Hurdle Rate (Opportunity Cost) NPV Sensitivity
runTest('Target Discount Rate (Opportunity Cost) impacts Net Present Value (NPV)', () => {
  const baseDeal = {
    purchasePrice: 1000000,
    downPaymentPercent: 25,
    interestRate: 6.0,
    loanTerm: 30,
    grossRentAnnual: 120000,
    expenseRatio: 35,
    exitYear: 10,
    targetCapRate: 7.0
  };

  // Run with 8% discount rate (Core Hurdle)
  const res8 = calculateProjections('commercial', { ...baseDeal, discountRate: 8 });
  // Run with 12% discount rate (High Opportunity Cost Hurdle)
  const res12 = calculateProjections('commercial', { ...baseDeal, discountRate: 12 });
  // Run with 6% discount rate (Low Cost of Capital)
  const res6 = calculateProjections('commercial', { ...baseDeal, discountRate: 6 });

  assert.ok(typeof res8.npv === 'number', 'NPV should be calculated');
  assert.ok(typeof res12.npv === 'number', 'NPV should be calculated');
  assert.ok(typeof res6.npv === 'number', 'NPV should be calculated');

  // Higher discount rate (higher required hurdle / opportunity cost) means future cash flows are worth less today (lower NPV)
  assert.ok(res6.npv > res8.npv, 'Lower discount rate yields higher NPV');
  assert.ok(res8.npv > res12.npv, 'Higher discount rate yields lower NPV');
});

// 44. UI Modal & Input Integrity for Global Profile & Deal Discount Rate
runTest('UI Verification: Discount Rate Input and Investor Profile Modal in dashboard & project', () => {
  const fs = require('fs');
  const dashHtml = fs.readFileSync('./dashboard.html', 'utf8');
  const projHtml = fs.readFileSync('./project.html', 'utf8');

  // Check dashboard.html
  assert.ok(dashHtml.includes('id="btn-open-investor-profile"'), 'dashboard.html must have Profile button in header');
  assert.ok(dashHtml.includes('id="investor-profile-modal"'), 'dashboard.html must have Investor Profile modal');
  assert.ok(dashHtml.includes('id="edit-deal-discount-rate"'), 'dashboard.html must have edit-deal-discount-rate input');
  assert.ok(dashHtml.includes('id="edit-preview-npv"'), 'dashboard.html must display live NPV preview');

  // Check project.html
  assert.ok(projHtml.includes('id="btn-open-investor-profile"'), 'project.html must have Profile button in header');
  assert.ok(projHtml.includes('id="investor-profile-modal"'), 'project.html must have Investor Profile modal');
  assert.ok(projHtml.includes('id="edit-deal-discount-rate"'), 'project.html must have edit-deal-discount-rate input');
  assert.ok(projHtml.includes('id="edit-preview-npv"'), 'project.html must display live NPV preview');
});

// 45. Interest-Only (I/O) Debt Amortization
runTest('Interest-Only (I/O) Financing: $0 Principal Paid in initial years, then amortizes', () => {
  const inputs = {
    purchasePrice: 1000000,
    downPaymentPercent: 20,
    loanAmount: 800000,
    interestRate: 6.0,
    loanTerm: 30,
    financingType: 'interest_only',
    interestOnlyYears: 3,
    grossRentAnnual: 120000,
    expenseRatio: 30
  };

  const results = calculateProjections('commercial', inputs);
  assert.strictEqual(results.financingType, 'interest_only');
  assert.strictEqual(results.interestOnlyYears, 3);

  const p1 = results.projections[0];
  const p2 = results.projections[1];
  const p3 = results.projections[2];
  const p4 = results.projections[3];

  // In Years 1-3, principal paid must be exactly $0
  assert.strictEqual(p1.isInterestOnly, true);
  assert.strictEqual(p1.principalPaid, 0);
  assert.strictEqual(p1.cumulativePrincipalPaid, 0);
  assert.strictEqual(p1.endingDebt, 800000);
  // Monthly payment during I/O is 800000 * 0.06 / 12 = 4000; annual = 48000
  assert.strictEqual(Math.round(p1.annualDebtService), 48000);

  assert.strictEqual(p3.isInterestOnly, true);
  assert.strictEqual(p3.principalPaid, 0);
  assert.strictEqual(p3.cumulativePrincipalPaid, 0);
  assert.strictEqual(p3.endingDebt, 800000);

  // In Year 4 (first amortizing year), principal paid must be > 0 and balance must decrease
  assert.strictEqual(p4.isInterestOnly, false);
  assert.ok(p4.principalPaid > 0, 'Principal paid in Year 4 must be positive');
  assert.ok(p4.endingDebt < 800000, 'Ending debt in Year 4 must be less than original loan');
  assert.strictEqual(p4.cumulativePrincipalPaid, p4.principalPaid);
  // Debt service jumps up to amortize remaining $800k over 27 years
  assert.ok(p4.annualDebtService > 48000, 'Amortizing debt service must exceed interest-only payment');
});

// 46. Adjustable-Rate Mortgage (ARM) Rate Resets
runTest('Adjustable-Rate Mortgage (ARM): Rate adjusts after initial period and caps apply', () => {
  const inputs = {
    purchasePrice: 1000000,
    downPaymentPercent: 20,
    loanAmount: 800000,
    interestRate: 5.0,
    loanTerm: 30,
    financingType: 'arm',
    armInitialYears: 5,
    armAdjustmentRate: 8.0,
    armRateCap: 9.0,
    grossRentAnnual: 120000,
    expenseRatio: 30
  };

  const results = calculateProjections('commercial', inputs);
  assert.strictEqual(results.financingType, 'arm');

  const p5 = results.projections[4]; // Year 5 (last fixed year)
  const p6 = results.projections[5]; // Year 6 (first adjusted year)

  assert.strictEqual(p5.appliedInterestRate, 5.0);
  assert.strictEqual(p5.isArmAdjusted, false);

  assert.strictEqual(p6.appliedInterestRate, 8.0);
  assert.strictEqual(p6.isArmAdjusted, true);
  // Higher interest rate at year 6 must result in higher debt service than year 5
  assert.ok(p6.annualDebtService > p5.annualDebtService, 'Year 6 ARM debt service must increase with higher rate');
});

// 47. Bridge and Seller Financing Structure Tests
runTest('Bridge and Seller Financing structures behave correctly', () => {
  // Bridge loan: full I/O throughout
  const bridgeInputs = {
    purchasePrice: 500000,
    loanAmount: 400000,
    interestRate: 9.0,
    loanTerm: 5,
    financingType: 'bridge',
    grossRentAnnual: 60000,
    expenseRatio: 35
  };
  const bridgeRes = calculateProjections('commercial', bridgeInputs);
  assert.strictEqual(bridgeRes.financingType, 'bridge');
  assert.strictEqual(bridgeRes.projections[0].isInterestOnly, true);
  assert.strictEqual(bridgeRes.projections[0].principalPaid, 0);
  assert.strictEqual(bridgeRes.projections[4].principalPaid, 0);
  assert.strictEqual(bridgeRes.projections[4].endingDebt, 400000);

  // Seller financing: custom rate and terms
  const sellerInputs = {
    purchasePrice: 600000,
    loanAmount: 450000,
    interestRate: 4.5,
    loanTerm: 15,
    financingType: 'seller_financing',
    grossRentAnnual: 70000,
    expenseRatio: 30
  };
  const sellerRes = calculateProjections('commercial', sellerInputs);
  assert.strictEqual(sellerRes.financingType, 'seller_financing');
  assert.strictEqual(sellerRes.projections[0].appliedInterestRate, 4.5);
  assert.ok(sellerRes.projections[0].principalPaid > 0);
});

// 48. Deal Timeline & Milestone UI Element Validation
runTest('UI Verification: Deal Acquisition Timeline Tracker and Financing Selectors in UI', () => {
  const fs = require('fs');
  const dashHtml = fs.readFileSync('./dashboard.html', 'utf8');
  const projHtml = fs.readFileSync('./project.html', 'utf8');

  // Dashboard modal financing selector
  assert.ok(dashHtml.includes('id="edit-deal-financing-type"'), 'dashboard.html must have edit-deal-financing-type');
  assert.ok(dashHtml.includes('id="wiz-financing-type"'), 'dashboard.html must have wiz-financing-type in wizard');

  // Project.html timeline stepper & financing controls
  assert.ok(projHtml.includes('id="deal-timeline-container"'), 'project.html must have deal-timeline-container');
  assert.ok(projHtml.includes('id="deal-stage-badge"'), 'project.html must have deal-stage-badge');
  assert.ok(projHtml.includes('id="select-deal-stage"'), 'project.html must have select-deal-stage');
  assert.ok(projHtml.includes('id="timeline-countdown-pill"'), 'project.html must have timeline-countdown-pill');
  assert.ok(projHtml.includes('id="input-financing-type"'), 'project.html sidebar must have input-financing-type');
  assert.ok(projHtml.includes('id="edit-deal-financing-type"'), 'project.html modal must have edit-deal-financing-type');
  assert.ok(projHtml.includes('Cumulative Paydown'), 'project.html amortization table must include Cumulative Paydown column');
});

// 49. Yakima County GIS & AddressService Unit Tests
runTest('AddressService: SQL LIKE term builder and official portal URL generation', () => {
  const AddressService = require('./address-service.js');
  assert.ok(AddressService, 'AddressService must export cleanly');
  assert.ok(AddressService.YAKIMA_GIS_BASE.includes('maps.yakimacounty.us/server/rest/services'), 'Yakima GIS base must point to official server');
  assert.ok(AddressService.YAKIMA_ASCEND_PORTAL.includes('yes.co.yakima.wa.us/ascend'), 'Yakima Assessor portal must match Ascend Web');

  // Test SQL LIKE builder
  assert.strictEqual(AddressService.buildSqlLikeTerm('128 N 2nd'), '%128%N%2ND%');
  assert.strictEqual(AddressService.buildSqlLikeTerm('Summitview Ave'), '%SUMMITVIEW%AVE%');
  assert.strictEqual(AddressService.buildSqlLikeTerm(''), '%');

  // Test Assessor portal URL generation
  const urlWithApn = AddressService.getYakimaAssessorPortalUrl('19131922484');
  assert.ok(urlWithApn.includes('mParcelID=19131922484'), 'Portal URL should contain parcel ID parameter');

  const defaultPortalUrl = AddressService.getYakimaAssessorPortalUrl('');
  assert.strictEqual(defaultPortalUrl, 'https://yes.co.yakima.wa.us/ascend/');
});

// 50. UI Verification: Address Autocomplete & Yakima Assessor Card
runTest('UI Verification: Address Autocomplete and Yakima Assessor Card in dashboard and project', () => {
  const fs = require('fs');
  const dashHtml = fs.readFileSync('./dashboard.html', 'utf8');
  const projHtml = fs.readFileSync('./project.html', 'utf8');

  // Script tags
  assert.ok(dashHtml.includes('src="address-service.js"'), 'dashboard.html must include address-service.js');
  assert.ok(projHtml.includes('src="address-service.js"'), 'project.html must include address-service.js');

  // Dashboard Wizard & Modal elements
  assert.ok(dashHtml.includes('id="wiz-address-dropdown"'), 'dashboard.html must have wiz-address-dropdown');
  assert.ok(dashHtml.includes('id="wiz-yakima-assessor-card"'), 'dashboard.html must have wiz-yakima-assessor-card');
  assert.ok(dashHtml.includes('id="wiz-assessor-apn-badge"'), 'dashboard.html must have wiz-assessor-apn-badge');
  assert.ok(dashHtml.includes('id="wiz-assessor-portal-link"'), 'dashboard.html must have wiz-assessor-portal-link');
  assert.ok(dashHtml.includes('id="edit-address-dropdown"'), 'dashboard.html must have edit-address-dropdown');

  // Project page elements
  assert.ok(projHtml.includes('id="header-apn-badge"'), 'project.html must have header-apn-badge');
  assert.ok(projHtml.includes('id="proj-edit-address-dropdown"'), 'project.html must have proj-edit-address-dropdown');
});

// 51. Multi-Parcel Package Aggregation Math
runTest('AddressService: aggregateParcelPackage mathematical summation of multi-parcel acquisitions', () => {
  const AddressService = require('./address-service.js');
  const parcels = [
    { apn: '19131922484', acres: 0.54, marketLandValue: 120000, marketImprovementValue: 180000, included: true },
    { apn: '19131922485', acres: 0.25, marketLandValue: 50000, marketImprovementValue: 0, included: true },
    { apn: '19131922486', acres: 0.40, marketLandValue: 75000, marketImprovementValue: 25000, included: false } // excluded
  ];

  const pkg = AddressService.aggregateParcelPackage(parcels);
  assert.strictEqual(pkg.totalParcels, 2, 'Only included parcels counted in package');
  assert.strictEqual(pkg.totalAcres, 0.79, 'Combined acreage correctly summed');
  assert.strictEqual(pkg.totalSqFt, Math.round(0.79 * 43560), 'Combined sqft calculated from acres');
  assert.strictEqual(pkg.totalLandValue, 170000, 'Combined land value summed');
  assert.strictEqual(pkg.totalImprovementValue, 180000, 'Combined improvement value summed');
  assert.strictEqual(pkg.totalAssessedValue, 350000, 'Combined assessed value summed');
  assert.strictEqual(pkg.parcels.length, 2, 'Parcels array contains active parcels');

  // Test empty/null edge case
  const emptyPkg = AddressService.aggregateParcelPackage([]);
  assert.strictEqual(emptyPkg.totalParcels, 0);
  assert.strictEqual(emptyPkg.totalAssessedValue, 0);
});

// 52. 30-Day GIS Cache Freshness TTL Validator
runTest('AddressService: isGisDataStale correctly enforces 30-day cache retention', () => {
  const AddressService = require('./address-service.js');

  // Never synced or null
  assert.strictEqual(AddressService.isGisDataStale(null), true, 'Null timestamp is stale');
  assert.strictEqual(AddressService.isGisDataStale(undefined), true, 'Undefined timestamp is stale');
  assert.strictEqual(AddressService.isGisDataStale('invalid-date'), true, 'Invalid date string is stale');

  // Synced today (0 days old)
  const today = new Date().toISOString();
  assert.strictEqual(AddressService.isGisDataStale(today), false, 'Synced today is fresh');

  // Synced 15 days ago (fresh, under 30 days)
  const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(AddressService.isGisDataStale(fifteenDaysAgo), false, '15 days ago is fresh');

  // Synced 31 days ago (stale, over 30 days)
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(AddressService.isGisDataStale(thirtyOneDaysAgo), true, '31 days ago is stale');

  // Custom threshold (e.g. 7 days)
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(AddressService.isGisDataStale(tenDaysAgo, 7), true, '10 days ago is stale when threshold is 7');
  assert.strictEqual(AddressService.isGisDataStale(tenDaysAgo, 14), false, '10 days ago is fresh when threshold is 14');
});

// 53. UI Verification: Multi-Parcel Panel in dashboard.html
runTest('UI Verification: Multi-Parcel Acquisition Panel and Package Aggregators in dashboard.html', () => {
  const fs = require('fs');
  const dashHtml = fs.readFileSync('./dashboard.html', 'utf8');

  assert.ok(dashHtml.includes('id="wiz-multi-parcel-panel"'), 'dashboard.html must contain wiz-multi-parcel-panel');
  assert.ok(dashHtml.includes('id="wiz-multi-parcel-list"'), 'dashboard.html must contain wiz-multi-parcel-list');
  assert.ok(dashHtml.includes('id="wiz-pkg-count"'), 'dashboard.html must contain wiz-pkg-count');
  assert.ok(dashHtml.includes('id="wiz-pkg-total-acres"'), 'dashboard.html must contain wiz-pkg-total-acres');
  assert.ok(dashHtml.includes('id="wiz-pkg-total-assessed"'), 'dashboard.html must contain wiz-pkg-total-assessed');
  assert.ok(dashHtml.includes('detectNearbySameOwnerParcels'), 'dashboard.html must call detectNearbySameOwnerParcels');
  assert.ok(dashHtml.includes('aggregateParcelPackage'), 'dashboard.html must call aggregateParcelPackage');
  assert.ok(dashHtml.includes('applyAssessedValueToWizard'), 'dashboard.html must have applyAssessedValueToWizard function');
});

// 54. UI Verification: 30-Day GIS Cache Sync Badge and Force-Refresh in project.html
runTest('UI Verification: 30-Day GIS Cache Sync Badge and Force-Refresh Controller in project.html', () => {
  const fs = require('fs');
  const projHtml = fs.readFileSync('./project.html', 'utf8');

  assert.ok(projHtml.includes('id="header-gis-sync-badge"'), 'project.html must have header-gis-sync-badge');
  assert.ok(projHtml.includes('id="header-gis-sync-text"'), 'project.html must have header-gis-sync-text');
  assert.ok(projHtml.includes('forceRefreshCountyGis'), 'project.html must have forceRefreshCountyGis function');
  assert.ok(projHtml.includes('isGisDataStale'), 'project.html must check isGisDataStale');
});

const PropertyMath = require('./math.js');

// 55. Dynamic Holding Period: Default 10-Year Backwards Compatibility
runTest('Holding Period: Defaults to 10 years when omitted across single-family and commercial', () => {
  const sfInputs = {
    purchasePrice: 400000,
    downPaymentPercent: 20,
    interestRate: 6.5,
    loanTerm: 30,
    monthlyRent: 2800,
    vacancyRate: 5,
    expenseRatio: 30
  };
  const res = PropertyMath.calculateProjections('single-family', sfInputs);
  assert.strictEqual(res.projections.length, 10, 'Projections default to 10 years');
  assert.strictEqual(res.amortizationSchedule.length, 10, 'Amortization schedule defaults to 10 years');
});

// 56. Dynamic Holding Period: 15-Year Horizon Generates 15 Projection Rows
runTest('Holding Period: 15-Year horizon generates 15 projection rows and terminal equity', () => {
  const sfInputs = {
    purchasePrice: 500000,
    downPaymentPercent: 25,
    interestRate: 6.0,
    loanTerm: 30,
    monthlyRent: 3500,
    holdingPeriod: 15
  };
  const res = PropertyMath.calculateProjections('single-family', sfInputs);
  assert.strictEqual(res.projections.length, 15, 'Projections array contains 15 years');
  assert.strictEqual(res.projections[14].year, 15, 'Year 15 exists as final year');
  assert.ok(res.projections[14].equity > res.projections[0].equity, 'Equity increases by Year 15');
});

// 57. Dynamic Holding Period: 30-Year Hold with 15-Year Loan Amortization Payoff
runTest('Holding Period: 30-Year hold with 15-year loan zeroes debt service after year 15', () => {
  const inputs = {
    purchasePrice: 600000,
    downPaymentPercent: 20,
    interestRate: 5.5,
    loanTerm: 15, // 15-year mortgage
    monthlyRent: 4500,
    holdingPeriod: 30
  };
  const res = PropertyMath.calculateProjections('single-family', inputs);
  assert.strictEqual(res.projections.length, 30, 'Generates full 30-year projection');
  
  // Year 15 has active mortgage payment
  assert.ok(res.projections[14].debtService > 0, 'Year 15 has active debt service');
  assert.ok(res.projections[14].loanBalanceRemaining >= 0, 'Year 15 loan is paid down');

  // Years 16 to 30 must have $0 debt service and $0 remaining balance
  for (let y = 16; y <= 30; y++) {
    const proj = res.projections[y - 1];
    assert.strictEqual(proj.debtService, 0, `Year ${y} debt service is zero post-payoff`);
    assert.strictEqual(proj.loanBalanceRemaining, 0, `Year ${y} loan balance is zero`);
    assert.strictEqual(proj.equity, proj.propertyValue, `Year ${y} equity equals 100% of property value`);
    assert.strictEqual(proj.cashFlow, proj.netOperatingIncome, `Year ${y} cash flow equals full NOI`);
  }
});

// 58. Dynamic Holding Period: 27.5-Year Residential MACRS Tax Depreciation Exhaustion
runTest('Holding Period: 27.5-Year MACRS residential depreciation exhausts in Year 28 and zeroes in Years 29-30', () => {
  const inputs = {
    purchasePrice: 1000000,
    downPaymentPercent: 25,
    interestRate: 6.0,
    loanTerm: 30,
    monthlyRent: 8000,
    holdingPeriod: 30,
    landValuePercent: 20, // $200k land, $800k depreciable building
    marginalTaxRate: 35,
    costSegregation: false
  };
  const baseRes = PropertyMath.calculateProjections('multi-unit', inputs);
  const taxRes = PropertyMath.calculateTaxAndDepreciation('multi-unit', inputs, baseRes);

  assert.strictEqual(taxRes.yearlyTaxDetails.length, 30, 'Tax details generated for all 30 years');

  // Total depreciable basis is $800,000. Annual straight-line is $800,000 / 27.5 = $29,090.91
  // Years 1 through 27 have full depreciation
  assert.strictEqual(taxRes.yearlyTaxDetails[0].depreciation, 29090.91);
  assert.strictEqual(taxRes.yearlyTaxDetails[26].depreciation, 29090.91);

  // Year 28 has the remaining half-year ($14,545.45)
  assert.strictEqual(taxRes.yearlyTaxDetails[27].depreciation, 14545.45);

  // Years 29 and 30 must have $0 depreciation (fully exhausted)
  assert.strictEqual(taxRes.yearlyTaxDetails[28].depreciation, 0, 'Year 29 depreciation is $0');
  assert.strictEqual(taxRes.yearlyTaxDetails[29].depreciation, 0, 'Year 30 depreciation is $0');
});

// 59. UI Verification: 30-Year Holding Period Controls, Chips, and Titles
runTest('UI Verification: Holding period inputs accept up to 30 years with chips and table title updates', () => {
  const fs = require('fs');
  const projHtml = fs.readFileSync('./project.html', 'utf8');
  const dashHtml = fs.readFileSync('./dashboard.html', 'utf8');

  // project.html verification
  assert.ok(projHtml.includes('id="input-exit-year" name="exitYear"'), 'project.html has input-exit-year');
  assert.ok(projHtml.includes('max="30" id="input-exit-year"'), 'input-exit-year has max="30"');
  assert.ok(projHtml.includes('setHoldPeriod(30)'), 'project.html includes 30Y preset chip');
  assert.ok(projHtml.includes('id="holding-period-pill"'), 'project.html has holding-period-pill');
  assert.ok(projHtml.includes('id="forecast-table-title"'), 'project.html has forecast-table-title');
  assert.ok(projHtml.includes('id="amortization-table-title"'), 'project.html has amortization-table-title');

  // dashboard.html verification
  assert.ok(dashHtml.includes('id="prof-exit-year" min="1" max="30"'), 'dashboard.html prof-exit-year has max="30"');
  assert.ok(dashHtml.includes('id="edit-deal-exit-year" min="1" max="30"'), 'dashboard.html edit-deal-exit-year has max="30"');
});

// 60. Projection Start Year Dynamic Resolution Logic
runTest('Projection Start Year: Dynamically resolves from closingDate, loiDate, or current calendar year', () => {
  function resolveStartYear(dealInputs, formValues = {}) {
    const inputs = dealInputs || {};
    const closeVal = inputs.closingDate || formValues.closingDate;
    const loiVal = inputs.loiDate || formValues.loiDate;
    const dateStr = closeVal || loiVal;
    if (dateStr) {
      const match = String(dateStr).match(/(\d{4})/);
      if (match) {
        const yr = parseInt(match[1], 10);
        if (yr >= 1900 && yr <= 2150) return yr;
      }
      const d = new Date(dateStr);
      if (!isNaN(d.getFullYear()) && d.getFullYear() >= 1900) return d.getFullYear();
    }
    return new Date().getFullYear();
  }

  // Case 1: Target Closing Date provided (YYYY-MM-DD)
  assert.strictEqual(resolveStartYear({ closingDate: '2026-08-15' }), 2026);

  // Case 2: Target Closing Date in MM/DD/YYYY format
  assert.strictEqual(resolveStartYear({ closingDate: '07/15/2027' }), 2027);

  // Case 3: LOI Date provided when closing date is absent
  assert.strictEqual(resolveStartYear({ loiDate: '2025-06-18' }), 2025);

  // Case 4: Target closing date takes precedence over LOI date
  assert.strictEqual(resolveStartYear({ closingDate: '2028-01-01', loiDate: '2027-12-15' }), 2028);

  // Case 5: Empty values fall back to current calendar year
  assert.strictEqual(resolveStartYear({}), new Date().getFullYear());
});

// 61. UI Verification: Calendar Date-First Displays and Headers in project.html
runTest('UI Verification: project.html displays calendar dates primarily across tables, charts, inspector, and timeline', () => {
  const fs = require('fs');
  const projHtml = fs.readFileSync('./project.html', 'utf8');

  // Table Headers updated to "Date / Period"
  assert.ok(projHtml.includes('<th class="py-3 px-5">Date / Period</th>'), 'Detailed forecast table header is Date / Period');
  assert.ok(projHtml.includes('<th class="py-2.5 px-5">Date / Period</th>'), 'Amortization table header is Date / Period');
  assert.ok(projHtml.includes('<th class="py-2.5 px-4">Date / Period</th>'), 'Tax breakdown table header is Date / Period');

  // getProjectionStartYear function defined and exposed globally
  assert.ok(projHtml.includes('function getProjectionStartYear()'), 'getProjectionStartYear function is defined');
  assert.ok(projHtml.includes('window.getProjectionStartYear = getProjectionStartYear'), 'getProjectionStartYear exposed on window');

  // Dynamic Inspector & Slider Labels updated with calendar dates
  assert.ok(projHtml.includes('id="slider-min-label"'), 'Slider has slider-min-label');
  assert.ok(projHtml.includes('id="slider-max-label"'), 'Slider has slider-max-label');
  assert.ok(projHtml.includes('currentCalYear = startYr + targetYearInput - 1'), 'Inspector calculates current calendar year');

  // Projections & Amortization tables render calendar year primarily
  assert.ok(projHtml.includes('calYear = startYr + proj.year - 1'), 'renderProjectionsTable computes calYear');
  assert.ok(projHtml.includes('calYear = startYr + row.year - 1'), 'renderAmortizationTable computes calYear');

  // Projections Chart X-axis labels use calendar year
  assert.ok(projHtml.includes('labels = projections.map(p => `${startYr + p.year - 1} (Yr ${p.year})`)'), 'Chart labels use calendar year');

  // Wealth Realization Studio uses calendar year
  assert.ok(projHtml.includes('calYr = startYr + y - 1'), 'Wealth studio dropdown computes calendar year');
  assert.ok(projHtml.includes('holdCalYr = startYr + holdYear - 1'), 'Wealth studio narrative computes hold calendar year');

  // Milestone date change triggers recalculation of dates across page
  assert.ok(projHtml.includes("if (field === 'closingDate' || field === 'loiDate')"), 'updateMilestoneDate checks for date changes');
  assert.ok(projHtml.includes("if (typeof updateCalculations === 'function') updateCalculations()"), 'updateMilestoneDate triggers updateCalculations');
});

console.log(`\n--- Unit Test Suite Completed ---`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}


