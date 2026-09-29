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

// ---------------------------------------------------------------------------
// Decoupled Multi-Timeline Calendar Engine & Granular Lease Resolvers
// ---------------------------------------------------------------------------

export interface LeaseRentResult {
  monthlyRent: number;
  isActive: boolean;
  status: 'pre_commencement' | 'active' | 'expired';
  escalationCycles: number;
  provenance: string;
}

/**
 * Resolves contractual lease rent for a specific calendar month.
 * Handles staggered commencements, expiration boundaries, and anniversary compounding.
 */
export function resolveLeaseMonthlyRent(
  lease: any,
  targetYear: number,
  targetMonth: number, // 1-12
): LeaseRentResult {
  const baseRent = parseFloat(lease.monthlyRent || 0);
  if (baseRent <= 0) {
    return {
      monthlyRent: 0,
      isActive: false,
      status: 'pre_commencement',
      escalationCycles: 0,
      provenance: 'No contractual rent specified',
    };
  }

  // Parse lease commencement
  let startYear = targetYear;
  let startMonth = targetMonth;
  if (lease.leaseStartDate) {
    const m = String(lease.leaseStartDate).match(/(\d{4})[-/](\d{1,2})/);
    if (m) {
      startYear = parseInt(m[1], 10);
      startMonth = parseInt(m[2], 10);
    }
  }

  // Parse lease expiration
  let endYear = 2099;
  let endMonth = 12;
  if (lease.leaseEndDate) {
    const m = String(lease.leaseEndDate).match(/(\d{4})[-/](\d{1,2})/);
    if (m) {
      endYear = parseInt(m[1], 10);
      endMonth = parseInt(m[2], 10);
    }
  }

  const targetIdx = targetYear * 12 + targetMonth;
  const startIdx = startYear * 12 + startMonth;
  const endIdx = endYear * 12 + endMonth;

  if (targetIdx < startIdx) {
    return {
      monthlyRent: 0,
      isActive: false,
      status: 'pre_commencement',
      escalationCycles: 0,
      provenance: `Pre-commencement (Lease starts ${lease.leaseStartDate || `${startYear}-${startMonth}`})`,
    };
  }

  if (targetIdx > endIdx) {
    return {
      monthlyRent: 0,
      isActive: false,
      status: 'expired',
      escalationCycles: 0,
      provenance: `Lease expired ${lease.leaseEndDate || `${endYear}-${endMonth}`}`,
    };
  }

  // Active lease: calculate anniversary escalation compounding
  const escRate = parseFloat(lease.escalationRate !== undefined ? lease.escalationRate : 3.0);
  let cycles = 0;

  if (lease.nextEscalationDate) {
    let nextEscYear = startYear + 1;
    let nextEscMonth = startMonth;
    const m = String(lease.nextEscalationDate).match(/(\d{4})[-/](\d{1,2})/);
    if (m) {
      nextEscYear = parseInt(m[1], 10);
      nextEscMonth = parseInt(m[2], 10);
    }
    const nextEscIdx = nextEscYear * 12 + nextEscMonth;
    if (targetIdx >= nextEscIdx) {
      cycles = 1 + Math.floor((targetIdx - nextEscIdx) / 12);
    } else {
      cycles = 0;
    }
  } else {
    cycles = Math.floor((targetIdx - startIdx) / 12);
  }

  const compoundedRent = Math.round(baseRent * Math.pow(1 + escRate / 100, cycles) * 100) / 100;
  const tenant = lease.tenantName || 'Tenant';
  const provenance =
    cycles === 0
      ? `${tenant}: $${baseRent.toLocaleString()}/mo (Base Rate)`
      : `${tenant}: $${compoundedRent.toLocaleString()}/mo (${cycles}x +${escRate}% Escalation)`;

  return {
    monthlyRent: compoundedRent,
    isActive: true,
    status: 'active',
    escalationCycles: cycles,
    provenance,
  };
}

export interface CalendarMonthMetric {
  year: number;
  month: number;
  monthLabel: string;
  isStubMonth: boolean;
  beginningDebtBalance: number;
  debtPayment: number;
  principalPaid: number;
  interestPaid: number;
  endingDebtBalance: number;
  propertyValue: number;
  equity: number;
  ltv: number;
  grossRent: number;
  activeLeasesCount: number;
  rentProvenance: string;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  netCashFlow: number;
}

export interface CalendarYearSummary {
  year: number;
  calendarYear: number;
  operatingMonths: number;
  grossPotentialIncome: number;
  grossPotentialRent: number;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  debtService: number;
  principalPaid: number;
  interestPaid: number;
  netCashFlow: number;
  cashFlow: number;
  cashOnCash: number;
  capRate: number;
  propertyValue: number;
  endingLoanBalance: number;
  equity: number;
  dscr: number | string;
  isStubYear: boolean;
  methodologyFootnote: string;
  monthlyReceipts: Array<{ month: string; rent: number; status: string }>;
}

/**
 * Builds continuous month-by-month cash flows and synthesizes institutional calendar proformas
 * with defensible mathematical footnotes explaining exact rate and escalation timing.
 */
export function resolveCalendarProjections(
  deal: DealRecord | Record<string, any>,
  holdingYears = 10,
): CalendarYearSummary[] {
  const inp = deal.inputs || {};
  const price = parseFloat(deal.purchase_price || inp.purchasePrice || 0);
  const downPct = parseFloat(inp.downPaymentPercent !== undefined ? inp.downPaymentPercent : 25);
  const termYears = parseFloat(inp.loanTerm || inp.loanTermYears || 30);
  const rate = parseFloat(inp.interestRate || 6.5);
  const appRate = parseFloat(inp.appreciationRate !== undefined ? inp.appreciationRate : (inp.targetCapRate ?? 3.0));
  const vacRate = parseFloat(inp.vacancyRate !== undefined ? inp.vacancyRate : (inp.vacancyRatePercent ?? 5.0));
  const expRatio = parseFloat(inp.expenseRatio !== undefined ? inp.expenseRatio : (inp.operatingExpenseRatio ?? 1.0));
  const isNNN = (inp.leaseType === 'NNN' || (inp.leases && inp.leases[0]?.leaseType === 'NNN'));

  // Resolve loan starting basis
  let baseLoan = downPct === 0 ? price : price * (1 - downPct / 100);
  if (deal.metrics?.loanAmount) {
    baseLoan = parseFloat(deal.metrics.loanAmount as any);
  }
  if (inp.financeRehabAndClosingCosts || inp.rehabFinancingMode === 'roll_into_loan') {
    baseLoan += parseFloat(inp.rehabCosts || 0) + parseFloat(inp.closingCosts || 0);
  }

  // Parse closing date
  const closeVal = inp.closingDate || inp.loiDate || deal.closing_date || '2025-07-15';
  let closeYear = 2025;
  let closeMonth = 7;
  const m = String(closeVal).match(/(\d{4})[-/](\d{1,2})/);
  if (m) {
    closeYear = parseInt(m[1], 10);
    closeMonth = parseInt(m[2], 10);
  }

  // Resolve leases array
  const leases: any[] =
    Array.isArray(inp.leases) && inp.leases.length > 0
      ? inp.leases
      : inp.monthlyRent
      ? [
          {
            monthlyRent: parseFloat(inp.monthlyRent),
            leaseStartDate: inp.leaseStartDate || closeVal,
            leaseEndDate: inp.leaseEndDate || '2035-08-03',
            nextEscalationDate: inp.nextEscalationDate || '2026-08-03',
            escalationRate: inp.rentGrowth || inp.rentGrowthPercent || 3.0,
            escalationType: 'Percentage Bump (%)',
            escalationFrequency: 'Annual on Anniversary',
            tenantName: inp.tenantName || 'In-Place Tenant',
            leaseType: inp.leaseType || 'NNN',
            is_active: true,
          },
        ]
      : [];

  const totalLoanMonths = Math.round(termYears * 12);
  const r = (rate / 100) / 12;
  const monthlyPayment =
    r > 0 && totalLoanMonths > 0
      ? (baseLoan * (r * Math.pow(1 + r, totalLoanMonths))) / (Math.pow(1 + r, totalLoanMonths) - 1)
      : totalLoanMonths > 0
      ? baseLoan / totalLoanMonths
      : 0;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yearsSummary: CalendarYearSummary[] = [];
  let currentBalance = baseLoan;

  // We project from closeYear for holdingYears calendar periods
  const startCalYear = closeYear;
  const endCalYear = startCalYear + holdingYears - 1;

  let totalCumulativeCash = 0;
  let initialEquity = parseFloat(deal.total_equity || inp.initialCashInvested || (price - baseLoan + (parseFloat(inp.closingCosts || 0))));
  if (initialEquity <= 0) initialEquity = parseFloat(inp.closingCosts || 12000);

  let opYearCounter = 1;

  for (let calYear = startCalYear; calYear <= endCalYear; calYear++) {
    const isAcquisitionYear = calYear === closeYear;
    const startM = isAcquisitionYear ? closeMonth : 1;
    const operatingMonths = 12 - startM + 1;
    const isStubYear = operatingMonths < 12;

    let yearGross = 0;
    let yearVacancy = 0;
    let yearOpEx = 0;
    let yearDebtService = 0;
    let yearPrincipal = 0;
    let yearInterest = 0;

    const rateBuckets: Record<number, { count: number; total: number; label: string }> = {};
    const monthlyReceipts: Array<{ month: string; rent: number; status: string }> = [];

    let yearEndPropertyValue = price;
    let yearEndBalance = currentBalance;

    for (let mo = startM; mo <= 12; mo++) {
      const monthLabel = `${monthNames[mo - 1]} ${calYear}`;
      const loanMonthsElapsed = (calYear - closeYear) * 12 + (mo - closeMonth) + 1;

      // 1. Debt amortization
      let intPaid = currentBalance * r;
      let prinPaid = Math.min(currentBalance, monthlyPayment - intPaid);
      if (currentBalance <= 0 || loanMonthsElapsed > totalLoanMonths) {
        intPaid = 0;
        prinPaid = 0;
      }
      const endBal = Math.max(0, currentBalance - prinPaid);
      currentBalance = endBal;
      yearEndBalance = endBal;

      const payment = prinPaid + intPaid;
      yearDebtService += payment;
      yearPrincipal += prinPaid;
      yearInterest += intPaid;

      // 2. Valuation appreciation
      const moVal = price * Math.pow(1 + appRate / 100, (loanMonthsElapsed - 1) / 12);
      yearEndPropertyValue = moVal;

      // 3. Lease revenue
      let moGross = 0;
      let activeCount = 0;
      for (const lease of leases) {
        const leaseRes = resolveLeaseMonthlyRent(lease, calYear, mo);
        if (leaseRes.isActive) {
          moGross += leaseRes.monthlyRent;
          activeCount++;
          monthlyReceipts.push({
            month: monthLabel,
            rent: leaseRes.monthlyRent,
            status: leaseRes.provenance,
          });

          const roundedRate = Math.round(leaseRes.monthlyRent * 100) / 100;
          if (!rateBuckets[roundedRate]) {
            rateBuckets[roundedRate] = { count: 0, total: 0, label: leaseRes.provenance };
          }
          rateBuckets[roundedRate].count += 1;
          rateBuckets[roundedRate].total += roundedRate;
        } else {
          monthlyReceipts.push({
            month: monthLabel,
            rent: 0,
            status: leaseRes.provenance,
          });
        }
      }

      yearGross += moGross;

      // 4. Vacancy and OpEx
      const moVac = moGross * (vacRate / 100);
      yearVacancy += moVac;

      let moOpEx = 0;
      if (moGross > 0) {
        moOpEx = moGross * (expRatio / 100);
      } else {
        // Holding costs for vacant month: property tax + hazard insurance + maintenance
        const assessedBasis = parseFloat(inp.totalAssessedValue || inp.combinedAssessedValue || price);
        const monthlyTax = (assessedBasis * 0.011) / 12;
        moOpEx = monthlyTax + 50 + 50; // $100 baseline insurance & compliance
      }
      yearOpEx += moOpEx;
    }

    const yearEGI = yearGross - yearVacancy;
    const yearNOI = yearEGI - yearOpEx;
    const yearCashFlow = yearNOI - yearDebtService;
    totalCumulativeCash += yearCashFlow;

    const endingEquity = Math.max(0, yearEndPropertyValue - yearEndBalance);
    const coc = initialEquity > 0 ? (yearCashFlow / initialEquity) * 100 : 0;
    const capRate = yearEndPropertyValue > 0 ? (yearNOI / yearEndPropertyValue) * 100 : 0;
    const dscr = yearDebtService > 0 ? Math.round((yearNOI / yearDebtService) * 100) / 100 : 'N/A';

    // Build rigorous methodology footnote
    const bucketKeys = Object.keys(rateBuckets).map(Number).sort((a, b) => a - b);
    let footnote = '';

    if (bucketKeys.length === 0) {
      footnote = `${calYear}: Pre-lease holding period (${operatingMonths} months). Contractual rent $0; sponsor carries debt service ($${Math.round(yearDebtService).toLocaleString()}) and municipal holding costs.`;
    } else if (bucketKeys.length === 1) {
      const b = rateBuckets[bucketKeys[0]];
      const vacantCount = operatingMonths - b.count;
      footnote =
        vacantCount > 0
          ? `${calYear}: ${b.count} active tenancy months @ $${bucketKeys[0].toLocaleString()}/mo ($${Math.round(b.total).toLocaleString()}) post-commencement • ${vacantCount} pre-commencement holding months ($0).`
          : `${calYear}: Full 12-month stabilized tenancy @ $${bucketKeys[0].toLocaleString()}/mo ($${Math.round(yearGross).toLocaleString()} gross potential income).`;
    } else {
      const parts = bucketKeys.map((rateKey) => {
        const b = rateBuckets[rateKey];
        return `${b.count} mos @ $${rateKey.toLocaleString()}/mo ($${Math.round(b.total).toLocaleString()})`;
      });
      const blendedMo = yearGross / operatingMonths;
      footnote = `${calYear}: ${parts.join(' + ')} = $${Math.round(yearGross).toLocaleString()} total gross potential income ($${blendedMo.toFixed(2)}/mo blended average).`;
    }

    yearsSummary.push({
      year: opYearCounter++,
      calendarYear: calYear,
      operatingMonths,
      grossPotentialIncome: Math.round(yearGross * 100) / 100,
      grossPotentialRent: Math.round(yearGross * 100) / 100,
      vacancyLoss: Math.round(yearVacancy * 100) / 100,
      effectiveGrossIncome: Math.round(yearEGI * 100) / 100,
      operatingExpenses: Math.round(yearOpEx * 100) / 100,
      netOperatingIncome: Math.round(yearNOI * 100) / 100,
      debtService: Math.round(yearDebtService * 100) / 100,
      principalPaid: Math.round(yearPrincipal * 100) / 100,
      interestPaid: Math.round(yearInterest * 100) / 100,
      netCashFlow: Math.round(yearCashFlow * 100) / 100,
      cashFlow: Math.round(yearCashFlow * 100) / 100,
      cashOnCash: Math.round(coc * 100) / 100,
      capRate: Math.round(capRate * 100) / 100,
      propertyValue: Math.round(yearEndPropertyValue * 100) / 100,
      endingLoanBalance: Math.round(yearEndBalance * 100) / 100,
      equity: Math.round(endingEquity * 100) / 100,
      dscr,
      isStubYear,
      methodologyFootnote: footnote,
      monthlyReceipts,
    });
  }

  return yearsSummary;
}

