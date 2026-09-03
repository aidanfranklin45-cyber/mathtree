const assert = require('assert');
const { calculateProjections, calculateMonthlyPayment, calculateRemainingBalance } = require('./math.js');

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

console.log(`\n--- Unit Test Suite Completed ---`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

