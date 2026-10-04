import type { DealRecord, DealMetrics } from './types';
import { computeDealMetrics } from '../engine/compute';
import { getMonthlyAmortization } from '../engine';
import { resolvePropertyState } from '../property/state';
import type { PropertyFacts, PropertyState } from '../property/types';

/** Engine-derived metrics for a deal (never stored). Null only if the engine cannot evaluate the inputs. */
function engineMetrics(deal: DealRecord | Record<string, any>): Record<string, any> | null {
  try {
    return computeDealMetrics(deal as DealRecord) as unknown as Record<string, any>;
  } catch {
    return null;
  }
}

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
  /** What each headline figure rests on (estimated forecast, or collected rent); read it before presenting a number as actual. */
  state: PropertyState;
  initialCashInvested?: number;
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
 *
 * Income figures come from `resolvePropertyState`. Pass the deal's `facts` (leases, units, rent payments and expense rows; defaults to the deal's `property_facts`) and an owned deal's
 * NOI and cash flow use the rent actually collected; without them (or without enough history) they stay the underwriting forecast,
 * and `state` says which.
 */
export function resolvePointInTimeDealMetrics(
  deal: DealRecord | Record<string, any>,
  targetDate: Date = new Date(),
  facts: PropertyFacts | null = (deal as any).property_facts ?? null,
): PointInTimeMetrics {
  const isOwned = deal.status === 'owned';
  const inp = deal.inputs || {};
  const price = parseFloat(deal.purchase_price || inp.purchasePrice || inp.price || 0);

  if (!isOwned) {
    const em = engineMetrics(deal);
    const downPct = parseFloat(inp.downPaymentPercent !== undefined ? inp.downPaymentPercent : 25);
    const baseLoanAmount =
      em && em.loanAmount !== undefined && em.loanAmount !== null
        ? Number(em.loanAmount) || 0
        : downPct === 0
        ? price
        : Math.max(0, price * (1 - downPct / 100));
    const debt = Number(em?.loanAmount ?? baseLoanAmount) || 0;
    // Property equity is asset value minus outstanding debt; closing costs / fees are transaction expenses
    const eq = Math.max(0, price - debt);
    const cf = Number(em?.year1Cashflow ?? 0) || 0;
    const irr = Number(em?.irr ?? 0) || 0;
    const noi = Number(em?.noi ?? 0) || 0;
    const debtService = Number(em?.annualDebtService ?? 0) || 0;
    const initialCash = Number(em?.initialCashInvested ?? eq) || eq;

    return {
      currentVal: price,
      currentDebt: debt,
      currentEquity: eq,
      initialCashInvested: initialCash,
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
      state: resolvePropertyState({
        deal,
        facts: null,
        asOf: targetDate,
        estimate: { value: price, noi, operatingExpenses: null, debtService, cashFlow: cf },
      }),
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

  // Financing: balance and payment come from the engine's monthly schedule (one amortization implementation)
  const termYears = parseFloat(inp.loanTerm || inp.loanTermYears || inp.amortizationYears || 30);
  const rate = parseFloat(inp.interestRate || 6.5);
  const em = engineMetrics(deal);
  // Engine loan already includes any rehab/closing costs rolled into the loan
  const downPct = parseFloat(inp.downPaymentPercent !== undefined ? inp.downPaymentPercent : 25);
  const baseLoanAmount: number = em && em.loanAmount !== undefined && em.loanAmount !== null
    ? Number(em.loanAmount) || 0
    : (downPct === 0 ? price : Math.max(0, price * (1 - downPct / 100)));

  let currentDebt = baseLoanAmount;
  let monthlyPayment = 0;
  if (baseLoanAmount > 0 && termYears > 0) {
    const rows = getMonthlyAmortization(baseLoanAmount, rate, termYears, {
      totalMonths: monthsElapsed + 1,
      financingType: em?.financingType ?? inp.financingType,
      interestOnlyYears: em?.interestOnlyYears ?? inp.interestOnlyYears,
      armInitialYears: em?.armInitialYears ?? inp.armInitialYears,
      armAdjustmentRate: em?.armAdjustmentRate ?? inp.armAdjustmentRate,
      armRateCap: em?.armRateCap ?? inp.armRateCap,
    });
    currentDebt = monthsElapsed === 0 ? baseLoanAmount : (rows[monthsElapsed - 1]?.endingBalance ?? 0);
    monthlyPayment = rows[monthsElapsed]?.payment ?? 0;
  }

  const accumulatedPrincipal = Math.max(0, baseLoanAmount - currentDebt);

  // Exact Month-by-Month Appreciation
  const appRate = parseFloat(
    inp.appreciationRate !== undefined && inp.appreciationRate !== '' ? inp.appreciationRate : 2.0,
  );
  const currentVal = price > 0 ? price * Math.pow(1 + appRate / 100, monthsElapsed / 12) : price;
  const currentEquity = Math.max(0, currentVal - currentDebt);
  const ltv = currentVal > 0 ? Math.round((currentDebt / currentVal) * 1000) / 10 : 0;

  // Active Cash Flow & NOI for current hold year
  const yearOffset = Math.floor(monthsElapsed / 12);
  const projList: any[] = em && Array.isArray(em.projections) ? em.projections : [];
  const currentProj = projList[yearOffset] || projList[0] || {};

  let currentCashFlow = parseFloat(currentProj.cashFlow ?? currentProj.netCashFlow ?? 0);
  if (!currentCashFlow) currentCashFlow = Number(em?.year1Cashflow ?? 0) || 0;

  let currentNoi = parseFloat(currentProj.netOperatingIncome ?? currentProj.noi ?? 0);
  if (!currentNoi) currentNoi = Number(em?.noi ?? 0) || 0;

  const currentDebtService = monthlyPayment * 12;
  const irr = Number(em?.irr ?? 0) || 0;

  const state = resolvePropertyState({
    deal,
    facts,
    asOf: targetDate,
    estimate: {
      value: currentVal,
      noi: currentNoi,
      operatingExpenses: Number.isFinite(Number(currentProj.operatingExpenses)) && currentProj.operatingExpenses != null ? Number(currentProj.operatingExpenses) : null,
      debtService: currentDebtService,
      cashFlow: currentCashFlow,
    },
  });

  return {
    currentVal,
    currentDebt,
    currentEquity,
    currentCashFlow: state.cashFlow.value ?? currentCashFlow,
    currentNoi: state.noi.value ?? currentNoi,
    currentDebtService,
    irr,
    ltv,
    monthsElapsed,
    label: 'Current Value',
    baseLoanAmount,
    monthlyPayment,
    accumulatedPrincipal,
    holdYear: yearOffset + 1,
    state,
  };
}

/**
 * Month-by-month amortization for the debt tab, straight from the engine's schedule
 * (so IO / ARM / bridge financing is honoured and it always ties to the annual figures).
 * `maxMonths` is how many rows to show; it does NOT change the loan term.
 */
export function generateMonthlyAmortizationSchedule(
  deal: DealRecord | Record<string, any>,
  maxMonths = 360,
): MonthlyAmortizationEntry[] {
  const inp = deal.inputs || {};
  const em = engineMetrics(deal);
  const loan = Number(em?.loanAmount) || 0;
  if (!em || loan <= 0) return [];

  const price = Number(em.purchasePrice) || parseFloat(deal.purchase_price || inp.purchasePrice || 0) || 0;
  const termYears = parseFloat(inp.loanTerm || inp.loanTermYears || inp.amortizationYears || 30);
  const appRate = parseFloat(inp.appreciationRate !== undefined && inp.appreciationRate !== '' ? inp.appreciationRate : 2.0);

  let baseDate = new Date();
  const closeVal = inp.closingDate || inp.loiDate || deal.closing_date;
  if (closeVal) {
    const dt = new Date(closeVal);
    if (!isNaN(dt.getTime())) baseDate = dt;
  }

  const rows = getMonthlyAmortization(loan, parseFloat(inp.interestRate || 6.5), termYears, {
    totalMonths: Math.min(maxMonths, Math.round(termYears * 12)),
    financingType: em.financingType ?? inp.financingType,
    interestOnlyYears: em.interestOnlyYears ?? inp.interestOnlyYears,
    armInitialYears: em.armInitialYears ?? inp.armInitialYears,
    armAdjustmentRate: em.armAdjustmentRate ?? inp.armAdjustmentRate,
    armRateCap: em.armRateCap ?? inp.armRateCap,
  });

  return rows.map((row: any) => {
    const m: number = row.month;
    const rowDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + m, 1);
    const estVal = price * Math.pow(1 + appRate / 100, m / 12);
    return {
      month: m,
      calendarDate: rowDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      beginningBalance: row.beginningBalance,
      payment: row.payment,
      principal: row.principalPaid,
      interest: row.interestPaid,
      endingBalance: row.endingBalance,
      cumulativePrincipal: row.cumulativePrincipalPaid,
      cumulativeInterest: row.cumulativeInterestPaid,
      estimatedValue: estVal,
      estimatedEquity: Math.max(0, estVal - row.endingBalance),
      ltv: estVal > 0 ? Math.round((row.endingBalance / estVal) * 1000) / 10 : 0,
    };
  });
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
export type { LeaseRentResult } from './leaseRent';
export { resolveLeaseMonthlyRent } from './leaseRent';

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
 * Calendar-year pro-forma for the studio. The engine already produces calendar years, stub-year
 * proration, contractual lease escalations, footnotes and monthly receipts; this only reshapes
 * its output for the pro-forma table (no second income model).
 */
export function resolveCalendarProjections(
  deal: DealRecord | Record<string, any>,
  holdingYears = 10,
): CalendarYearSummary[] {
  const em = engineMetrics(deal);
  const proj: any[] = em && Array.isArray(em.projections) ? em.projections : [];
  return proj.slice(0, holdingYears).map((p) => ({
    year: p.year,
    calendarYear: p.calendarYear,
    operatingMonths: p.operatingMonths ?? 12,
    grossPotentialIncome: p.grossPotentialIncome,
    grossPotentialRent: p.grossPotentialIncome,
    vacancyLoss: p.vacancyLoss,
    effectiveGrossIncome: p.effectiveGrossIncome,
    operatingExpenses: p.operatingExpenses,
    netOperatingIncome: p.netOperatingIncome,
    debtService: p.debtService,
    principalPaid: p.principalPaid,
    interestPaid: p.interestPaid,
    netCashFlow: p.netCashFlow,
    cashFlow: p.cashFlow,
    cashOnCash: p.cashOnCash,
    capRate: p.capRate,
    propertyValue: p.propertyValue,
    endingLoanBalance: p.loanBalanceRemaining,
    equity: p.equity,
    dscr: p.dscr,
    isStubYear: !!p.isStubYear || (p.operatingMonths ?? 12) < 12,
    methodologyFootnote: p.methodologyFootnote ?? '',
    monthlyReceipts: Array.isArray(p.monthlyReceipts) ? p.monthlyReceipts : [],
  }));
}
