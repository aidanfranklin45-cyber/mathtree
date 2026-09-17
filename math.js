/**
 * math.js - Lightweight UI Slider & Mortgage Math Utilities
 * Heavy multi-year proforma projections and portfolio calculations are migrated to Supabase Edge Functions.
 */

// Helper to compute monthly mortgage payment for UI sliders & interactive inputs
function calculateMonthlyPayment(loanAmount, annualRate, termYears) {
  if (loanAmount <= 0 || termYears <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loanAmount / n;
  return loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Helper to compute remaining loan balance after elapsed years
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

// Helper to compute annual amortization schedule for UI tables & graphs
function getAnnualAmortization(loanAmount, annualRate, termYears, options = {}) {
  const schedule = [];
  const finType = String(options.financingType || 'fixed').toLowerCase();
  const armInitial = parseInt(options.armInitialYears || 5, 10);
  const armAdjRate = options.armAdjustmentRate !== undefined ? parseFloat(options.armAdjustmentRate) : (annualRate + 1.5);
  const armCap = options.armRateCap !== undefined ? parseFloat(options.armRateCap) : (annualRate + 4.0);
  const ioYears = parseInt(options.interestOnlyYears !== undefined ? options.interestOnlyYears : (finType === 'interest_only' ? 3 : 0), 10);
  const holdYears = parseInt(options.holdingPeriod || options.exitYear || options.holdYears || 10, 10);
  const maxYears = Math.max(1, Math.min(30, isNaN(holdYears) ? 10 : holdYears));
  const firstYearMonths = (options.firstYearMonths && options.firstYearMonths >= 1 && options.firstYearMonths <= 12) ? parseInt(options.firstYearMonths, 10) : 12;

  if (loanAmount <= 0 || termYears <= 0) {
    for (let year = 1; year <= maxYears; year++) {
      schedule.push({
        year,
        appliedRate: annualRate,
        isInterestOnly: false,
        isArmAdjusted: false,
        beginningBalance: 0,
        totalPayment: 0,
        principalPaid: 0,
        interestPaid: 0,
        endingBalance: 0,
        cumulativePrincipalPaid: 0,
        operatingMonths: year === 1 ? firstYearMonths : 12
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
    const monthsInThisYear = (year === 1) ? firstYearMonths : 12;

    if (currentBalance <= 0 || year > termYears) {
      schedule.push({
        year,
        appliedRate: annualRate,
        isInterestOnly: false,
        isArmAdjusted: false,
        beginningBalance: 0,
        totalPayment: 0,
        principalPaid: 0,
        interestPaid: 0,
        endingBalance: 0,
        cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100,
        operatingMonths: monthsInThisYear
      });
      continue;
    }

    let yearRate = annualRate;
    let isArmAdjusted = false;
    if (finType === 'arm' && year > armInitial) {
      yearRate = Math.min(armCap, Math.max(0, armAdjRate));
      isArmAdjusted = true;
    }

    let isInterestOnly = false;
    if (finType === 'interest_only' && year <= ioYears) {
      isInterestOnly = true;
    }

    const monthlyRate = yearRate / 100 / 12;
    for (let m = 1; m <= monthsInThisYear; m++) {
      if (currentBalance <= 0) break;
      const monthInterest = currentBalance * monthlyRate;
      let monthPrincipal = 0;

      if (isInterestOnly) {
        monthPrincipal = 0;
      } else {
        const remainingMonths = Math.max(1, (termYears - (year - 1)) * 12 - (m - 1));
        const monthPayment = calculateMonthlyPayment(currentBalance, yearRate, remainingMonths / 12);
        monthPrincipal = monthPayment - monthInterest;
        if (monthPrincipal > currentBalance) {
          monthPrincipal = currentBalance;
        }
      }

      currentBalance = Math.max(0, currentBalance - monthPrincipal);
      principalPaidThisYear += monthPrincipal;
      interestPaidThisYear += monthInterest;
      totalPaymentThisYear += (monthPrincipal + monthInterest);
    }

    cumulativePrincipal += principalPaidThisYear;

    schedule.push({
      year,
      appliedRate: Math.round(yearRate * 100) / 100,
      isInterestOnly,
      isArmAdjusted,
      beginningBalance: Math.round(startBalance * 100) / 100,
      totalPayment: Math.round(totalPaymentThisYear * 100) / 100,
      principalPaid: Math.round(principalPaidThisYear * 100) / 100,
      interestPaid: Math.round(interestPaidThisYear * 100) / 100,
      endingBalance: Math.max(0, Math.round(currentBalance * 100) / 100),
      cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100,
      operatingMonths: monthsInThisYear
    });
  }

  return schedule;
}

// Helper to compute a month-by-month amortization schedule
function getMonthlyAmortization(loanAmount, annualRate, termYears, options = {}) {
  const schedule = [];
  if (loanAmount <= 0 || termYears <= 0) return schedule;

  const totalMonths = parseInt(options.totalMonths || ((options.holdingPeriod || 10) * 12), 10);
  const finType = String(options.financingType || 'fixed').toLowerCase();
  const armInitialMonths = parseInt(options.armInitialYears || 5, 10) * 12;
  const armAdjRate = options.armAdjustmentRate !== undefined ? parseFloat(options.armAdjustmentRate) : (annualRate + 1.5);
  const armCap = options.armRateCap !== undefined ? parseFloat(options.armRateCap) : (annualRate + 4.0);
  const ioMonths = parseInt(options.interestOnlyYears !== undefined ? options.interestOnlyYears : (finType === 'interest_only' ? 3 : 0), 10) * 12;

  let currentBalance = loanAmount;
  let cumulativePrincipal = 0;
  let cumulativeInterest = 0;

  for (let m = 1; m <= totalMonths; m++) {
    const startBal = currentBalance;
    if (currentBalance <= 0 || m > (termYears * 12)) {
      schedule.push({
        month: m,
        appliedRate: annualRate,
        isInterestOnly: false,
        beginningBalance: 0,
        payment: 0,
        principalPaid: 0,
        interestPaid: 0,
        endingBalance: 0,
        cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100,
        cumulativeInterestPaid: Math.round(cumulativeInterest * 100) / 100
      });
      continue;
    }

    let monthRate = annualRate;
    if (finType === 'arm' && m > armInitialMonths) {
      monthRate = Math.min(armCap, Math.max(0, armAdjRate));
    }

    let isIO = false;
    if (finType === 'interest_only' && m <= ioMonths) isIO = true;
    else if (finType === 'bridge') isIO = true;
    else if (finType === 'seller_financing' && ioMonths > 0 && m <= ioMonths) isIO = true;

    const r = monthRate / 100 / 12;
    let payment = 0;
    let interestPaid = 0;
    let principalPaid = 0;

    if (isIO) {
      interestPaid = currentBalance * r;
      principalPaid = 0;
      payment = interestPaid;
    } else {
      const remainingMonths = Math.max(1, (termYears * 12) - (m - 1));
      payment = calculateMonthlyPayment(currentBalance, monthRate, remainingMonths / 12);
      interestPaid = r === 0 ? 0 : currentBalance * r;
      principalPaid = payment - interestPaid;
      if (currentBalance < principalPaid) {
        principalPaid = currentBalance;
        payment = principalPaid + interestPaid;
      }
      currentBalance = Math.max(0, currentBalance - principalPaid);
    }

    cumulativePrincipal += principalPaid;
    cumulativeInterest += interestPaid;

    schedule.push({
      month: m,
      appliedRate: Math.round(monthRate * 100) / 100,
      isInterestOnly: isIO,
      beginningBalance: Math.round(startBal * 100) / 100,
      payment: Math.round(payment * 100) / 100,
      principalPaid: Math.round(principalPaid * 100) / 100,
      interestPaid: Math.round(interestPaid * 100) / 100,
      endingBalance: Math.round(currentBalance * 100) / 100,
      cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100,
      cumulativeInterestPaid: Math.round(cumulativeInterest * 100) / 100
    });
  }

  return schedule;
}

// Authoritative calculation delegator that invokes Supabase Edge Function RPC and syncs useDealStore
function calculateProjections(assetType, inputs) {
  inputs = inputs || {};
  var SUPABASE_URL = 'https://bgexwcepwbxvhxbpblhd.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnZXh3Y2Vwd2J4dmh4YnBibGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0MjczMzQsImV4cCI6MjA0MTAwMzMzNH0.fP8d22yY5X4d34V517xS3Z45Y2Z5X1d34V517xS3Z44';

  var calcPromise;
  if (typeof window !== 'undefined' && window.MathTreeClient && typeof window.MathTreeClient.calculateProjections === 'function') {
    calcPromise = window.MathTreeClient.calculateProjections(assetType, inputs);
  } else if (typeof fetch === 'function') {
    calcPromise = fetch(SUPABASE_URL + '/functions/v1/edit-property-inputs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        action: 'calculate_projections',
        assetType: assetType || 'commercial',
        inputs: inputs
      })
    }).then(function(res) {
      if (!res.ok) throw new Error('Edge Function HTTP error (' + res.status + ')');
      return res.json();
    });
  } else {
    calcPromise = Promise.resolve({ success: false, error: 'Network client unavailable' });
  }

  return calcPromise.then(function(res) {
    if (res && typeof window !== 'undefined' && window.__dealStore) {
      if (typeof window.__dealStore.syncDeal === 'function' && (res.deal || res)) {
        window.__dealStore.syncDeal(res.deal || res);
      }
      if (typeof window.__dealStore.syncMetrics === 'function' && res.metrics) {
        window.__dealStore.syncMetrics(res.metrics);
      }
    }
    return res;
  }).catch(function(err) {
    console.warn('[PropertyMath] calculateProjections RPC notice:', err);
    if (typeof window !== 'undefined' && window.MathTreeClient && typeof window.MathTreeClient.showNetworkErrorNotification === 'function') {
      window.MathTreeClient.showNetworkErrorNotification('Server calculation failed: ' + (err.message || 'Edge Function unreachable.'));
    }
    throw err;
  });
}

function calculateMonthlyProjections(assetType, inputs, options) {
  inputs = inputs || {};
  options = options || {};
  if (typeof window !== 'undefined' && window.MathTreeClient && typeof window.MathTreeClient.calculateMonthlyProjections === 'function') {
    return window.MathTreeClient.calculateMonthlyProjections(assetType, inputs, options);
  }
  var SUPABASE_URL = 'https://bgexwcepwbxvhxbpblhd.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnZXh3Y2Vwd2J4dmh4YnBibGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0MjczMzQsImV4cCI6MjA0MTAwMzMzNH0.fP8d22yY5X4d34V517xS3Z45Y2Z5X1d34V517xS3Z44';
  return fetch(SUPABASE_URL + '/functions/v1/edit-property-inputs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
    },
    body: JSON.stringify({
      action: 'calculate_monthly_projections',
      assetType: assetType || 'commercial',
      inputs: inputs,
      options: options
    })
  }).then(function(res) {
    if (!res.ok) throw new Error('Edge Function HTTP error (' + res.status + ')');
    return res.json();
  });
}

function calculateHoldingPeriodWealth(inputs, projections, amortizationSchedule, holdYear) {
  if (!projections || projections.length === 0) return null;
  var year = Math.max(1, Math.min(projections.length, parseInt(holdYear, 10) || 1));
  var yearIdx = year - 1;
  var proj = projections[yearIdx];
  var purchasePrice = parseFloat(inputs.purchasePrice) || 0;
  var downPaymentPercent = isNaN(parseFloat(inputs.downPaymentPercent)) ? 25 : parseFloat(inputs.downPaymentPercent);
  var downPaymentAmount = purchasePrice * (downPaymentPercent / 100);
  var initialCashInvested = downPaymentAmount + (parseFloat(inputs.rehabCosts) || 0) + (parseFloat(inputs.closingCosts) || 0);
  var initialLoan = Math.max(0, purchasePrice - downPaymentAmount);

  var currentPropertyValue = proj ? proj.propertyValue : purchasePrice;
  var remainingLoanBalance = proj ? proj.loanBalanceRemaining : initialLoan;

  var principalPaydownEquity = Math.max(0, initialLoan - remainingLoanBalance);
  var appreciationEquity = Math.max(0, currentPropertyValue - purchasePrice);
  var totalNetEquity = Math.max(0, currentPropertyValue - remainingLoanBalance);

  var cumulativeCashFlow = 0;
  for (var i = 0; i <= yearIdx; i++) {
    cumulativeCashFlow += (projections[i] ? projections[i].cashFlow : 0);
  }

  var totalNetWealth = totalNetEquity + cumulativeCashFlow;
  var netProfit = totalNetWealth - initialCashInvested;
  var totalNetBenefit = totalNetWealth;

  var prevEquity = yearIdx === 0 ? initialCashInvested : (projections[yearIdx - 1] ? projections[yearIdx - 1].equity : 0);
  var currentCashFlow = proj ? proj.cashFlow : 0;
  var roe = prevEquity > 0 ? (currentCashFlow / prevEquity) * 100 : null;
  var roeDisplay = roe !== null ? roe.toFixed(2) + '%' : 'N/M';

  var discountRate = isNaN(parseFloat(inputs.discountRate)) ? 8 : parseFloat(inputs.discountRate);
  var holdNpv = -initialCashInvested;
  for (var t = 1; t <= year; t++) {
    var cf = projections[t - 1] ? projections[t - 1].cashFlow : 0;
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
    isDeficit: cumulativeCashFlow < 0,
    cashDeficit: cumulativeCashFlow < 0 ? Math.round(Math.abs(cumulativeCashFlow) * 100) / 100 : 0,
    totalNetBenefit: Math.round(totalNetBenefit * 100) / 100,
    totalNetWealth: Math.round(totalNetWealth * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    currentCashFlow: Math.round(currentCashFlow * 100) / 100,
    roe: roe !== null ? Math.round(roe * 100) / 100 : null,
    roeDisplay: roeDisplay,
    holdNpv: Math.round(holdNpv * 100) / 100
  };
}

function auditDealRisks(assetType, inputs, res) {
  var risks = [];
  if (!res || !res.projections || res.projections.length === 0) return risks;
  var dscrValues = res.projections.map(function(p) { return p.dscr; }).filter(function(d) { return d !== null && d !== undefined; });
  if (dscrValues.length > 0) {
    var minDscr = Math.min.apply(Math, dscrValues);
    if (minDscr < 1.0) {
      risks.push({ level: 'danger', title: 'Critical Debt Service Risk (Min DSCR: ' + minDscr.toFixed(2) + 'x)', description: 'Net operating income fails to cover scheduled debt service.' });
    } else if (minDscr < 1.25) {
      risks.push({ level: 'warning', title: 'Tight Debt Coverage (Min DSCR: ' + minDscr.toFixed(2) + 'x)', description: 'Adequate but sensitive to minor vacancy spikes.' });
    } else {
      risks.push({ level: 'safe', title: 'Healthy Debt Coverage (Min DSCR: ' + minDscr.toFixed(2) + 'x)', description: 'Strong cash flow margin protecting against mortgage default.' });
    }
  }
  return risks;
}

function getBenchmarkCapRateRange(assetType, tier, pClass) {
  return { min: 5.5, max: 7.5 };
}

(function () {
  var target = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  target.PropertyMath = {
    calculateMonthlyPayment: calculateMonthlyPayment,
    calculateRemainingBalance: calculateRemainingBalance,
    getAnnualAmortization: getAnnualAmortization,
    getMonthlyAmortization: getMonthlyAmortization,
    calculateProjections: calculateProjections,
    calculateMonthlyProjections: calculateMonthlyProjections,
    calculateHoldingPeriodWealth: calculateHoldingPeriodWealth,
    auditDealRisks: auditDealRisks,
    getBenchmarkCapRateRange: getBenchmarkCapRateRange
  };
  if (typeof window !== 'undefined') {
    window.PropertyMath = target.PropertyMath;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = target.PropertyMath;
  }
})();