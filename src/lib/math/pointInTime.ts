import type { DealRecord, DealMetrics } from './types';

export interface PointInTimeMetrics {
  currentVal: number;
  currentDebt: number;
  currentEquity: number;
  currentCashFlow: number;
  currentNoi: number;
  currentDebtService: number;
  irr: number;
  ltv: number;
  monthsElapsed: number;
  label: 'Acquisition' | 'Current Value';
  baseLoanAmount: number;
  monthlyPayment: number;
  accumulatedPrincipal: number;
  holdYear: number;
}

export interface MonthlyAmortizationEntry {
  month: number;
  calendarDate: string;
  beginningBalance: number;
  payment: number;
  principal: number;
  interest: number;
  endingBalance: number;
  cumulativePrincipal: number;
  cumulativeInterest: number;
  estimatedValue: number;
  estimatedEquity: number;
  ltv: number;
}

/**
 * Continuous Month-by-Month Financial Calculation Resolver
 *
 * Dynamically computes loan amortization, principal paydown, continuous property appreciation,
 * and built equity in-memory based on elapsed time between the deal's closingDate and targetDate.
 */
export function resolvePointInTimeDealMetrics(
  deal: DealRecord | Record<string, any>,
  targetDate: Date = new Date(),
): PointInTimeMetrics {
  const isOwned = deal.status === 'owned';
  const inp = deal.inputs || {};
  const price = parseFloat(deal.purchase_price || inp.purchasePrice || inp.price || 0);

  if (!isOwned) {
    const eq = parseFloat(deal.total_equity || inp.initialCashInvested || (price * 0.25));
    const debt = Math.max(0, price - eq);
    const cf = parseFloat(
      deal.year1_cashflow !== undefined && deal.year1_cashflow !== null
        ? deal.year1_cashflow
        : (deal.metrics?.year1CashFlow ?? deal.metrics?.year1Cashflow ?? 0)
    ) || 0;
    const irr = parseFloat(deal.irr || deal.metrics?.irr || 0);
    const noi = parseFloat(deal.metrics?.noi || 0);
    const debtService = parseFloat(deal.metrics?.annualDebtService || 0);

    return {
      currentVal: price,
      currentDebt: debt,
      currentEquity: eq,
      currentCashFlow: cf,
      currentNoi: noi,
      currentDebtService: debtService,
      irr,
      ltv: price > 0 ? Math.round((debt / price) * 100) : 0,
      monthsElapsed: 0,
      label: 'Acquisition',
      baseLoanAmount: debt,
      monthlyPayment: debtService > 0 ? debtService / 12 : 0,
      accumulatedPrincipal: 0,
      holdYear: 0,
    };
  }

  // Resolve closing date
  const closeVal = inp.closingDate || inp.loiDate || deal.closing_date;
  let closeYear = targetDate.getFullYear();
  let closeMonth = targetDate.getMonth() + 1;

  if (closeVal) {
    const m = String(closeVal).match(/(\d{4})[-/](\d{1,2})/);
    if (m) {
      closeYear = parseInt(m[1], 10);
      closeMonth = parseInt(m[2], 10);
    } else {
      const dt = new Date(closeVal);
      if (!isNaN(dt.getFullYear()) && dt.getFullYear() >= 1900) {
        closeYear = dt.getFullYear();
        closeMonth = dt.getMonth() + 1;
      }
    }
  }

  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1;
  const monthsElapsed = Math.max(0, (targetYear - closeYear) * 12 + (targetMonth - closeMonth));

  // Financing parameters
  const downPct = parseFloat(inp.downPaymentPercent !== undefined ? inp.downPaymentPercent : 25);
  const termYears = parseFloat(inp.loanTerm || inp.loanTermYears || 30);
  const rate = parseFloat(inp.interestRate || 6.5);
  const finType = String(inp.financingType || 'fixed').toLowerCase();
  const ioYears = parseInt(inp.interestOnlyYears || 0, 10);
  const ioMonths = ioYears * 12;

  let baseLoanAmount = 0;
  if (deal.metrics && deal.metrics.loanAmount !== undefined && deal.metrics.loanAmount !== null) {
    baseLoanAmount = parseFloat(deal.metrics.loanAmount as any);
  } else if (downPct === 0) {
    baseLoanAmount = price;
  } else {
    baseLoanAmount = Math.max(0, price * (1 - downPct / 100));
  }

  if (inp.financeRehabAndClosingCosts || inp.rehabFinancingMode === 'roll_into_loan') {
    baseLoanAmount += parseFloat(inp.rehabCosts || 0) + parseFloat(inp.closingCosts || 0);
  }

  // Exact Month-by-Month Amortization
  let currentDebt = baseLoanAmount;
  let monthlyPayment = 0;

  if (baseLoanAmount > 0 && termYears > 0) {
    const totalLoanMonths = termYears * 12;
    const r = (rate / 100) / 12;

    const isIO =
      (finType === 'interest_only' && monthsElapsed < ioMonths) ||
      finType === 'bridge' ||
      (finType === 'seller_financing' && ioMonths > 0 && monthsElapsed < ioMonths);

    if (monthsElapsed >= totalLoanMonths) {
      currentDebt = 0;
      monthlyPayment = 0;
    } else if (isIO) {
      currentDebt = baseLoanAmount;
      monthlyPayment = baseLoanAmount * r;
    } else {
      const amortMonthsElapsed =
        finType === 'interest_only' || finType === 'seller_financing'
          ? Math.max(0, monthsElapsed - ioMonths)
          : monthsElapsed;
      const amortTotalMonths =
        finType === 'interest_only' || finType === 'seller_financing'
          ? Math.max(1, totalLoanMonths - ioMonths)
          : totalLoanMonths;

      if (r === 0) {
        monthlyPayment = baseLoanAmount / amortTotalMonths;
        currentDebt = Math.max(0, baseLoanAmount * (1 - amortMonthsElapsed / amortTotalMonths));
      } else {
        monthlyPayment =
          (baseLoanAmount * (r * Math.pow(1 + r, amortTotalMonths))) /
          (Math.pow(1 + r, amortTotalMonths) - 1);
        currentDebt = Math.max(
          0,
          baseLoanAmount * Math.pow(1 + r, amortMonthsElapsed) -
            (monthlyPayment * (Math.pow(1 + r, amortMonthsElapsed) - 1)) / r,
        );
      }
    }
  }

  const accumulatedPrincipal = Math.max(0, baseLoanAmount - currentDebt);

  // Exact Month-by-Month Appreciation
  const appRate = parseFloat(
    inp.appreciationRate !== undefined ? inp.appreciationRate : (inp.targetCapRate ?? 3.0),
  );
  const currentVal = price > 0 ? price * Math.pow(1 + appRate / 100, monthsElapsed / 12) : price;
  const currentEquity = Math.max(0, currentVal - currentDebt);
  const ltv = currentVal > 0 ? Math.round((currentDebt / currentVal) * 1000) / 10 : 0;

  // Active Cash Flow & NOI for current hold year
  const yearOffset = Math.floor(monthsElapsed / 12);
  const projList = deal.metrics && Array.isArray(deal.metrics.projections) ? deal.metrics.projections : [];
  const currentProj = projList[yearOffset] || projList[0] || {};

  let currentCashFlow = parseFloat(currentProj.cashFlow ?? currentProj.netCashFlow ?? 0);
  if (currentCashFlow === 0) {
    currentCashFlow = parseFloat(
      deal.year1_cashflow !== undefined && deal.year1_cashflow !== null
        ? deal.year1_cashflow
        : (deal.metrics?.year1CashFlow ?? deal.metrics?.year1Cashflow ?? 0)
    ) || 0;
  }

  let currentNoi = parseFloat(currentProj.netOperatingIncome ?? currentProj.noi ?? 0);
  if (currentNoi === 0) {
    currentNoi = parseFloat(deal.metrics?.noi ?? 0);
  }

  const currentDebtService = monthlyPayment * 12;
  const irr = parseFloat(deal.irr || deal.metrics?.irr || 0);

  return {
    currentVal,
    currentDebt,
    currentEquity,
    currentCashFlow,
    currentNoi,
    currentDebtService,
    irr,
    ltv,
    monthsElapsed,
    label: 'Current Value',
    baseLoanAmount,
    monthlyPayment,
    accumulatedPrincipal,
    holdYear: yearOffset + 1,
  };
}

/**
 * Generate full continuous month-by-month amortization schedule
 */
export function generateMonthlyAmortizationSchedule(
  deal: DealRecord | Record<string, any>,
  maxMonths = 360,
): MonthlyAmortizationEntry[] {
  const inp = deal.inputs || {};
  const price = parseFloat(deal.purchase_price || inp.purchasePrice || 0);
  const downPct = parseFloat(inp.downPaymentPercent !== undefined ? inp.downPaymentPercent : 25);
  const termYears = parseFloat(inp.loanTerm || inp.loanTermYears || 30);
  const rate = parseFloat(inp.interestRate || 6.5);
  const appRate = parseFloat(inp.appreciationRate !== undefined ? inp.appreciationRate : 3.0);
  const closeVal = inp.closingDate || inp.loiDate || deal.closing_date;

  let baseDate = new Date();
  if (closeVal) {
    const dt = new Date(closeVal);
    if (!isNaN(dt.getTime())) baseDate = dt;
  }

  let baseLoan = downPct === 0 ? price : price * (1 - downPct / 100);
  if (deal.metrics?.loanAmount) {
    baseLoan = parseFloat(deal.metrics.loanAmount as any);
  }
  if (inp.financeRehabAndClosingCosts || inp.rehabFinancingMode === 'roll_into_loan') {
    baseLoan += parseFloat(inp.rehabCosts || 0) + parseFloat(inp.closingCosts || 0);
  }

  const totalLoanMonths = Math.min(maxMonths, Math.round(termYears * 12));
  const r = (rate / 100) / 12;
  const mp =
    r > 0 && totalLoanMonths > 0
      ? (baseLoan * (r * Math.pow(1 + r, totalLoanMonths))) / (Math.pow(1 + r, totalLoanMonths) - 1)
      : totalLoanMonths > 0 ? baseLoan / totalLoanMonths : 0;

  const schedule: MonthlyAmortizationEntry[] = [];
  let balance = baseLoan;
  let cumPrincipal = 0;
  let cumInterest = 0;

  for (let m = 1; m <= totalLoanMonths; m++) {
    const interest = balance * r;
    const principal = Math.min(balance, mp - interest);
    const endingBal = Math.max(0, balance - principal);
    cumPrincipal += principal;
    cumInterest += interest;

    const rowDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + m, 1);
    const estVal = price * Math.pow(1 + appRate / 100, m / 12);
    const estEquity = Math.max(0, estVal - endingBal);
    const ltv = estVal > 0 ? Math.round((endingBal / estVal) * 1000) / 10 : 0;

    schedule.push({
      month: m,
      calendarDate: rowDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      beginningBalance: balance,
      payment: mp,
      principal,
      interest,
      endingBalance: endingBal,
      cumulativePrincipal: cumPrincipal,
      cumulativeInterest: cumInterest,
      estimatedValue: estVal,
      estimatedEquity: estEquity,
      ltv,
    });

    balance = endingBal;
    if (balance <= 0) break;
  }

  return schedule;
}

/**
 * Standard deal display name resolver
 */
export function resolveDealDisplayName(deal: DealRecord | Record<string, any>): string {
  if (deal.title && !deal.title.startsWith('Deal #') && !deal.title.startsWith('Project #')) {
    return deal.title;
  }
  const inp = deal.inputs || {};
  if (deal.location) return deal.location;
  if (inp.propertyAddress) return inp.propertyAddress;
  if (inp.address) return inp.address;
  if (deal.address) return deal.address;
  return deal.title || 'Untitled Investment';
}
