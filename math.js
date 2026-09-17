/**
 * math.js - Lightweight UI Slider & Mortgage Math Utilities
 * Heavy multi-year proforma projections and portfolio calculations are migrated to Supabase Edge Functions.
 */

// Helper to compute monthly mortgage payment for UI sliders & interactive inputs
export function calculateMonthlyPayment(loanAmount, annualRate, termYears) {
  if (loanAmount <= 0 || termYears <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loanAmount / n;
  return loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Helper to compute remaining loan balance after elapsed years
export function calculateRemainingBalance(loanAmount, annualRate, termYears, elapsedYears) {
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
export function getAnnualAmortization(loanAmount, annualRate, termYears, options = {}) {
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
export function getMonthlyAmortization(loanAmount, annualRate, termYears, options = {}) {
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

(function () {
  var target = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
  target.PropertyMath = {
    calculateMonthlyPayment,
    calculateRemainingBalance,
    getAnnualAmortization,
    getMonthlyAmortization
  };
  if (typeof window !== 'undefined') {
    window.PropertyMath = target.PropertyMath;
  }
})();