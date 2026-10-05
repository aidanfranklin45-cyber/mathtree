// supabase/functions/_shared/math-engine.ts
// Canonical shared financial computation engine for MathTree.
// Authoritative single source of truth for both browser client and Supabase Edge Functions.

import type {
  AssetClass,
  DealInputs,
  DealMetrics,
  ProFormaYear,
  AmortizationScheduleEntry,
  TaxMetrics,
  SensitivityMatrix,
} from './types.ts';
import {
  resolveRemodel,
  remodelMonthCounts,
  remodelDoneByYearEnd,
  remodelStartsInYear,
  remodelLoanYear,
} from './remodel.ts';
import { KEYS, checkEngineInputs, checkTaxInputs, IncompleteInputsError, parseClosingDate, stated } from './inputRequirements.ts';

export { IncompleteInputsError, checkEngineInputs, checkTaxInputs } from './inputRequirements.ts';
export type { MissingInput } from './inputRequirements.ts';

// ---------------------------------------------------------------------------
// Utility: safe numeric coercion
// ---------------------------------------------------------------------------
export function n(v: unknown, fallback = 0): number {
  const raw = String(v ?? fallback);
  // Pasted/imported money strings ("$1,250,000") must not stop at the first separator.
  const parsed = parseFloat(typeof v === 'string' ? raw.replace(/[$,\s]/g, '') : raw);
  return isNaN(parsed) ? fallback : parsed;
}

export function ni(v: unknown, fallback = 0): number {
  const parsed = parseInt(String(v ?? fallback), 10);
  return isNaN(parsed) ? fallback : parsed;
}

export function normalizeAssetClass(raw: unknown): string {
  const s = String(raw || 'commercial').toLowerCase().trim();
  if (s.includes('single') || s.includes('residential') || s === 'sf') return 'single-family';
  if (s.includes('multi') || s.includes('apartment') || s === 'mf') return 'multi-unit';
  if (s.includes('storage') || s.includes('self_storage')) return 'storage';
  return 'commercial';
}

// ---------------------------------------------------------------------------
// 1. Primitive: Monthly Payment (standard amortization)
// ---------------------------------------------------------------------------
export function calculateMonthlyPayment(
  loanAmount: number,
  annualRate: number,
  termYears: number
): number {
  if (loanAmount <= 0 || termYears <= 0) return 0;
  const r = annualRate / 100 / 12;
  const numPayments = termYears * 12;
  if (r === 0) return loanAmount / numPayments;
  return (loanAmount * (r * Math.pow(1 + r, numPayments))) /
    (Math.pow(1 + r, numPayments) - 1);
}

// ---------------------------------------------------------------------------
// 2. Primitive: Remaining Loan Balance
// ---------------------------------------------------------------------------
export function calculateRemainingBalance(
  loanAmount: number,
  annualRate: number,
  termYears: number,
  elapsedYears: number
): number {
  if (loanAmount <= 0) return 0;
  if (elapsedYears >= termYears) return 0;
  if (elapsedYears <= 0) return loanAmount;
  const r = annualRate / 100 / 12;
  const numPayments = termYears * 12;
  const p = elapsedYears * 12;
  if (r === 0) return loanAmount * (1 - p / numPayments);
  const mp = calculateMonthlyPayment(loanAmount, annualRate, termYears);
  return loanAmount * Math.pow(1 + r, p) - (mp * (Math.pow(1 + r, p) - 1)) / r;
}

// ---------------------------------------------------------------------------
// 2b. Contractual Lease Escalation & Granular Monthly Rent Resolver
// ---------------------------------------------------------------------------
type LeaseDates = { start: [number, number] | null; end: [number, number] | null; next: [number, number] | null };
const leaseDateCache = new WeakMap<object, { dates: LeaseDates; start: unknown; end: unknown; next: unknown }>();
const parseYearMonth = (v: unknown): [number, number] | null => {
  if (!v) return null;
  const m = String(v).match(/(\d{4})[-/](\d{1,2})/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
};
/** A lease's dates are parsed once, not once per month of the hold (the Monte Carlo evaluates the same lease thousands of times). */
function leaseDates(lease: any): LeaseDates {
  const hit = leaseDateCache.get(lease);
  if (hit && hit.start === lease.leaseStartDate && hit.end === lease.leaseEndDate && hit.next === lease.nextEscalationDate) return hit.dates;
  const dates: LeaseDates = { start: parseYearMonth(lease.leaseStartDate), end: parseYearMonth(lease.leaseEndDate), next: parseYearMonth(lease.nextEscalationDate) };
  leaseDateCache.set(lease, { dates, start: lease.leaseStartDate, end: lease.leaseEndDate, next: lease.nextEscalationDate });
  return dates;
}

/**
 * `opts.lean` skips the human-readable provenance text (locale-formatted strings are the main cost of this function) for callers
 * that only need the numbers, such as the Monte Carlo. Rent, status, cycles and one-time costs are identical either way.
 *
 * `opts.drift` (percentage points a year) moves only what the contract does not fix: rent after the lease end (renewal, extension
 * or re-let) is market rent, so it drifts. Contractual rent before the end never changes. 0 / undefined = no drift.
 * Such rent is always round(marketBase * (1 + drift / 100) ^ (marketMonths / 12)), which `opts.marketParts` exposes.
 */
export function resolveLeaseMonthlyRent(
  lease: any,
  targetYear: number,
  targetMonth: number,
  opts?: { lean?: boolean; drift?: number; marketParts?: boolean },
): { monthlyRent: number; isActive: boolean; status: string; escalationCycles: number; provenance: string; oneTimeCost?: number; marketBase?: number; marketMonths?: number } {
  const lean = opts?.lean === true;
  // marketParts: also return, for rent after the lease end, the rent before drift and the months of drift (see buildLeaseSchedule)
  const parts = opts?.marketParts === true;
  const drift = Number(opts?.drift) || 0;
  const baseRent = parseFloat(lease.monthlyRent || 0);
  if (baseRent <= 0) {
    return {
      monthlyRent: 0,
      isActive: false,
      status: 'pre_commencement',
      escalationCycles: 0,
      provenance: lean ? '' : 'No contractual rent specified',
    };
  }

  const dates = leaseDates(lease);
  const [startYear, startMonth] = dates.start ?? [targetYear, targetMonth];
  const [endYear, endMonth] = dates.end ?? [2099, 12];

  const targetIdx = targetYear * 12 + targetMonth;
  const startIdx = startYear * 12 + startMonth;
  const endIdx = endYear * 12 + endMonth;

  if (targetIdx < startIdx) {
    return {
      monthlyRent: 0,
      isActive: false,
      status: 'pre_commencement',
      escalationCycles: 0,
      provenance: lean ? '' : `Pre-commencement (Lease starts ${lease.leaseStartDate || `${startYear}-${startMonth}`})`,
    };
  }

  const escRate = parseFloat(lease.escalationRate !== undefined ? lease.escalationRate : 3.0);
  const tenant = lease.tenantName || 'Tenant';

  // Escalation cycles that have occurred by a given month (the contractual schedule keeps running through any extension)
  const cyclesAt = (idx: number): number => {
    if (lease.nextEscalationDate) {
      const [nextEscYear, nextEscMonth] = dates.next ?? [startYear + 1, startMonth];
      const nextEscIdx = nextEscYear * 12 + nextEscMonth;
      return idx >= nextEscIdx ? 1 + Math.floor((idx - nextEscIdx) / 12) : 0;
    }
    return Math.floor((idx - startIdx) / 12);
  };
  const rentAtIdx = (idx: number): number => Math.round(baseRent * Math.pow(1 + escRate / 100, cyclesAt(idx)) * 100) / 100;
  const num = (v: any, fallback: number): number => {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  };
  const fmtMo = (n: number) => `$${Math.round(n).toLocaleString()}/mo`;
  // Market drift compounds only over the time since the contract ended
  const driftFactor = (idx: number): number => (drift ? Math.pow(1 + drift / 100, Math.max(0, idx - endIdx) / 12) : 1);

  if (targetIdx > endIdx) {
    const endLabel = lease.leaseEndDate || `${endYear}-${endMonth}`;
    // With no stated assumption the lease is assumed to continue on its current terms (the investor default, see leaseExpiry.ts).
    const mode = String(lease.expiryAssumption || 'renew');

    // Renewal on current terms for the rest of the hold: rent keeps escalating, optionally with a one-time reset.
    if (mode === 'renew') {
      const step = num(lease.extensionRentChangePct, 0);
      const base = rentAtIdx(targetIdx) * (1 + step / 100);
      const rent = Math.round(base * driftFactor(targetIdx) * 100) / 100;
      return {
        monthlyRent: rent,
        isActive: true,
        status: 'extended',
        escalationCycles: cyclesAt(targetIdx),
        provenance: lean ? '' : `${tenant}: ${fmtMo(rent)} (Assumed renewal on current terms after ${endLabel}${step ? `, ${step > 0 ? '+' : ''}${step}% rent reset` : ''})`,
        ...(parts ? { marketBase: base, marketMonths: targetIdx - endIdx } : {}),
      };
    }

    // Optional extension: the tenant exercises a renewal option; rent may step once, then escalations continue.
    if (mode === 'extend') {
      const extMonths = Math.max(1, Math.round(num(lease.extensionYears, 5) * 12));
      if (targetIdx <= endIdx + extMonths) {
        const step = num(lease.extensionRentChangePct, 0);
        const base = rentAtIdx(targetIdx) * (1 + step / 100);
        const rent = Math.round(base * driftFactor(targetIdx) * 100) / 100;
        return {
          monthlyRent: rent,
          isActive: true,
          status: 'extended',
          escalationCycles: cyclesAt(targetIdx),
          provenance: lean ? '' : `${tenant}: ${fmtMo(rent)} (Extension option after ${endLabel}${step ? `, ${step > 0 ? '+' : ''}${step}% rent reset` : ''})`,
          ...(parts ? { marketBase: base, marketMonths: targetIdx - endIdx } : {}),
        };
      }
    }

    // Vacancy while a replacement tenant is found, then a new lease at old rent +/- a change.
    if (mode === 'relet') {
      const vacancyMonths = Math.max(0, Math.round(num(lease.reletVacancyMonths, 12)));
      const newStartIdx = endIdx + 1 + vacancyMonths;
      if (targetIdx < newStartIdx) {
        return {
          monthlyRent: 0,
          isActive: false,
          status: 'vacant_relet',
          escalationCycles: 0,
          provenance: lean ? '' : `Vacant: re-leasing downtime after ${endLabel} (${vacancyMonths} mos)`,
        };
      }
      const step = num(lease.reletRentChangePct, 0);
      const startRent = rentAtIdx(endIdx) * (1 + step / 100);
      const newCycles = Math.floor((targetIdx - newStartIdx) / 12);
      const base = startRent * Math.pow(1 + escRate / 100, newCycles);
      const rent = Math.round(base * driftFactor(targetIdx) * 100) / 100;
      const reletCost = num(lease.reletCosts, 0);
      return {
        monthlyRent: rent,
        isActive: true,
        status: 'relet',
        escalationCycles: newCycles,
        provenance: lean ? '' : `New tenant: ${fmtMo(rent)} (Re-let after ${vacancyMonths}-mo vacancy${step ? `, ${step > 0 ? '+' : ''}${step}% vs expiring rent` : ''})`,
        oneTimeCost: targetIdx === newStartIdx && reletCost > 0 ? reletCost : 0,
        ...(parts ? { marketBase: base, marketMonths: targetIdx - endIdx } : {}),
      };
    }

    return {
      monthlyRent: 0,
      isActive: false,
      status: 'expired',
      escalationCycles: 0,
      provenance: lean ? '' : `Lease expired ${endLabel}`,
    };
  }

  const cycles = cyclesAt(targetIdx);
  const compoundedRent = rentAtIdx(targetIdx);
  const provenance = lean
    ? ''
    : cycles === 0
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

/**
 * Every lease's rent for every month of the hold, resolved once with no drift. A simulation evaluates the same rent roll
 * thousands of times and only what the contract does not fix changes between runs (market drift after a lease ends, a tenant
 * leaving), so each run reads this table instead of re-resolving every lease. Cell k = slot * leaseCount + lease, where slot =
 * (hold year - 1) * 12 + (calendar month - 1).
 */
type LeaseSchedule = {
  leaseCount: number;
  /** 0 not paying, 1 contractual rent (fixed), 2 market rent after the lease end (drifts), 3 vacant awaiting a re-let */
  kind: Uint8Array;
  /** kind 1: the rent; kind 2: the rent before drift */
  rent: Float64Array;
  /** kind 2: months since the lease end */
  months: Int32Array;
  oneTimeCost: Float64Array;
  maxMonths: number;
};

/** One per simulation: pass it to every lean `calculateProjections` call of that simulation (same leases, closing and hold). */
export type LeaseScheduleCache = { leases?: unknown; key?: string; schedule?: LeaseSchedule };
export function createLeaseScheduleCache(): LeaseScheduleCache {
  return {};
}

function buildLeaseSchedule(leases: any[], closeYear: number, closeMonth: number, holdingPeriod: number, startM1: number): LeaseSchedule {
  const leaseCount = leases.length;
  const size = holdingPeriod * 12 * leaseCount;
  const s: LeaseSchedule = { leaseCount, kind: new Uint8Array(size), rent: new Float64Array(size), months: new Int32Array(size), oneTimeCost: new Float64Array(size), maxMonths: 0 };
  for (let year = 1; year <= holdingPeriod; year++) {
    const calYear = closeYear + (year - 1);
    for (let mo = year === 1 ? startM1 : 1; mo <= 12; mo++) {
      const base = ((year - 1) * 12 + (mo - 1)) * leaseCount;
      for (let li = 0; li < leaseCount; li++) {
        const res = resolveLeaseMonthlyRent(leases[li], calYear, mo, { lean: true, marketParts: true });
        const k = base + li;
        s.oneTimeCost[k] = res.oneTimeCost || 0;
        if (res.status === 'vacant_relet') s.kind[k] = 3;
        else if (!res.isActive) s.kind[k] = 0;
        else if (res.marketBase !== undefined) {
          s.kind[k] = 2;
          s.rent[k] = res.marketBase;
          s.months[k] = res.marketMonths as number;
          if (s.months[k] > s.maxMonths) s.maxMonths = s.months[k];
        } else {
          s.kind[k] = 1;
          s.rent[k] = res.monthlyRent;
        }
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// 3. Annual Amortization Schedule
// ---------------------------------------------------------------------------
export function getAnnualAmortization(
  loanAmount: number,
  annualRate: number,
  termYears: number,
  options: Record<string, any> = {}
): any[] {
  const schedule: any[] = [];
  const finType = String(options.financingType || 'fixed').toLowerCase();
  // ARM and interest-only terms are the loan's own (checked present before any schedule is built); nothing is assumed here
  const armInitial = parseInt(options.armInitialYears ?? 0, 10) || 0;
  const armAdjRate = options.armAdjustmentRate !== undefined ? parseFloat(options.armAdjustmentRate) : annualRate;
  const armCap = options.armRateCap !== undefined ? parseFloat(options.armRateCap) : annualRate;
  const ioYears = parseInt(options.interestOnlyYears !== undefined ? options.interestOnlyYears : 0, 10) || 0;
  const holdYears = parseInt(options.holdingPeriod || options.exitYear || options.holdYears || 0, 10);
  const maxYears = Math.max(1, Math.min(30, isNaN(holdYears) || holdYears <= 0 ? 1 : holdYears));
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
    } else if (finType === 'bridge') {
      isInterestOnly = true;
    } else if (finType === 'seller_financing' && ioYears > 0 && year <= ioYears) {
      isInterestOnly = true;
    }

    const r = yearRate / 100 / 12;

    if (isInterestOnly) {
      const monthlyInterest = currentBalance * r;
      interestPaidThisYear = monthlyInterest * monthsInThisYear;
      principalPaidThisYear = 0;
      totalPaymentThisYear = interestPaidThisYear;
    } else {
      // Remaining term is measured in elapsed months: after a partial first year (closing mid-year) only
      // firstYearMonths of the term have passed, not a whole year, or a fixed payment drifts upward.
      const monthsElapsed = year === 1 ? 0 : firstYearMonths + 12 * (year - 2);
      let remainingYearsForPayment = termYears - monthsElapsed / 12;
      if (remainingYearsForPayment < 1 / 12) remainingYearsForPayment = 1 / 12;

      const monthlyPayment = calculateMonthlyPayment(currentBalance, yearRate, remainingYearsForPayment);

      for (let month = 1; month <= monthsInThisYear; month++) {
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
        if (currentBalance <= 0) break;
      }
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

// ---------------------------------------------------------------------------
// 4. Monthly Amortization Schedule
// ---------------------------------------------------------------------------
export function getMonthlyAmortization(
  loanAmount: number,
  annualRate: number,
  termYears: number,
  options: Record<string, any> = {}
): any[] {
  const schedule: any[] = [];
  if (loanAmount <= 0 || termYears <= 0) return schedule;

  const totalMonths = parseInt(options.totalMonths || ((options.holdingPeriod || 0) * 12), 10);
  const finType = String(options.financingType || 'fixed').toLowerCase();
  const armInitialMonths = (parseInt(options.armInitialYears ?? 0, 10) || 0) * 12;
  const armAdjRate = options.armAdjustmentRate !== undefined ? parseFloat(options.armAdjustmentRate) : annualRate;
  const armCap = options.armRateCap !== undefined ? parseFloat(options.armRateCap) : annualRate;
  const ioMonths = (parseInt(options.interestOnlyYears !== undefined ? options.interestOnlyYears : 0, 10) || 0) * 12;

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

// ---------------------------------------------------------------------------
// 5. Primitive: NPV
// ---------------------------------------------------------------------------
export function calculateNPV(rate: number, cashFlows: number[]): number {
  const r = rate / 100;
  // A rate at or below -100% has no meaningful discount factor; return 0 instead of NaN/Infinity.
  if (r <= -1) return 0;
  let npv = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    npv += cashFlows[t] / Math.pow(1 + r, t);
  }
  return Math.round(npv) + 0; // + 0 normalises -0
}

// ---------------------------------------------------------------------------
// 6. Primitive: Bounded IRR (Newton-Raphson + Capped Bisection)
// ---------------------------------------------------------------------------
export function calculateIRR(initialCashOrFlows: any, optionalFlows?: number[]): number {
  let initialCash = 0;
  let cashFlows: number[] = [];

  if (Array.isArray(initialCashOrFlows)) {
    if (initialCashOrFlows.length === 0) return 0;
    initialCash = Math.abs(initialCashOrFlows[0]);
    cashFlows = initialCashOrFlows.slice(1);
  } else {
    initialCash = n(initialCashOrFlows);
    cashFlows = optionalFlows || [];
  }

  if (initialCash <= 0 || cashFlows.length === 0) return 0;

  function getNPV(rate: number): number {
    let sum = -initialCash;
    for (let i = 0; i < cashFlows.length; i++) {
      sum += cashFlows[i] / Math.pow(1 + rate, i + 1);
    }
    return sum;
  }

  // 1. Newton-Raphson
  const fullFlows = [-initialCash, ...cashFlows];
  const maxIter = 500;
  const tol = 1e-6;
  let r = 0.1;
  let converged = false;

  for (let i = 0; i < maxIter; i++) {
    let fv = 0;
    let fd = 0;
    for (let t = 0; t < fullFlows.length; t++) {
      const denom = Math.pow(1 + r, t);
      fv += fullFlows[t] / denom;
      if (t > 0) fd -= (t * fullFlows[t]) / Math.pow(1 + r, t + 1);
    }
    if (Math.abs(fv) < tol) {
      r = Math.min(10.0, Math.max(-0.99, r));
      converged = true;
      break;
    }
    if (Math.abs(fd) < 1e-12) break;
    const nextR = r - fv / fd;
    if (Math.abs(nextR - r) < tol) {
      r = Math.min(10.0, Math.max(-0.99, nextR));
      converged = true;
      break;
    }
    if (nextR < -0.99 || nextR > 10.0) break;
    r = nextR;
  }

  if (converged) {
    return Math.round(r * 10000) / 100 + 0;
  }

  // 2. Safe bounded bisection (capped at 10.0 = 1000%)
  let low = -0.99;
  let high = 10.0;

  if (getNPV(high) > 0) {
    return 1000.0;
  }
  if (getNPV(low) < 0 && getNPV(high) < 0) {
    return -99.0;
  }

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    const npvVal = getNPV(mid);
    if (Math.abs(npvVal) < 1e-4) {
      return Math.round(mid * 10000) / 100 + 0;
    }
    if (npvVal > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return Math.round(((low + high) / 2) * 10000) / 100 + 0;
}

// ---------------------------------------------------------------------------
// 7. Core Pro-Forma Engine: calculateProjections
// ---------------------------------------------------------------------------
/**
 * Safely parses a numeric input, returning fallback if undefined, null, empty string, or NaN.
 * Never treats 0 as falsy.
 */
export function numOr(v: any, fallback: number): number {
  return (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) ? Number(v) : fallback;
}

/**
 * The down payment percent: stated outright, or derived from a stated loan amount over the financed basis. One of the two must be
 * stated; with neither there is no loan to model and nothing is assumed.
 */
export function resolveDownPaymentPercent(inputs: Record<string, any>, financedBasis: number): number {
  const down = stated(inputs, "downPaymentPercent");
  if (down !== undefined) return down;
  const loan = stated(inputs, "loanAmount");
  if (loan === undefined) {
    throw new IncompleteInputsError([{ key: "downPaymentPercent", label: "Down payment (%) or loan amount", kind: "fact", why: "Without it the engine cannot tell how much is borrowed." }]);
  }
  return financedBasis > 0 ? (1 - Math.min(Math.max(loan, 0), financedBasis) / financedBasis) * 100 : 0;
}

/**
 * Resolves the first full operating year from a projections array.
 * When closing mid-year, year 1 is a partial stub (operatingMonths < 12);
 * coverage and annualised performance ratios use the first full operating year (year 2).
 */
export function firstFullYear<T extends { operatingMonths?: number }>(projections?: T[] | null): T | undefined {
  if (!projections || projections.length === 0) return undefined;
  const p0 = projections[0];
  if (p0 && Number(p0.operatingMonths) < 12 && projections[1]) {
    return projections[1];
  }
  return p0;
}

/**
 * `opts.leaseScheduleCache` (lean only) resolves the rent roll once and reuses it on later calls with the same leases, closing and
 * hold: same numbers, and the cost of a run barely grows with the number of tenants. The Monte Carlo passes one per simulation.
 * `opts.lean` returns the same numbers without the explanatory text (per-month receipts, methodology footnotes). Use it when
 * evaluating many scenarios (Monte Carlo); the figures are identical to a full run.
 */
export function calculateProjections(
  rawAssetType: string,
  inputs: Record<string, any> = {},
  opts?: { lean?: boolean; leaseScheduleCache?: LeaseScheduleCache; allowMaturityBeforeHold?: boolean },
): any {
  const lean = opts?.lean === true;
  // The engine never invents an input: a deal that does not state everything it needs is refused with the list of what is missing.
  // (`allowMaturityBeforeHold` is for the monthly view, which stretches the horizon only to have enough months to show.)
  {
    const missing = checkEngineInputs(rawAssetType, inputs);
    const blocking = opts?.allowMaturityBeforeHold ? missing.filter((m) => m.key !== 'loanMaturityYears' || !/comes due in year/.test(m.label)) : missing;
    if (blocking.length > 0) throw new IncompleteInputsError(blocking);
  }
  // Scenario inputs used by the Monte Carlo (both optional; absent = no effect):
  //   marketRentDrift   percentage points a year added to market rent after a lease ends (contractual rent is never moved)
  //   tenantInterruptions [{leaseIndex, months, makeReadyCost?, startIdx (year*12+month) | startOffset (months after closing)}]: each
  //   entry is a tenant leaving (a default or an ordinary move-out): that lease pays nothing for the window, the owner carries the
  //   space like any vacancy, then rent resumes (a new tenant at the same rent). makeReadyCost is a one-time cost the month they leave.
  //   (tenantInterruption, a single entry, is still accepted.)
  const marketRentDrift = Number(inputs.marketRentDrift) || 0;
  const rawInterruptions: any[] = Array.isArray(inputs.tenantInterruptions) ? inputs.tenantInterruptions : inputs.tenantInterruption ? [inputs.tenantInterruption] : [];
  const assetType = normalizeAssetClass(rawAssetType);

  const purchasePrice = parseFloat(inputs.purchasePrice) || 0;
  const rehabCosts = parseFloat(inputs.rehabCosts) || parseFloat(inputs.rehabBudget) || 0;
  const closingCosts = parseFloat(inputs.closingCosts) || 0;
  // Everything below was checked present by `checkEngineInputs`; `?? 0` only covers values that do not apply (no rent growth with leases).
  // The loan's payment runs over its own amortization. The maturity is a separate fact, checked against the hold.
  const interestRate = stated(inputs, 'interestRate') ?? 0;
  const loanTerm = Math.floor(stated(inputs, ...KEYS.amortization) ?? stated(inputs, ...KEYS.maturity) ?? 0);
  const vacancyRate = stated(inputs, ...KEYS.vacancy) ?? 0;
  // With no stated appreciation (income-valued property whose NOI is not positive) the value is held at cost, never grown by a guess.
  const appreciationRate = stated(inputs, 'appreciationRate') ?? 0;
  const rentGrowth = stated(inputs, ...KEYS.rentGrowth) ?? 0;
  const expenseRatio = stated(inputs, ...KEYS.expenseRatio) ?? 0;
  const sellingCostPct = stated(inputs, ...KEYS.sellingCost) ?? 0;
  const rawExpenseGrowth = inputs.expenseGrowth ?? inputs.expenseInflation ?? inputs.expenseGrowthRate ?? inputs.expenseGrowthPercent ?? inputs.holdingInflation;
  const expenseGrowth = (rawExpenseGrowth !== undefined && rawExpenseGrowth !== null && rawExpenseGrowth !== '')
    ? (parseFloat(rawExpenseGrowth) || 0)
    : undefined;

  const rawHoldingPeriod = Math.floor(stated(inputs, ...KEYS.hold) ?? 1);
  const holdingPeriod = Math.max(1, Math.min(30, rawHoldingPeriod));
  const exitYear = Math.max(1, Math.min(holdingPeriod, parseInt(inputs.exitYear || holdingPeriod, 10)));

  const arv = parseFloat(inputs.arv) || 0;
  const assessedBasis = parseFloat(inputs.totalAssessedValue) || parseFloat(inputs.combinedAssessedValue) || 0;

  // Day 1 Valuation Industry Standard:
  // Day 1 property value is strictly the contract acquisition cost (purchase price / as-is basis).
  // Prospective ARV (After-Repair Value) is realized upon completion of the value-add program.
  const initialPropertyValue = purchasePrice;
  const hasValidPostRehabArv = (assetType === 'single-family' || assetType === 'multi-unit') && arv > purchasePrice && (rehabCosts > 0);
  // The exit cap rate is the owner's stated assumption (required for income-valued property; unused for the rest).
  const targetCapRate = stated(inputs, ...KEYS.exitCap) ?? 0;

  // Revenue Resolution
  let year1GrossIncome = 0;
  const unitCount = parseInt(inputs.unitCount || inputs.numUnits || inputs.totalUnits || 0, 10);
  const storageRent = parseFloat(inputs.storageRentPerUnit || inputs.storageRent || 0);
  const rentPerSqFt = parseFloat(inputs.rentPerSqFt || 0);
  const totalSqFt = parseFloat(inputs.totalSqFt || inputs.storageSqFt || inputs.gla || 0);
  const explicitGrossAnnual = parseFloat(inputs.grossRentAnnual || inputs.grossRevenueAnnual || inputs.annualRent || inputs.grossAnnualRent || 0);
  const explicitGrossMonthly = parseFloat(inputs.grossRentPerMonth || inputs.grossRentMonthly || inputs.monthlyGrossRent || 0);
  const explicitStorageMonthly = parseFloat(inputs.storageGrossRentMonthly || inputs.grossStorageRentMonthly || 0);

  switch (assetType) {
    case 'single-family':
      if (explicitGrossAnnual > 0) {
        year1GrossIncome = explicitGrossAnnual;
      } else if (explicitGrossMonthly > 0) {
        year1GrossIncome = explicitGrossMonthly * 12;
      } else if (inputs.monthlyRent) {
        year1GrossIncome = parseFloat(inputs.monthlyRent) * 12;
      }
      break;
    case 'multi-unit':
      if (explicitGrossAnnual > 0) {
        year1GrossIncome = explicitGrossAnnual;
      } else if (explicitGrossMonthly > 0) {
        year1GrossIncome = explicitGrossMonthly * 12;
      } else if (unitCount > 0 && inputs.monthlyRentPerUnit) {
        year1GrossIncome = unitCount * parseFloat(inputs.monthlyRentPerUnit) * 12;
      } else if (inputs.monthlyRent) {
        year1GrossIncome = parseFloat(inputs.monthlyRent) * 12;
      }
      break;
    case 'commercial':
      if (explicitGrossAnnual > 0) {
        year1GrossIncome = explicitGrossAnnual;
      } else if (explicitGrossMonthly > 0) {
        year1GrossIncome = explicitGrossMonthly * 12;
      } else if (Array.isArray(inputs.leases) && inputs.leases.length > 0) {
        year1GrossIncome = (inputs.leases as Array<{ monthlyRent?: number }>).reduce(
          (sum, l) => sum + (n(l.monthlyRent) * 12),
          0
        );
      } else if (inputs.monthlyRent) {
        year1GrossIncome = parseFloat(inputs.monthlyRent) * 12;
      }
      break;
    case 'storage':
      if (explicitGrossAnnual > 0) {
        year1GrossIncome = explicitGrossAnnual;
      } else if (explicitGrossMonthly > 0) {
        year1GrossIncome = explicitGrossMonthly * 12;
      } else if (explicitStorageMonthly > 0) {
        year1GrossIncome = explicitStorageMonthly * 12;
      } else if (storageRent > 0) {
        year1GrossIncome = (unitCount || 1) * storageRent * 12;
      } else if (totalSqFt > 0 && rentPerSqFt > 0) {
        year1GrossIncome = totalSqFt * rentPerSqFt * 12;
      }
      break;
  }

  // Dynamic Debt & Equity Calculations: derived from purchase price, downPaymentPercent, and remodel financing mode
  const rehabFinancingMode = inputs.rehabFinancingMode || (inputs.financeRehabAndClosingCosts ? 'roll_into_loan' : 'out_of_pocket');
  const isRehabFinanced = rehabFinancingMode === 'roll_into_loan';
  const totalFinancedBasis = isRehabFinanced ? purchasePrice + rehabCosts + closingCosts : purchasePrice;

  // The loan is stated either as a down payment percent or as the lender's loan amount (the percent wins when both are present).
  const downPaymentPercent = resolveDownPaymentPercent(inputs, totalFinancedBasis);
  const downPaymentAmount = totalFinancedBasis * (downPaymentPercent / 100);
  const loanAmount = Math.max(0, isRehabFinanced ? totalFinancedBasis - downPaymentAmount : purchasePrice - downPaymentAmount);

  const initialCashInvested = isRehabFinanced
    ? downPaymentAmount
    : (downPaymentAmount + rehabCosts + closingCosts);

  const initialEquity = initialPropertyValue - loanAmount;

  const monthlyPayment = calculateMonthlyPayment(loanAmount, interestRate, loanTerm);
  const annualDebtService = monthlyPayment * 12;

  // The closing date is a stated fact (checked above); there is no assumed date.
  const closing = parseClosingDate(inputs.closingDate) as { year: number; month: number };
  const closeYear = closing.year;
  const closeMonth = closing.month;

  // Optional remodel of an owned property (inputs.remodel). Absent or unusable = every line below is skipped.
  const remodel = resolveRemodel(inputs.remodel, closeYear * 12 + closeMonth, { interestRate });
  const remodelPayment = remodel && remodel.loanAmount > 0
    ? calculateMonthlyPayment(remodel.loanAmount, remodel.loanRatePct, remodel.loanTermYears)
    : 0;

  const hasExplicitLeases = Array.isArray(inputs.leases) && inputs.leases.length > 0;
  const isProrateFirstYear = !!inputs.prorateFirstYear || (hasExplicitLeases && closeMonth > 1) || (inputs.closingDate && closeMonth > 1);
  let firstYearOperatingMonths = 12;
  if (isProrateFirstYear) {
    if (closeMonth > 1) {
      firstYearOperatingMonths = Math.max(1, 12 - closeMonth + 1);
    } else if (inputs.firstYearMonths !== undefined && !isNaN(parseInt(inputs.firstYearMonths, 10))) {
      firstYearOperatingMonths = Math.max(1, Math.min(12, parseInt(inputs.firstYearMonths, 10)));
    } else {
      firstYearOperatingMonths = 12;
    }
  }

  const finOptions = {
    financingType: inputs.financingType || 'fixed',
    armInitialYears: inputs.armInitialYears,
    armAdjustmentRate: inputs.armAdjustmentRate,
    armRateCap: inputs.armRateCap,
    interestOnlyYears: inputs.interestOnlyYears,
    sellerFinanceBalloon: inputs.sellerFinanceBalloon,
    holdingPeriod: holdingPeriod,
    firstYearMonths: isProrateFirstYear ? firstYearOperatingMonths : 12
  };
  const amortizationSchedule = getAnnualAmortization(loanAmount, interestRate, loanTerm, finOptions);

  const projections: any[] = [];
  let currentPropertyValue = initialPropertyValue;
  let currentGrossIncome = year1GrossIncome;
  let organicGross = year1GrossIncome; // rent before any remodel adjustment (no-lease path)
  let cumulativePrincipalPaid = 0;
  let cumulativeCashInvested = initialCashInvested;
  let entryCapRate = 0;
  // Lease-driven year 1 is often a partial year (lease starts after closing); its NOI over the full price is not a cap rate
  let entryCapPending = false;

  // Vacancy windows by lease index: [start, end) as year*12+month, with the one-time make-ready cost charged the month the tenant leaves
  const interruptionWindows = new Map<number, Array<{ start: number; end: number; cost: number }>>();
  for (const it of rawInterruptions) {
    const months = Number(it?.months) || 0;
    const cost = Number(it?.makeReadyCost) || 0;
    if (!(months > 0) && !(cost > 0)) continue;
    const start = it.startIdx ?? (closeYear * 12 + closeMonth + (Number(it.startOffset) || 0));
    const list = interruptionWindows.get(it.leaseIndex) ?? [];
    list.push({ start, end: start + Math.max(0, months), cost });
    interruptionWindows.set(it.leaseIndex, list);
  }

  // The rent roll resolved once per simulation (lean callers that pass a cache), and this run's drift factor by months since a lease end
  let schedule: LeaseSchedule | undefined;
  let driftByMonths: Float64Array | undefined;
  let windowCells: Uint8Array | undefined;
  const cache = lean && hasExplicitLeases ? opts?.leaseScheduleCache : undefined;
  if (cache) {
    const startM1 = isProrateFirstYear ? closeMonth : 1;
    const key = `${closeYear}|${closeMonth}|${holdingPeriod}|${startM1}`;
    if (!cache.schedule || cache.leases !== inputs.leases || cache.key !== key) {
      cache.schedule = buildLeaseSchedule(inputs.leases, closeYear, closeMonth, holdingPeriod, startM1);
      cache.leases = inputs.leases;
      cache.key = key;
    }
    schedule = cache.schedule;
    driftByMonths = new Float64Array(schedule.maxMonths + 1);
    for (let m = 0; m <= schedule.maxMonths; m++) driftByMonths[m] = marketRentDrift ? Math.pow(1 + marketRentDrift / 100, m / 12) : 1;
    // Mark the lease-months a vacancy window touches, so every other lease-month skips the window check
    if (interruptionWindows.size > 0) {
      const { leaseCount } = schedule;
      const slots = holdingPeriod * 12;
      const firstIdx = closeYear * 12 + 1; // slot 0
      windowCells = new Uint8Array(slots * leaseCount);
      for (const [li, list] of interruptionWindows) {
        if (!Number.isInteger(li) || li < 0 || li >= leaseCount) continue;
        for (const w of list) {
          const from = Math.max(0, w.start - firstIdx);
          const to = Math.min(slots, Math.max(w.end, w.start + 1) - firstIdx);
          for (let slot = from; slot < to; slot++) windowCells[slot * leaseCount + li] = 1;
        }
      }
    }
  }

  for (let year = 1; year <= holdingPeriod; year++) {
    const calYear = closeYear + (year - 1);
    const isStubYear = (year === 1 && isProrateFirstYear);
    const operatingMonths = isStubYear ? firstYearOperatingMonths : 12;
    const yearFraction = operatingMonths / 12;

    let methodologyFootnote = '';
    const monthlyReceipts: Array<{ month: string; rent: number; status: string }> = [];
    // Lease-expiry effects for this year: months a lease sits vacant awaiting a replacement tenant, and one-time re-leasing costs
    let vacantLeaseMonths = 0;
    let expiryOneTimeCosts = 0;
    let incomeMonths = 0; // months this year in which any lease pays rent

    if (schedule && driftByMonths) {
      // Same arithmetic, in the same order, as the lease loop below, read from the precomputed rent roll
      const { leaseCount, kind, rent, months, oneTimeCost } = schedule;
      const startM = isStubYear ? closeMonth : 1;
      let yearGross = 0;
      for (let mo = startM; mo <= 12; mo++) {
        let moGross = 0;
        const base = ((year - 1) * 12 + (mo - 1)) * leaseCount;
        const idx = calYear * 12 + mo;
        for (let li = 0; li < leaseCount; li++) {
          const k = base + li;
          const kd = kind[k];
          if (kd === 0) continue;
          if (kd === 3) {
            vacantLeaseMonths += 1;
            continue;
          }
          let paying = true;
          const windows = windowCells && windowCells[k] ? interruptionWindows.get(li) : undefined;
          if (windows) {
            let vacantNow = false;
            for (const w of windows) {
              if (idx === w.start && w.cost > 0) expiryOneTimeCosts += w.cost;
              if (idx >= w.start && idx < w.end) vacantNow = true;
            }
            if (vacantNow) {
              vacantLeaseMonths += 1;
              paying = false;
            }
          }
          if (oneTimeCost[k]) expiryOneTimeCosts += oneTimeCost[k];
          if (paying) moGross += kd === 1 ? rent[k] : Math.round(rent[k] * driftByMonths[months[k]] * 100) / 100;
        }
        if (moGross > 0) incomeMonths += 1;
        yearGross += moGross;
      }
      currentGrossIncome = yearGross;
    } else if (hasExplicitLeases) {
      const startM = isStubYear ? closeMonth : 1;
      let yearGross = 0;
      const rateBuckets: Record<number, { count: number; total: number; label: string }> = {};

      for (let mo = startM; mo <= 12; mo++) {
        let moGross = 0;
        const leaseList = inputs.leases as any[];
        for (let li = 0; li < leaseList.length; li++) {
          const lease = leaseList[li];
          let leaseRes = resolveLeaseMonthlyRent(lease, calYear, mo, { lean, drift: marketRentDrift });
          const windows = interruptionWindows.size > 0 && leaseRes.isActive ? interruptionWindows.get(li) : undefined;
          if (windows) {
            const idx = calYear * 12 + mo;
            let vacantNow = false;
            for (const w of windows) {
              if (idx === w.start && w.cost > 0) expiryOneTimeCosts += w.cost; // make-ready, the month the tenant leaves
              if (idx >= w.start && idx < w.end) vacantNow = true;
            }
            if (vacantNow) {
              // The tenant left (or defaulted): no rent during the downtime, and the owner carries the space like any vacancy
              vacantLeaseMonths += 1;
              leaseRes = { ...leaseRes, monthlyRent: 0, isActive: false, status: 'tenant_default', provenance: lean ? '' : 'Tenant left: vacant until re-let' };
            }
          }
          if (leaseRes.status === 'vacant_relet') vacantLeaseMonths += 1;
          if (leaseRes.oneTimeCost) expiryOneTimeCosts += leaseRes.oneTimeCost;
          if (lean) {
            if (leaseRes.isActive) moGross += leaseRes.monthlyRent;
            continue;
          }
          if (leaseRes.isActive) {
            moGross += leaseRes.monthlyRent;
            monthlyReceipts.push({
              month: `${calYear}-${String(mo).padStart(2, '0')}`,
              rent: leaseRes.monthlyRent,
              status: leaseRes.provenance
            });
            const roundedRate = Math.round(leaseRes.monthlyRent * 100) / 100;
            if (!rateBuckets[roundedRate]) {
              rateBuckets[roundedRate] = { count: 0, total: 0, label: leaseRes.provenance };
            }
            rateBuckets[roundedRate].count += 1;
            rateBuckets[roundedRate].total += roundedRate;
          } else {
            monthlyReceipts.push({
              month: `${calYear}-${String(mo).padStart(2, '0')}`,
              rent: 0,
              status: leaseRes.provenance
            });
          }
        }
        if (moGross > 0) incomeMonths += 1;
        yearGross += moGross;
      }
      currentGrossIncome = yearGross;

      const bucketKeys = lean ? [] : Object.keys(rateBuckets).map(Number).sort((a, b) => a - b);
      if (lean) {
        // numbers only: no per-month receipts, no explanatory text
      } else if (bucketKeys.length === 0) {
        methodologyFootnote = `${calYear}: Pre-lease holding period (${operatingMonths} mos). Contractual rent $0.`;
      } else if (bucketKeys.length === 1) {
        const b = rateBuckets[bucketKeys[0]];
        const vacantCount = operatingMonths - b.count;
        methodologyFootnote = vacantCount > 0
          ? `${calYear}: ${b.count} active tenancy months @ $${bucketKeys[0].toLocaleString()}/mo ($${Math.round(b.total).toLocaleString()}) post-commencement • ${vacantCount} vacant holding months ($0).`
          : `${calYear}: Full 12-month stabilized tenancy @ $${bucketKeys[0].toLocaleString()}/mo ($${Math.round(yearGross).toLocaleString()} gross potential income).`;
      } else {
        const parts = bucketKeys.map((k) => `${rateBuckets[k].count} mos @ $${k.toLocaleString()}/mo ($${Math.round(rateBuckets[k].total).toLocaleString()})`);
        methodologyFootnote = `${calYear}: ${parts.join(' + ')} = $${Math.round(yearGross).toLocaleString()} total gross potential income ($${(yearGross / operatingMonths).toFixed(2)}/mo blended average).`;
      }
    } else {
      if (year > 1) {
        organicGross = organicGross * (1 + rentGrowth / 100);
      }
      currentGrossIncome = organicGross;
    }

    // Remodel: rent drops while work is under way, then steps up. Worked in operating-period dollars, then folded into the
    // year's gross rent so vacancy, management fees and the rest of the pipeline see the adjusted figure.
    let remodelLostGross = 0;
    let remodelGainedGross = 0;
    let remodelMissedUplift = 0; // uplift the completion year did not collect: valuation uses the run-rate, not the partial year
    let remodelMonths = { pre: 0, works: 0, post: 0, total: 0 };
    if (remodel) {
      remodelMonths = remodelMonthCounts(remodel, calYear, isStubYear ? closeMonth : 1);
      const perMonth = hasExplicitLeases ? currentGrossIncome / Math.max(1, remodelMonths.total) : currentGrossIncome / 12;
      const opBase = hasExplicitLeases ? currentGrossIncome : perMonth * remodelMonths.total;
      const uplift = remodel.rentUpliftMonthly * Math.pow(1 + rentGrowth / 100, Math.max(0, calYear - remodel.completionYear));
      remodelLostGross = perMonth * (1 - remodel.rentDuringWorks) * remodelMonths.works;
      remodelGainedGross = uplift * remodelMonths.post;
      if (remodelMonths.post > 0) remodelMissedUplift = uplift * (remodelMonths.total - remodelMonths.post);
      const opGross = opBase - remodelLostGross + remodelGainedGross;
      currentGrossIncome = (!hasExplicitLeases && isStubYear) ? opGross / yearFraction : opGross;
    }

    const vacancyLoss = currentGrossIncome * (vacancyRate / 100);
    const effectiveGrossIncome = currentGrossIncome - vacancyLoss;

    const baselineGrossForOpex = year1GrossIncome > 0 ? year1GrossIncome : currentGrossIncome;
    const inflationMultiplier = expenseGrowth !== undefined ? Math.pow(1 + expenseGrowth / 100, year - 1) : null;
    const baseOpex = inflationMultiplier !== null
      ? (baselineGrossForOpex * (expenseRatio / 100)) * inflationMultiplier
      : (currentGrossIncome * (expenseRatio / 100));

    let operatingExpenses = 0;
    // Reserves are the owner's stated assumption: a dollar amount a year, or a share of income. Never a rule of thumb built into the engine.
    const capexAnnualStated = stated(inputs, ...KEYS.capexAnnual);
    const capexPercentStated = stated(inputs, ...KEYS.capexPercent);
    const capexReserve = capexAnnualStated !== undefined ? capexAnnualStated : effectiveGrossIncome * ((capexPercentStated ?? 0) / 100);
    // Management is charged only when the owner has a manager, at the rate the owner states, on collected (effective gross) income.
    const managementFee = inputs.manageProperty ? effectiveGrossIncome * ((stated(inputs, 'managementFeePercent') ?? 0) / 100) : 0;

    if (assetType === 'storage') {
      // On-site payroll and marketing, at the stated share of income
      operatingExpenses = baseOpex + managementFee + (currentGrossIncome * ((stated(inputs, 'payrollMarketingPercent') ?? 0) / 100));
    } else if (assetType === 'commercial' && (currentGrossIncome + remodelLostGross) <= 0) {
      // No income this year (land, a vacant building, or the months before a lease starts): the carrying costs, as stated. The
      // remodel case is excluded on purpose: rent lost to works does not make the building a vacant lot.
      const taxes = stated(inputs, ...KEYS.taxes);
      const insurance = stated(inputs, ...KEYS.insurance);
      const maintenance = stated(inputs, ...KEYS.maintenance);
      operatingExpenses = (taxes !== undefined && insurance !== undefined && maintenance !== undefined)
        ? (taxes + insurance + maintenance) * (inflationMultiplier ?? 1)
        // A lease that ends mid-hold with no replacement: the building keeps costing what it costs at the underwritten ratio
        : baselineGrossForOpex * (expenseRatio / 100) * (inflationMultiplier ?? 1);
    } else {
      operatingExpenses = baseOpex + managementFee;
    }

    if (hasExplicitLeases && (vacantLeaseMonths > 0 || expiryOneTimeCosts > 0)) {
      // While a space awaits a replacement tenant the owner still pays what the building costs to run. Operating expenses are a
      // ratio of rent collected, so they shrink when rent stops; this puts back the share that belongs to the vacant lease-months.
      // The building's stated carrying costs (taxes, insurance, upkeep) are used when the deal states them (always, when tenants
      // pay the costs, because the ratio is then too small to carry the space); otherwise the same underwritten ratio on the same rent roll.
      if (vacantLeaseMonths > 0 && (currentGrossIncome > 0 || assetType !== 'commercial')) {
        const carryTaxes = stated(inputs, ...KEYS.taxes);
        const carryInsurance = stated(inputs, ...KEYS.insurance);
        const carryMaintenance = stated(inputs, ...KEYS.maintenance);
        const annualRunCost = (carryTaxes !== undefined && carryInsurance !== undefined && carryMaintenance !== undefined)
          ? (carryTaxes + carryInsurance + carryMaintenance) * (inflationMultiplier ?? 1)
          : baselineGrossForOpex * (expenseRatio / 100) * (inflationMultiplier ?? 1);
        const vacantShare = vacantLeaseMonths / Math.max(1, (inputs.leases as any[]).length);
        operatingExpenses += annualRunCost * (vacantShare / 12);
      }
      operatingExpenses += expiryOneTimeCosts;
    }

    // Remodel opex: the building still costs money while rent is down (ratio-based expenses would otherwise shrink with rent),
    // and the bigger building costs more to run once complete.
    let remodelValueNoi = 0;
    if (remodel) {
      const toOpexUnits = (x: number) => (!hasExplicitLeases && isStubYear) ? x / yearFraction : x;
      const carry = inflationMultiplier === null ? (expenseRatio / 100) * remodelLostGross : 0;
      const extra = remodel.extraOpexAnnual * (inflationMultiplier ?? 1) * (remodelMonths.post / 12);
      operatingExpenses += toOpexUnits(carry + extra);
      const incomeFactor = (1 - vacancyRate / 100) - (inflationMultiplier === null ? expenseRatio / 100 : 0);
      remodelValueNoi = remodelLostGross * (1 - vacancyRate / 100) + remodelMissedUplift * incomeFactor
        - (remodelMonths.post > 0 ? remodel.extraOpexAnnual * (inflationMultiplier ?? 1) * (1 - remodelMonths.post / 12) : 0);
    }

    const netOperatingIncome = effectiveGrossIncome - operatingExpenses;

    let appliedGross = currentGrossIncome;
    let appliedVacancy = vacancyLoss;
    let appliedEGI = effectiveGrossIncome;
    let appliedOpex = operatingExpenses;
    let appliedCapex = capexReserve;
    let appliedNOI = netOperatingIncome;

    if (isStubYear) {
      appliedCapex = capexReserve * yearFraction;
      if (!hasExplicitLeases) {
        appliedGross = currentGrossIncome * yearFraction;
        appliedVacancy = vacancyLoss * yearFraction;
        appliedEGI = effectiveGrossIncome * yearFraction;
        appliedOpex = operatingExpenses * yearFraction;
        appliedNOI = appliedEGI - appliedOpex;
      }
    }

    if (year === 1) {
      if (initialPropertyValue > 0 && netOperatingIncome > 0) {
        entryCapRate = (netOperatingIncome / initialPropertyValue) * 100;
      } else {
        entryCapRate = targetCapRate;
      }
      entryCapPending = hasExplicitLeases && incomeMonths < 12;
    } else if (entryCapPending && hasExplicitLeases && incomeMonths >= 12) {
      // Going-in cap rate on the first full year of income (same basis as the headline DSCR)
      entryCapPending = false;
      if (initialPropertyValue > 0 && netOperatingIncome > 0) entryCapRate = (netOperatingIncome / initialPropertyValue) * 100;
    }
    const capStillPending = entryCapPending; // still waiting for a full year of income: value stays at cost

    const valuationNoi = netOperatingIncome + remodelValueNoi; // run-rate income while a remodel distorts the year's actual NOI
    const isIncomeProducing = ((currentGrossIncome + remodelLostGross) > 0 && valuationNoi > 0);
    let valuedFromIncome = false;
    if ((assetType === 'commercial' || assetType === 'storage') && isIncomeProducing) {
      valuedFromIncome = true;
      const exitCapTiming = inputs.exitCapTiming || 'amortized';
      if (year === 1 || capStillPending) {
        currentPropertyValue = initialPropertyValue;
      } else {
        if (exitCapTiming === 'day1' || exitCapTiming === 'immediate') {
          currentPropertyValue = targetCapRate > 0 ? (valuationNoi / (targetCapRate / 100)) : initialPropertyValue;
        } else {
          const capRateStep = (targetCapRate - entryCapRate) / Math.max(1, (holdingPeriod - 1));
          const currentYearCapRate = entryCapRate + (capRateStep * (year - 1));
          currentPropertyValue = currentYearCapRate > 0 ? (valuationNoi / (currentYearCapRate / 100)) : initialPropertyValue;
        }
      }
    } else {
      if (year === 1) {
        // Year 1 Stabilization: if a value-add program was executed, value steps up to ARV upon completion
        if (hasValidPostRehabArv) {
          currentPropertyValue = arv;
        } else {
          currentPropertyValue = initialPropertyValue;
        }
      } else {
        const appRate = (appreciationRate !== undefined && !isNaN(appreciationRate)) ? appreciationRate : 2.0;
        currentPropertyValue = currentPropertyValue * (1 + appRate / 100);
      }
    }

    // Remodel value: manual = the stated value from completion on (then appreciating); cap_rate on a property valued by
    // appreciation = the added income capitalised once, in the completion year (the income-valued branch already follows NOI).
    let remodelDebt = { debtService: 0, principal: 0, interest: 0, endBalance: 0 };
    let remodelCashCost = 0;
    if (remodel) {
      if (remodelDoneByYearEnd(remodel, calYear)) {
        if (remodel.valueMode === 'manual' && remodel.manualValue > 0) {
          const appRate = !isNaN(appreciationRate) ? appreciationRate : 2.0;
          currentPropertyValue = remodel.manualValue * Math.pow(1 + appRate / 100, Math.max(0, calYear - remodel.completionYear));
        } else if (remodel.valueMode === 'cap_rate' && !valuedFromIncome && calYear === remodel.completionYear) {
          const cap = remodel.capRatePct > 0 ? remodel.capRatePct : targetCapRate;
          const stabilizedLift = remodel.rentUpliftMonthly * 12 * ((1 - vacancyRate / 100) - (inflationMultiplier === null ? expenseRatio / 100 : 0)) - remodel.extraOpexAnnual;
          if (cap > 0 && stabilizedLift > 0) currentPropertyValue += stabilizedLift / (cap / 100);
        }
      }
      if (remodelStartsInYear(remodel, calYear)) remodelCashCost = remodel.cashPortion;
      if (remodel.loanAmount > 0) remodelDebt = remodelLoanYear(remodel, remodelPayment, calYear);
    }

    const yearAmort = amortizationSchedule[year - 1] || {};
    const currentDebtService = (yearAmort.totalPayment !== undefined ? yearAmort.totalPayment : (isStubYear ? annualDebtService * yearFraction : annualDebtService)) + remodelDebt.debtService;
    const principalPaid = (yearAmort.principalPaid !== undefined ? yearAmort.principalPaid : 0) + remodelDebt.principal;
    const interestPaid = (yearAmort.interestPaid !== undefined ? yearAmort.interestPaid : currentDebtService - remodelDebt.debtService) + remodelDebt.interest;
    cumulativePrincipalPaid += principalPaid;

    const cashFlow = (isStubYear ? appliedNOI : netOperatingIncome) - currentDebtService - (isStubYear ? appliedCapex : capexReserve) - remodelCashCost;

    let cashInjection = 0;
    if (cashFlow < 0) {
      cashInjection = Math.abs(cashFlow);
      cumulativeCashInvested += cashInjection;
    }

    const isZeroInitialCash = cumulativeCashInvested <= 0;
    const isCoCNotMeaningful = isZeroInitialCash && cashFlow > 0;
    const cashOnCash = cumulativeCashInvested > 0 ? (cashFlow / cumulativeCashInvested) * 100 : 0;
    const cashOnCashDisplay = isCoCNotMeaningful ? "N/M" : (Math.round(cashOnCash * 100) / 100).toFixed(2) + "%";
    const capRate = currentPropertyValue > 0 ? (netOperatingIncome / currentPropertyValue) * 100 : 0;
    const remainingLoanBalance = (yearAmort.endingBalance !== undefined ? yearAmort.endingBalance : calculateRemainingBalance(loanAmount, interestRate, loanTerm, year)) + remodelDebt.endBalance;
    const equity = currentPropertyValue - remainingLoanBalance;
    const activeNOI = isStubYear ? appliedNOI : netOperatingIncome;
    const dscr = currentDebtService > 0 ? (activeNOI / currentDebtService) : null;
    const debtYield = loanAmount > 0 ? (activeNOI / loanAmount) * 100 : null;
    const ltv = currentPropertyValue > 0 ? (remainingLoanBalance / currentPropertyValue) * 100 : 0;

    projections.push({
      year,
      calendarYear: calYear,
      methodologyFootnote,
      monthlyReceipts,
      propertyValue: Math.round(currentPropertyValue * 100) / 100,
      grossPotentialIncome: Math.round((isStubYear ? appliedGross : currentGrossIncome) * 100) / 100,
      vacancyLoss: Math.round((isStubYear ? appliedVacancy : vacancyLoss) * 100) / 100,
      effectiveGrossIncome: Math.round((isStubYear ? appliedEGI : effectiveGrossIncome) * 100) / 100,
      operatingExpenses: Math.round((isStubYear ? appliedOpex : operatingExpenses) * 100) / 100,
      netOperatingIncome: Math.round((isStubYear ? appliedNOI : netOperatingIncome) * 100) / 100,
      debtService: Math.round(currentDebtService * 100) / 100,
      annualDebtService: Math.round(currentDebtService * 100) / 100,
      principalPaid: Math.round(principalPaid * 100) / 100,
      interestPaid: Math.round(interestPaid * 100) / 100,
      cumulativePrincipalPaid: Math.round(cumulativePrincipalPaid * 100) / 100,
      appliedInterestRate: yearAmort.appliedRate ?? interestRate,
      isInterestOnly: !!yearAmort.isInterestOnly,
      isArmAdjusted: !!yearAmort.isArmAdjusted,
      financingType: finOptions.financingType,
      capexReserve: Math.round((isStubYear ? appliedCapex : capexReserve) * 100) / 100,
      cashFlow: Math.round(cashFlow * 100) / 100,
      netCashFlow: Math.round(cashFlow * 100) / 100,
      cashInjection: Math.round(cashInjection * 100) / 100,
      cumulativeCashInvested: Math.round(cumulativeCashInvested * 100) / 100,
      cashOnCash: Math.round(cashOnCash * 100) / 100,
      cashOnCashDisplay,
      isCoCNotMeaningful,
      capRate: Math.round(capRate * 100) / 100,
      loanBalanceRemaining: Math.round(remainingLoanBalance * 100) / 100,
      endingDebt: Math.round(remainingLoanBalance * 100) / 100,
      remainingLoanBalance: Math.round(remainingLoanBalance * 100) / 100,
      equity: Math.round(equity * 100) / 100,
      // What the owner would receive if they sold at the end of this year: value less selling costs less the loan balance
      exitProceedsNet: Math.round((currentPropertyValue * (1 - sellingCostPct / 100) - remainingLoanBalance) * 100) / 100,
      dscr: dscr !== null ? Math.round(dscr * 100) / 100 : null,
      debtYield: debtYield !== null ? Math.round(debtYield * 100) / 100 : null,
      ltv: Math.round(ltv * 100) / 100,
      isStubYear: isStubYear,
      operatingMonths: operatingMonths,
      ...(remodel ? {
        remodelCost: Math.round(remodelCashCost * 100) / 100,
        remodelRentLost: Math.round(remodelLostGross * 100) / 100,
        remodelRentGained: Math.round(remodelGainedGross * 100) / 100,
        remodelDebtService: Math.round(remodelDebt.debtService * 100) / 100,
        remodelLoanBalance: Math.round(remodelDebt.endBalance * 100) / 100,
      } : {}),
    });
  }

  const discountRate = stated(inputs, ...KEYS.discountRate) ?? 0;

  let npv = -initialCashInvested;
  for (let t = 1; t <= exitYear; t++) {
    let cf = projections[t - 1].cashFlow;
    if (t === exitYear) {
      cf += projections[t - 1].exitProceedsNet;
    }
    npv += cf / Math.pow(1 + discountRate / 100, t);
  }

  const irrCashFlows: number[] = [];
  for (let t = 1; t <= exitYear; t++) {
    let cf = projections[t - 1].cashFlow;
    if (t === exitYear) {
      cf += projections[t - 1].exitProceedsNet;
    }
    irrCashFlows.push(cf);
  }
  const irr = calculateIRR(initialCashInvested, irrCashFlows);

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
  totalReturned += projections[exitYear - 1].exitProceedsNet;
  const equityMultiplier = totalInvested > 0 ? (totalReturned / totalInvested) : 0;

  let cumulativeCash = -initialCashInvested;
  let breakEvenYear: any = "N/A";
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
  const isZeroEquity = initialCashInvested <= 0 && purchasePrice > 0;
  const irrDisplay = isZeroEquity ? "N/M (100% Financed)" : (Math.round(irr * 100) / 100).toFixed(2) + "%";
  const equityMultiplierDisplay = isZeroEquity ? "N/M (Zero Initial Outlay)" : (Math.round(equityMultiplier * 100) / 100).toFixed(2) + "x";
  const y1CoCDisplay = projections[0] ? projections[0].cashOnCashDisplay : "0.00%";

  return {
    isZeroEquity,
    financingType: finOptions.financingType,
    interestOnlyYears: finOptions.interestOnlyYears,
    armInitialYears: finOptions.armInitialYears,
    armAdjustmentRate: finOptions.armAdjustmentRate,
    armRateCap: finOptions.armRateCap,
    irrDisplay,
    equityMultiplierDisplay,
    cashOnCashDisplay: y1CoCDisplay,
    purchasePrice: Math.round(purchasePrice * 100) / 100,
    day1Value: Math.round(initialPropertyValue * 100) / 100,
    initialPropertyValue: Math.round(initialPropertyValue * 100) / 100,
    stabilizedValue: Math.round((hasValidPostRehabArv ? arv : (projections[0] ? projections[0].propertyValue : purchasePrice)) * 100) / 100,
    arv: arv > 0 ? Math.round(arv * 100) / 100 : null,
    rehabCosts: Math.round(rehabCosts * 100) / 100,
    downPaymentAmount: Math.round(downPaymentAmount * 100) / 100,
    loanAmount: Math.max(0, Math.round(loanAmount * 100) / 100),
    initialCashInvested: Math.round(initialCashInvested * 100) / 100,
    initialEquity: Math.round(initialEquity * 100) / 100,
    annualDebtService: Math.round(annualDebtService * 100) / 100,
    npv: Math.round(npv * 100) / 100,
    irr: Math.round(irr * 100) / 100,
    equityMultiplier: Math.round(equityMultiplier * 100) / 100,
    equity_multiple: Math.round(equityMultiplier * 100) / 100,
    noi: Math.round(((firstFullYear(projections)?.netOperatingIncome) ?? (projections[0]?.netOperatingIncome ?? 0)) * 100) / 100,
    capRate: Math.round(((firstFullYear(projections)?.capRate) ?? (projections[0]?.capRate ?? entryCapRate)) * 100) / 100,
    dscr: firstFullYear(projections)?.dscr ?? (projections[0]?.dscr ?? null),
    cashOnCash: Math.round(((firstFullYear(projections)?.cashOnCash) ?? (projections[0]?.cashOnCash ?? 0)) * 100) / 100,
    cash_on_cash: Math.round(((firstFullYear(projections)?.cashOnCash) ?? (projections[0]?.cashOnCash ?? 0)) * 100) / 100,
    year1_cashflow: Math.round(((firstFullYear(projections)?.cashFlow) ?? (projections[0]?.cashFlow ?? 0)) * 100) / 100,
    year1Cashflow: Math.round(((firstFullYear(projections)?.cashFlow) ?? (projections[0]?.cashFlow ?? 0)) * 100) / 100,
    total_equity: Math.round(initialCashInvested * 100) / 100,
    breakEvenYear,
    ltv: Math.round(acquisitionLtv * 100) / 100,
    monthlyMortgagePayment: Math.round(monthlyPayment * 100) / 100,
    amortizationSchedule,
    ...(remodel ? { remodel: { startIdx: remodel.startIdx, completionIdx: remodel.completionIdx, cost: remodel.cost, loanAmount: remodel.loanAmount, cashPortion: remodel.cashPortion } } : {}),
    projections,
    isProratedFirstYear: isProrateFirstYear,
    firstYearOperatingMonths: isProrateFirstYear ? firstYearOperatingMonths : 12
  };
}

// ---------------------------------------------------------------------------
// 8. Granular Monthly Cash Flow Schedule
// ---------------------------------------------------------------------------
export function calculateMonthlyProjections(assetType: string, inputs: Record<string, any>, options: Record<string, any> = {}): any {
  // The schedule starts at the deal's closing date (or a start date the caller names). There is no assumed date.
  const start = parseClosingDate(inputs.closingDate || options.closingDate || options.startDate);
  if (!start) throw new IncompleteInputsError([{ key: 'closingDate', label: 'Closing date', kind: 'fact', why: 'The monthly schedule starts at closing.' }]);
  const startYear = start.year;
  const startMonth = start.month;

  let monthsCount = 24;
  const hasExplicitMonths = options.totalMonths !== undefined || options.monthsCount !== undefined;
  const rawEnd = options.endDate || (!hasExplicitMonths ? (inputs.monthlyEndDate || options.targetEndDate) : null);
  if (rawEnd) {
    let endYear = null;
    let endMonth = null;
    if (rawEnd instanceof Date && !isNaN(rawEnd.getTime())) {
      endYear = rawEnd.getFullYear();
      endMonth = rawEnd.getMonth() + 1;
    } else {
      const strEnd = String(rawEnd).trim();
      const parts = strEnd.split(/[-/]/);
      if (parts.length >= 2) {
        if (parts[0].length === 4) {
          endYear = parseInt(parts[0], 10);
          endMonth = parseInt(parts[1], 10);
        } else {
          endMonth = parseInt(parts[0], 10);
          endYear = parseInt(parts[2] || parts[1], 10);
        }
      }
    }
    if (endYear && endMonth && !isNaN(endYear) && !isNaN(endMonth)) {
      const diffMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
      if (!isNaN(diffMonths) && diffMonths > 0) {
        monthsCount = Math.min(360, Math.max(1, diffMonths));
      }
    }
  } else if (options.monthsCount !== undefined || options.totalMonths !== undefined || inputs.monthlyTotalMonths !== undefined) {
    const rawCount = parseInt(options.monthsCount !== undefined ? options.monthsCount : (options.totalMonths !== undefined ? options.totalMonths : inputs.monthlyTotalMonths), 10);
    if (!isNaN(rawCount) && rawCount > 0) {
      monthsCount = Math.min(360, Math.max(1, rawCount));
    }
  }

  const requiredYears = Math.min(30, Math.max(10, Math.ceil(monthsCount / 12)));
  const annualBase = calculateProjections(assetType, { ...inputs, holdingPeriod: requiredYears, exitYear: requiredYears, prorateFirstYear: false }, { allowMaturityBeforeHold: true });
  const purchasePrice = annualBase.purchasePrice;
  const rawExpenseGrowth = inputs.expenseGrowth ?? inputs.expenseInflation ?? inputs.expenseGrowthRate ?? inputs.expenseGrowthPercent ?? inputs.holdingInflation;
  const expenseGrowth = (rawExpenseGrowth !== undefined && rawExpenseGrowth !== null && rawExpenseGrowth !== '')
    ? (parseFloat(rawExpenseGrowth) || 0)
    : undefined;
  const baseGrossMonthly = (annualBase.projections[0]?.grossPotentialRent ?? annualBase.projections[0]?.grossPotentialIncome ?? 0) / 12;
  const loanAmount = annualBase.loanAmount;
  const interestRate = stated(inputs, 'interestRate') ?? 0;
  const loanTerm = Math.floor(stated(inputs, ...KEYS.amortization) ?? stated(inputs, ...KEYS.maturity) ?? 0);

  const finOptions = {
    financingType: inputs.financingType || 'fixed',
    armInitialYears: inputs.armInitialYears,
    armAdjustmentRate: inputs.armAdjustmentRate,
    armRateCap: inputs.armRateCap,
    interestOnlyYears: inputs.interestOnlyYears,
    totalMonths: monthsCount
  };
  const monthlyAmort = getMonthlyAmortization(loanAmount, interestRate, loanTerm, finOptions);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyRows: any[] = [];
  let cumulativeCash = 0;

  for (let m = 1; m <= monthsCount; m++) {
    const month0 = (startMonth - 1 + (m - 1)) % 12;
    const calYear = startYear + Math.floor((startMonth - 1 + (m - 1)) / 12);
    const calMonthName = monthNames[month0];
    const monthLabel = `${calMonthName} ${calYear}`;

    const opYear = Math.floor((m - 1) / 12) + 1;
    const yearProj = annualBase.projections[Math.min(opYear - 1, annualBase.projections.length - 1)] || {};

    let monthlyGross = (yearProj.grossPotentialIncome || 0) / 12;
    if (Array.isArray(inputs.leases) && inputs.leases.length > 0) {
      let leaseGross = 0;
      for (const lease of (inputs.leases as any[])) {
        const leaseRes = resolveLeaseMonthlyRent(lease, calYear, month0 + 1);
        if (leaseRes.isActive) leaseGross += leaseRes.monthlyRent;
      }
      monthlyGross = leaseGross;
    }

    const vacPct = numOr(inputs.vacancyRate ?? inputs.vacancyRatePercent, 5);
    const monthlyVacancy = monthlyGross * (vacPct / 100);
    const monthlyEGI = monthlyGross - monthlyVacancy;
    const monthlyInflation = expenseGrowth !== undefined ? Math.pow(1 + expenseGrowth / 100, Math.max(0, opYear - 1)) : 1;
    let monthlyOpex = 0;
    if (monthlyGross > 0) {
      const expPct = numOr(inputs.expenseRatio ?? inputs.operatingExpenseRatio, 25);
      monthlyOpex = expenseGrowth !== undefined
        ? (baseGrossMonthly * (expPct / 100)) * monthlyInflation
        : monthlyGross * (expPct / 100);
    } else {
      const assessedBasis = parseFloat(inputs.totalAssessedValue || inputs.combinedAssessedValue || purchasePrice);
      monthlyOpex = (((assessedBasis * 0.011) / 12) + 100) * monthlyInflation;
    }
    const monthlyNOI = monthlyEGI - monthlyOpex;

    const amort = monthlyAmort[m - 1] || {};
    const debtPayment = amort.payment || 0;
    const principalPaid = amort.principalPaid || 0;
    const interestPaid = amort.interestPaid || 0;
    const endingLoanBal = amort.endingBalance !== undefined ? amort.endingBalance : 0;

    const netCashFlow = monthlyNOI - debtPayment;
    cumulativeCash += netCashFlow;

    monthlyRows.push({
      monthNumber: m,
      calendarYear: calYear,
      calendarMonth: month0 + 1,
      calendarMonthName: calMonthName,
      label: monthLabel,
      operatingYear: opYear,
      grossIncome: Math.round(monthlyGross * 100) / 100,
      vacancyLoss: Math.round(monthlyVacancy * 100) / 100,
      effectiveGrossIncome: Math.round(monthlyEGI * 100) / 100,
      operatingExpenses: Math.round(monthlyOpex * 100) / 100,
      netOperatingIncome: Math.round(monthlyNOI * 100) / 100,
      debtService: Math.round(debtPayment * 100) / 100,
      principalPaid: Math.round(principalPaid * 100) / 100,
      interestPaid: Math.round(interestPaid * 100) / 100,
      netCashFlow: Math.round(netCashFlow * 100) / 100,
      cashFlow: Math.round(netCashFlow * 100) / 100,
      cumulativeCashFlow: Math.round(cumulativeCash * 100) / 100,
      remainingLoanBalance: Math.round(endingLoanBal * 100) / 100
    });
  }

  const endCalYear = startYear + Math.floor((startMonth - 1 + (monthsCount - 1)) / 12);
  const endCalMonth0 = (startMonth - 1 + (monthsCount - 1)) % 12;
  const endMonthName = monthNames[endCalMonth0];

  return {
    startYear,
    startMonth,
    startMonthName: monthNames[startMonth - 1],
    startDateISO: `${startYear}-${String(startMonth).padStart(2, '0')}`,
    endYear: endCalYear,
    endMonth: endCalMonth0 + 1,
    endMonthName,
    endDateISO: `${endCalYear}-${String(endCalMonth0 + 1).padStart(2, '0')}`,
    totalMonths: monthsCount,
    monthlyProjections: monthlyRows,
    summary: {
      totalGrossIncome: Math.round(monthlyRows.reduce((sum, r) => sum + (r.grossIncome || 0), 0) * 100) / 100,
      totalNOI: Math.round(monthlyRows.reduce((sum, r) => sum + (r.netOperatingIncome || 0), 0) * 100) / 100,
      totalDebtService: Math.round(monthlyRows.reduce((sum, r) => sum + (r.debtService || 0), 0) * 100) / 100,
      totalPrincipalPaid: Math.round(monthlyRows.reduce((sum, r) => sum + (r.principalPaid || 0), 0) * 100) / 100,
      totalInterestPaid: Math.round(monthlyRows.reduce((sum, r) => sum + (r.interestPaid || 0), 0) * 100) / 100,
      netCumulativeCashFlow: Math.round(cumulativeCash * 100) / 100,
      endingLoanBalance: monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1].remainingLoanBalance : 0
    }
  };
}

// ---------------------------------------------------------------------------
// 9. Sensitivity Matrix Engine
// ---------------------------------------------------------------------------
export function calculateSensitivityMatrix(
  assetType: string,
  baseInputs: Record<string, any>,
  rowParam = 'exitCapRate',
  rowValues = [5.5, 6.0, 6.5, 7.0, 7.5],
  colParam = 'vacancyRate',
  colValues = [0, 3, 5, 8, 10]
): any {
  const matrix: any[] = [];

  for (let r = 0; r < rowValues.length; r++) {
    const rowVal = rowValues[r];
    const rowCells: any[] = [];
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

// ---------------------------------------------------------------------------
// 9b. Down Payment & Leverage Sensitivity Matrix
// ---------------------------------------------------------------------------
export interface DownPaymentMatrixRow {
  downPaymentPercent: number;
  downPaymentAmount: number;
  loanAmount: number;
  ltv: number;
  initialCashInvested: number;
  monthlyDebtService: number;
  annualDebtService: number;
  netOperatingIncome: number;
  netCashFlow: number;
  cashOnCash: number;
  dscr: number | null;
  capRate: number;
  isBaseline: boolean;
}

export interface DownPaymentMatrixResult {
  baselinePercent: number;
  purchasePrice: number;
  goingInCapRate: number;
  loanConstant: number | null;
  leverageType: 'positive' | 'negative' | 'neutral';
  debtServicePer5PctDown: number;
  rows: DownPaymentMatrixRow[];
}

export function calculateDownPaymentMatrix(
  rawAssetType: string,
  baseInputs: Record<string, any> = {},
  customPercentages?: number[]
): DownPaymentMatrixResult {
  const assetType = normalizeAssetClass(rawAssetType);
  const baselinePercent = numOr(baseInputs.downPaymentPercent, 25);

  const rawList = Array.isArray(customPercentages) && customPercentages.length > 0
    ? [...customPercentages]
    : [10, 15, 20, 25, 30, 35, 40];

  if (!rawList.some((p) => Math.abs(Number(p) - baselinePercent) < 0.001)) {
    rawList.push(baselinePercent);
  }

  // Deduplicate and sort numerically
  const percentages = Array.from(
    new Set(
      rawList
        .filter((p) => p !== null && p !== undefined && !isNaN(Number(p)))
        .map((p) => Math.max(0, Math.min(100, Math.round(Number(p) * 100) / 100)))
    )
  ).sort((a, b) => a - b);

  const rows: DownPaymentMatrixRow[] = [];

  for (const p of percentages) {
    const scenarioInputs = {
      ...baseInputs,
      downPaymentPercent: p,
    };
    const res = calculateProjections(assetType, scenarioInputs);
    const proj = res.projections || [];
    const y1 = firstFullYear(proj) || proj[0] || {};

    const downPaymentAmount = Number(res.downPaymentAmount ?? 0);
    const loanAmount = Number(res.loanAmount ?? 0);
    const ltv = Number(res.ltv ?? (100 - p));
    const initialCashInvested = Number(res.initialCashInvested ?? 0);
    const monthlyDebtService = Number(res.monthlyMortgagePayment ?? 0);
    const annualDebtService = Number(y1.debtService ?? (monthlyDebtService * 12));
    const netOperatingIncome = Number(y1.netOperatingIncome ?? 0);
    const netCashFlow = Number(y1.cashFlow ?? y1.netCashFlow ?? (netOperatingIncome - annualDebtService));
    const cashOnCash = Number(y1.cashOnCash ?? 0);
    const dscr = (loanAmount <= 0 || annualDebtService <= 0)
      ? null
      : (y1.dscr !== null && y1.dscr !== undefined && !isNaN(Number(y1.dscr)))
        ? Number(y1.dscr)
        : (netOperatingIncome / annualDebtService);
    const capRate = Number(y1.capRate ?? res.capRate ?? 0);
    const isBaseline = Math.abs(p - baselinePercent) < 0.001;

    rows.push({
      downPaymentPercent: p,
      downPaymentAmount,
      loanAmount,
      ltv,
      initialCashInvested,
      monthlyDebtService,
      annualDebtService,
      netOperatingIncome,
      netCashFlow,
      cashOnCash,
      dscr,
      capRate,
      isBaseline,
    });
  }

  const baselineRow = rows.find((r) => r.isBaseline) || rows[0];
  const purchasePrice = Number(baseInputs.purchasePrice || 0);
  const goingInCapRate = baselineRow ? baselineRow.capRate : 0;

  // Loan constant = Annual Debt Service / Loan Amount (%)
  let loanConstant: number | null = null;
  if (baselineRow && baselineRow.loanAmount > 0 && baselineRow.annualDebtService > 0) {
    loanConstant = (baselineRow.annualDebtService / baselineRow.loanAmount) * 100;
  } else {
    const rowWithLoan = rows.find((r) => r.loanAmount > 0 && r.annualDebtService > 0);
    if (rowWithLoan) {
      loanConstant = (rowWithLoan.annualDebtService / rowWithLoan.loanAmount) * 100;
    }
  }

  // Financial leverage classification: Going-in Cap Rate vs Loan Constant
  let leverageType: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (loanConstant !== null && goingInCapRate > 0) {
    const spread = goingInCapRate - loanConstant;
    if (spread > 0.05) {
      leverageType = 'positive';
    } else if (spread < -0.05) {
      leverageType = 'negative';
    } else {
      leverageType = 'neutral';
    }
  }

  // Calculate annual debt service savings per 5% incremental down payment
  let debtServicePer5PctDown = 0;
  const rowsWithDebt = rows.filter((r) => r.annualDebtService > 0 && r.loanAmount > 0);
  if (rowsWithDebt.length >= 2) {
    const first = rowsWithDebt[0];
    const last = rowsWithDebt[rowsWithDebt.length - 1];
    const pctDelta = last.downPaymentPercent - first.downPaymentPercent;
    if (pctDelta > 0) {
      const dsDelta = first.annualDebtService - last.annualDebtService;
      debtServicePer5PctDown = Math.round((dsDelta / pctDelta) * 5);
    }
  }

  return {
    baselinePercent,
    purchasePrice,
    goingInCapRate,
    loanConstant,
    leverageType,
    debtServicePer5PctDown,
    rows,
  };
}

// ---------------------------------------------------------------------------
// 10. Monte Carlo Simulation Engine
// ---------------------------------------------------------------------------
function gaussianRandom(mean = 0, stdDev = 1): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + num * stdDev;
}

export function buildAdaptiveHistogramBins(sortedIrrs: number[], targetBinCount = 10): any[] {
  if (!sortedIrrs || sortedIrrs.length === 0) return [];
  const n = sortedIrrs.length;
  if (n <= targetBinCount) {
    return sortedIrrs.map((val) => {
      const rounded = Math.round(val * 10) / 10;
      return {
        label: `${rounded}%`,
        binStart: rounded,
        binEnd: rounded,
        count: 1,
        isTail: false
      };
    });
  }

  const p5Idx = Math.floor(n * 0.05);
  const p95Idx = Math.floor(n * 0.95);
  const coreIrrs = sortedIrrs.slice(p5Idx, p95Idx);
  const minCore = coreIrrs[0];
  const maxCore = coreIrrs[coreIrrs.length - 1];

  let effectiveMinCore = minCore;
  let effectiveMaxCore = maxCore;
  if ((effectiveMaxCore - effectiveMinCore) < 1.0) {
    const center = (effectiveMaxCore + effectiveMinCore) / 2;
    effectiveMinCore = center - 2.5;
    effectiveMaxCore = center + 2.5;
  }

  const coreBinCount = targetBinCount - 2;
  const binStep = (effectiveMaxCore - effectiveMinCore) / coreBinCount;

  const bins: any[] = [];
  bins.push({
    label: `< ${effectiveMinCore.toFixed(1)}%`,
    binStart: sortedIrrs[0],
    binEnd: effectiveMinCore,
    count: sortedIrrs.filter(val => val < effectiveMinCore).length,
    isTail: true
  });

  for (let i = 0; i < coreBinCount; i++) {
    const bStart = effectiveMinCore + (i * binStep);
    const bEnd = (i === coreBinCount - 1) ? effectiveMaxCore : bStart + binStep;
    const count = sortedIrrs.filter(val => val >= bStart && (i === coreBinCount - 1 ? val <= bEnd : val < bEnd)).length;
    const rStart = Math.round(bStart * 10) / 10;
    const rEnd = Math.round(bEnd * 10) / 10;
    const label = (rStart === rEnd)
      ? `${bStart.toFixed(2)}% to ${bEnd.toFixed(2)}%`
      : `${rStart}% to ${rEnd}%`;
    bins.push({
      label,
      binStart: bStart,
      binEnd: bEnd,
      count,
      isTail: false
    });
  }

  bins.push({
    label: `> ${effectiveMaxCore.toFixed(1)}%`,
    binStart: effectiveMaxCore,
    binEnd: sortedIrrs[n - 1],
    count: sortedIrrs.filter(val => val > effectiveMaxCore).length,
    isTail: true
  });

  return bins;
}


// ---------------------------------------------------------------------------
// 11. Tax & Cost Segregation Engine
// ---------------------------------------------------------------------------
export function calculateTaxAndDepreciation(assetType: string, inputs: Record<string, any>, baseResults: any): any {
  const purchasePrice = parseFloat(inputs.purchasePrice) || 0;
  const rehabCosts = parseFloat(inputs.rehabCosts) || 0;
  // Land share and tax rate vary by deal and by owner: stated, never assumed (the county's land and improvement values are a starting point)
  const missingTax = checkTaxInputs(inputs);
  if (missingTax.length > 0) throw new IncompleteInputsError(missingTax);
  const landPercent = stated(inputs, 'landPercent') ?? 0;
  const taxRate = stated(inputs, 'taxRate') ?? 0;
  const enableCostSeg = inputs.enableCostSeg === true || inputs.enableCostSeg === 'true';

  const landValue = purchasePrice * (landPercent / 100);
  const totalDepreciableBasis = Math.max(0, (purchasePrice - landValue) + rehabCosts);

  const recoveryPeriod = (assetType === 'single-family' || assetType === 'multi-unit') ? 27.5 : 39.0;
  let annualDepreciation = totalDepreciableBasis / recoveryPeriod;
  let year1Depreciation = annualDepreciation;

  if (enableCostSeg) {
    const bonusBasis = totalDepreciableBasis * 0.15;
    const remainingBasis = totalDepreciableBasis * 0.85;
    const bonusYr1 = bonusBasis * 0.80;
    const straightLineYr1 = remainingBasis / recoveryPeriod;
    year1Depreciation = bonusYr1 + straightLineYr1;
  }

  const numYears = (baseResults && baseResults.projections) ? baseResults.projections.length : Math.max(1, Math.min(30, parseInt(inputs.holdingPeriod || inputs.exitYear || inputs.holdYears || 10, 10)));
  const yearlyTaxDetails: any[] = [];
  const afterTaxCashFlows: number[] = [];
  let accumDepreciation = 0;

  for (let year = 1; year <= numYears; year++) {
    const proj = baseResults.projections[year - 1] || {};
    const amort = (baseResults.amortizationSchedule && baseResults.amortizationSchedule[year - 1]) || {};
    const interestExpense = amort ? (amort.interestPaid || 0) : 0;

    let depForYear = (year === 1 && enableCostSeg) ? year1Depreciation : annualDepreciation;
    if (accumDepreciation + depForYear > totalDepreciableBasis) {
      depForYear = Math.max(0, totalDepreciableBasis - accumDepreciation);
    }
    accumDepreciation += depForYear;

    const noi = proj.netOperatingIncome || 0;
    const cf = proj.cashFlow !== undefined ? proj.cashFlow : (noi - (amort.totalPayment || 0));
    const taxableIncome = noi - interestExpense - depForYear;
    const taxLiability = taxableIncome * (taxRate / 100);
    const afterTaxCashFlow = cf - taxLiability;

    afterTaxCashFlows.push(afterTaxCashFlow);

    yearlyTaxDetails.push({
      year,
      noi: noi,
      interestExpense: Math.round(interestExpense * 100) / 100,
      depreciation: Math.round(depForYear * 100) / 100,
      taxableIncome: Math.round(taxableIncome * 100) / 100,
      taxLiability: Math.round(taxLiability * 100) / 100,
      preTaxCashFlow: cf,
      afterTaxCashFlow: Math.round(afterTaxCashFlow * 100) / 100
    });
  }

  const rawExitYear = parseInt(inputs.exitYear !== undefined ? inputs.exitYear : (inputs.holdingPeriod !== undefined ? inputs.holdingPeriod : inputs.holdYears));
  const exitYear = Math.max(1, Math.min(numYears, isNaN(rawExitYear) ? numYears : rawExitYear));
  const exitProj = baseResults.projections[exitYear - 1];
  const exitValue = exitProj ? exitProj.propertyValue : purchasePrice;
  const exitLoanBalance = exitProj ? exitProj.loanBalanceRemaining : 0;

  const adjustedBasis = Math.max(0, purchasePrice + rehabCosts - accumDepreciation);
  const totalGain = Math.max(0, exitValue - adjustedBasis);
  const depRecaptureTax = accumDepreciation * 0.25;
  const capitalGainTaxable = Math.max(0, totalGain - accumDepreciation);
  const capitalGainsTax = capitalGainTaxable * 0.15;
  const totalExitTax = depRecaptureTax + capitalGainsTax;

  const preTaxNetSaleProceeds = exitValue - exitLoanBalance;
  const afterTaxNetSaleProceeds = Math.max(0, preTaxNetSaleProceeds - totalExitTax);

  const afterTaxIrrFlows: number[] = [];
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

export function calculateTaxMetrics(rawAssetClass: string, inputs: DealInputs): TaxMetrics {
  // Normalise so aliases like 'residential' / 'multi_family' get the 27.5-year residential schedule
  const assetClass = normalizeAssetClass(rawAssetClass);
  const baseRes = calculateProjections(assetClass, inputs);
  const tax = calculateTaxAndDepreciation(assetClass, inputs, baseRes);
  const landAllocationPct = stated(inputs, 'landPercent') ?? 0;
  const effectiveTaxRate = stated(inputs, 'taxRate') ?? 0;
  return {
    depYears: (assetClass === 'single-family' || assetClass === 'multi-unit') ? 27.5 : 39.0,
    depreciableBasis: tax.depreciableBasis,
    annualDepreciation: tax.annualDepreciation,
    annualTaxShield: Math.round(tax.annualDepreciation * (effectiveTaxRate / 100)),
    landAllocationPct,
    effectiveTaxRate
  };
}

// ---------------------------------------------------------------------------
// 12. Mid-Hold Refinance Calculator
// ---------------------------------------------------------------------------
export function calculateRefinanceEvent(
  assetType: string,
  baseInputs: Record<string, any>,
  // The new loan is its own loan: every term is the caller's, none is assumed
  refiYear: number,
  refiLtv: number,
  refiRate: number,
  refiTerm: number,
  refiClosingCostPercent: number
): any {
  const baseRes = calculateProjections(assetType, baseInputs);
  const targetYear = Math.max(1, Math.min(9, parseInt(String(refiYear)) || 3));

  const projAtRefi = baseRes.projections[targetYear - 1];
  if (!projAtRefi) return baseRes;

  const refiValue = projAtRefi.propertyValue;
  const newLoanAmount = refiValue * (refiLtv / 100);
  const oldLoanBalance = projAtRefi.loanBalanceRemaining;
  const refiClosingCosts = newLoanAmount * (refiClosingCostPercent / 100);
  const netCashOut = newLoanAmount - oldLoanBalance - refiClosingCosts;

  const newMonthlyPayment = calculateMonthlyPayment(newLoanAmount, refiRate, refiTerm);
  const newAnnualDebtService = newMonthlyPayment * 12;

  const updatedProjections = JSON.parse(JSON.stringify(baseRes.projections));
  let updatedCashInvested = baseRes.initialCashInvested;

  for (let y = 1; y <= updatedProjections.length; y++) {
    const p = updatedProjections[y - 1];
    if (y === targetYear) {
      p.refiProceeds = Math.round(netCashOut * 100) / 100;
      p.cashFlow = Math.round((p.cashFlow + netCashOut) * 100) / 100;
      updatedCashInvested = Math.max(0, updatedCashInvested - netCashOut);
    } else if (y > targetYear) {
      p.debtService = Math.round(newAnnualDebtService * 100) / 100;
      p.netOperatingIncome = p.effectiveGrossIncome - p.operatingExpenses;
      p.cashFlow = Math.round((p.netOperatingIncome - p.debtService) * 100) / 100;

      const newBalance = calculateRemainingBalance(newLoanAmount, refiRate, refiTerm, y - targetYear);
      p.loanBalanceRemaining = Math.round(newBalance * 100) / 100;
      p.equity = Math.round((p.propertyValue - newBalance) * 100) / 100;
      // Sale proceeds change by exactly the difference between the old loan's balance and the new loan's
      p.exitProceedsNet = Math.round((baseRes.projections[y - 1].exitProceedsNet + baseRes.projections[y - 1].loanBalanceRemaining - newBalance) * 100) / 100;
      p.dscr = p.debtService > 0 ? Math.round((p.netOperatingIncome / p.debtService) * 100) / 100 : null;
    }
  }

  const exitYear = baseRes.projections.length;
  const irrFlows: number[] = [];
  for (let t = 1; t <= exitYear; t++) {
    let cf = updatedProjections[t - 1].cashFlow;
    if (t === exitYear) {
      cf += updatedProjections[t - 1].exitProceedsNet;
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

// ---------------------------------------------------------------------------
// 13. Goal Seek Solver
// ---------------------------------------------------------------------------
export function solveTargetPurchasePrice(assetType: string, baseInputs: Record<string, any>, targetIRR = 15): any {
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

// ---------------------------------------------------------------------------
// 14. Scenario Variants
// ---------------------------------------------------------------------------
export function generateScenarioVariants(assetType: string, baseInputs: Record<string, any>): any {
  const base = { ...baseInputs };
  const bull = { ...baseInputs };
  if (bull.monthlyRent) bull.monthlyRent = Math.round(parseFloat(bull.monthlyRent) * 1.08);
  if (bull.grossRentMonthly) bull.grossRentMonthly = Math.round(parseFloat(bull.grossRentMonthly) * 1.08);
  if (bull.monthlyRentPerUnit) bull.monthlyRentPerUnit = Math.round(parseFloat(bull.monthlyRentPerUnit) * 1.08);
  if (bull.rentPerSqFt) bull.rentPerSqFt = Math.round(parseFloat(bull.rentPerSqFt) * 1.08 * 100) / 100;
  if (bull.vacancyRate) bull.vacancyRate = Math.max(1, Math.round((parseFloat(bull.vacancyRate) - 1.5) * 10) / 10);
  if (bull.rentGrowthRate) bull.rentGrowthRate = Math.round((parseFloat(bull.rentGrowthRate) + 0.5) * 10) / 10;
  if (bull.appreciationRate) bull.appreciationRate = Math.round((parseFloat(bull.appreciationRate) + 0.5) * 10) / 10;

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

// ---------------------------------------------------------------------------
// 15. Portfolio Aggregator
// ---------------------------------------------------------------------------
export function aggregatePortfolio(dealsList: any[]): any {
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

  let maxHold = 10;
  dealsList.forEach(deal => {
    const hold = parseInt(deal.inputs?.holdingPeriod || deal.inputs?.exitYear || deal.inputs?.holdYears || 10, 10);
    if (!isNaN(hold) && hold > maxHold) maxHold = Math.min(30, hold);
    if (deal.results && deal.results.projections && deal.results.projections.length > maxHold) {
      maxHold = Math.min(30, deal.results.projections.length);
    }
  });

  const combinedProjections: any[] = [];
  for (let year = 1; year <= maxHold; year++) {
    combinedProjections.push({
      year,
      propertyValue: 0,
      grossPotentialIncome: 0,
      effectiveGrossIncome: 0,
      operatingExpenses: 0,
      netOperatingIncome: 0,
      debtService: 0,
      cashFlow: 0,
      netCashFlow: 0,
      equity: 0
    });
  }

  const portfolioIrrFlows: number[] = [];
  for (let year = 1; year <= maxHold; year++) {
    portfolioIrrFlows.push(0);
  }

  dealsList.forEach(deal => {
    const qty = (typeof deal.quantity === 'number' && deal.quantity > 0) ? deal.quantity : 1;
    totalUnitsOrDoors += qty;
    const res = deal.results || calculateProjections(deal.assetType || deal.asset_class || 'commercial', deal.inputs);
    totalPurchasePrice += res.purchasePrice * qty;
    totalCashInvested += res.initialCashInvested * qty;
    totalLoanAmount += res.loanAmount * qty;

    res.projections.forEach((p: any, idx: number) => {
      if (combinedProjections[idx]) {
        combinedProjections[idx].propertyValue += p.propertyValue * qty;
        combinedProjections[idx].grossPotentialIncome += p.grossPotentialIncome * qty;
        combinedProjections[idx].effectiveGrossIncome += p.effectiveGrossIncome * qty;
        combinedProjections[idx].operatingExpenses += p.operatingExpenses * qty;
        combinedProjections[idx].netOperatingIncome += p.netOperatingIncome * qty;
        combinedProjections[idx].debtService += p.debtService * qty;
        combinedProjections[idx].cashFlow += p.cashFlow * qty;
        combinedProjections[idx].equity += p.equity * qty;

        portfolioIrrFlows[idx] += (p.cashFlow * qty) + (idx === (maxHold - 1) ? (p.exitProceedsNet * qty) : 0);
      }
    });
  });

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

// ---------------------------------------------------------------------------
// 17. Holding Period Wealth Deconstruction
// ---------------------------------------------------------------------------
export function calculateHoldingPeriodWealth(inputs: Record<string, any>, projections: any[], amortizationSchedule: any[], holdYear = 1): any {
  if (!projections || projections.length === 0) return null;
  const year = Math.max(1, Math.min(projections.length, parseInt(String(holdYear)) || 1));
  const yearIdx = year - 1;
  const proj = projections[yearIdx];
  const purchasePrice = parseFloat(inputs.purchasePrice) || 0;
  const rehabCosts = parseFloat(inputs.rehabCosts) || 0;
  const closingCosts = parseFloat(inputs.closingCosts) || 0;
  const rehabFinancingMode = inputs.rehabFinancingMode || (inputs.financeRehabAndClosingCosts ? 'roll_into_loan' : 'out_of_pocket');
  const isRehabFinanced = rehabFinancingMode === 'roll_into_loan';
  const totalFinancedBasis = isRehabFinanced ? purchasePrice + rehabCosts + closingCosts : purchasePrice;
  const downPaymentPercent = resolveDownPaymentPercent(inputs, totalFinancedBasis);

  const downPaymentAmount = totalFinancedBasis * (downPaymentPercent / 100);
  const initialCashInvested = isRehabFinanced
    ? downPaymentAmount
    : (downPaymentAmount + rehabCosts + closingCosts);

  const initialLoan = Math.max(0, isRehabFinanced ? totalFinancedBasis - downPaymentAmount : purchasePrice - downPaymentAmount);

  const currentPropertyValue = proj ? proj.propertyValue : purchasePrice;
  const remainingLoanBalance = proj ? proj.loanBalanceRemaining : initialLoan;

  const principalPaydownEquity = Math.max(0, initialLoan - remainingLoanBalance);
  const appreciationEquity = Math.max(0, currentPropertyValue - purchasePrice);
  const totalNetEquity = Math.max(0, currentPropertyValue - remainingLoanBalance);

  let cumulativeCashFlow = 0;
  for (let i = 0; i <= yearIdx; i++) {
    cumulativeCashFlow += (projections[i] ? projections[i].cashFlow : 0);
  }

  const totalNetWealth = totalNetEquity + cumulativeCashFlow;
  const netProfit = totalNetWealth - initialCashInvested;
  const totalNetBenefit = totalNetWealth;

  const prevEquity = yearIdx === 0 ? initialCashInvested : (projections[yearIdx - 1] ? projections[yearIdx - 1].equity : 0);
  const currentCashFlow = proj ? proj.cashFlow : 0;
  let roe = null;
  let roeDisplay = 'N/M';
  if (prevEquity > 0) {
    roe = (currentCashFlow / prevEquity) * 100;
    roeDisplay = roe.toFixed(2) + '%';
  } else if (currentCashFlow > 0) {
    roeDisplay = 'N/M (100% Financed)';
  }

  const discountRate = stated(inputs, ...KEYS.discountRate) ?? 0;
  let holdNpv = -initialCashInvested;
  for (let t = 1; t <= year; t++) {
    let cf = projections[t - 1] ? projections[t - 1].cashFlow : 0;
    if (t === year) {
      cf += (projections[t - 1] ? projections[t - 1].exitProceedsNet : 0);
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
    roeDisplay,
    holdNpv: Math.round(holdNpv * 100) / 100
  };
}

// ---------------------------------------------------------------------------
// 18. Deal Risk Auditor
// ---------------------------------------------------------------------------
export function auditDealRisks(assetType: string, inputs: Record<string, any>, results: any): any[] {
  const warnings: any[] = [];
  if (!results || !results.projections || results.projections.length === 0) {
    return warnings;
  }

  const fullYearProjs = results.projections.filter((p: any) => (p.operatingMonths ?? 12) >= 12);
  const covenantProjs = fullYearProjs.length > 0 ? fullYearProjs : results.projections;
  const validDscrs = covenantProjs.filter((p: any) => p.dscr !== null).map((p: any) => p.dscr);
  const minDscr = validDscrs.length > 0 ? Math.min(...validDscrs) : 1.5;

  if (minDscr < 1.0) {
    warnings.push({
      level: 'danger',
      title: 'Critical Debt Service Risk (DSCR < 1.0x)',
      description: `Property NOI falls below annual mortgage payments (min stabilized DSCR is ${minDscr.toFixed(2)}x), causing negative leverage.`
    });
  } else if (minDscr < 1.25) {
    warnings.push({
      level: 'warning',
      title: 'Tight Lenders Coverage (DSCR < 1.25x)',
      description: `Minimum stabilized DSCR is ${minDscr.toFixed(2)}x, which may fail traditional commercial underwriting standards (1.25x minimum).`
    });
  }

  // Preserve stub-year signal: if Year 1 is a partial stub and its coverage is below 1.25x, emit low-severity info note
  const p0 = results.projections[0];
  if (p0 && Number(p0.operatingMonths) < 12 && p0.dscr !== null && p0.dscr < 1.25) {
    warnings.push({
      level: 'info',
      title: 'Partial Stub-Year Coverage Note',
      description: `Initial ${p0.operatingMonths}-month stub period carries ${Number(p0.dscr).toFixed(2)}x debt coverage prior to full-year stabilization (${minDscr.toFixed(2)}x stabilized DSCR).`
    });
  }

  const negYears = results.projections.filter((p: any) => p.cashFlow < 0).map((p: any) => p.year);
  if (negYears.length > 0) {
    warnings.push({
      level: 'warning',
      title: `Negative Net Cash Flow (Years: ${negYears.join(', ')})`,
      description: `Deal requires supplemental out-of-pocket capital injections during projected operational years.`
    });
  }

  if (results.ltv > 80) {
    warnings.push({
      level: 'warning',
      title: 'High Initial Leverage (LTV > 80%)',
      description: `Acquisition down payment is under 20%, increasing interest rate risk and default vulnerability.`
    });
  }

  if (results.breakEvenYear === 'N/A' || results.breakEvenYear > 6) {
    warnings.push({
      level: 'info',
      title: 'Extended Payback Horizon',
      description: `Break-even year is ${results.breakEvenYear}, indicating longer equity payback duration.`
    });
  }

  const pPrice = parseFloat(inputs.purchasePrice) || 0;
  const targetArv = parseFloat(inputs.arv) || 0;
  const rehabCost = parseFloat(inputs.rehabCosts) || parseFloat(inputs.rehabBudget) || 0;
  if (targetArv > pPrice && rehabCost <= 0 && (assetType === 'single-family' || assetType === 'residential' || assetType === 'multi-unit')) {
    warnings.push({
      level: 'warning',
      title: 'Unsubstantiated ARV Markup',
      description: `Target ARV ($${Math.round(targetArv).toLocaleString()}) exceeds Day 1 purchase price ($${Math.round(pPrice).toLocaleString()}) without an underwritten rehab budget.`
    });
  }

  // Leases that run out inside the hold: say what the numbers assume happens next
  const lastProj = results.projections[results.projections.length - 1];
  const holdEndIdx = (Number(lastProj?.calendarYear) || 0) * 12 + 12;
  (Array.isArray(inputs.leases) ? inputs.leases : []).forEach((l: any) => {
    const m = String(l?.leaseEndDate || "").match(/(\d{4})[-/](\d{1,2})/);
    if (!m || !holdEndIdx) return;
    const endIdx = parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
    if (endIdx >= holdEndIdx) return;
    const who = l.tenantName || "The in-place lease";
    const mode = String(l?.expiryAssumption || "renew");
    const fromDefault = l?.expirySource === "default" || !l?.expiryAssumption;
    const where = fromDefault ? "your investor default (Profile) applies; change it for this property in Edit Inputs" : "set in Edit Inputs";
    if (mode === "vacant" || mode === "none") {
      warnings.push({
        level: "warning",
        title: "Lease Expires Inside Hold Period",
        description: `${who} ends ${l.leaseEndDate}, before the hold period ends. Pessimistic case: the space stays vacant and income is $0 after expiry (${where}).`
      });
    } else if (mode === "relet") {
      warnings.push({
        level: "info",
        title: "Lease Expires Inside Hold Period",
        description: `${who} ends ${l.leaseEndDate}, before the hold period ends. Assumes a vacancy of ${Math.round(Number(l.reletVacancyMonths ?? 12))} months, then re-leasing at the expiring rent with annual increases (${where}).`
      });
    } else {
      warnings.push({
        level: "info",
        title: "Lease Expires Inside Hold Period",
        description: `${who} ends ${l.leaseEndDate}, before the hold period ends. Assumes it renews on current terms, with annual increases continuing (${where}).`
      });
    }
  });

  if (!warnings.some((w: any) => w.level !== 'info')) {
    warnings.push({
      level: 'success',
      title: 'Robust Financial Profile',
      description: 'Deal passes core DSCR, positive cash flow, and leverage health benchmarks.'
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// 19. Browser & Universal Scope Export Map
// ---------------------------------------------------------------------------
export const PropertyMath = {
  calculateProjections,
  calculateMonthlyProjections,
  calculateMonthlyPayment,
  getAnnualAmortization,
  getMonthlyAmortization,
  calculateRemainingBalance,
  calculateSensitivityMatrix,
  buildAdaptiveHistogramBins,
  calculateTaxAndDepreciation,
  calculateTaxMetrics,
  calculateRefinanceEvent,
  solveTargetPurchasePrice,
  aggregatePortfolio,
  auditDealRisks,
  generateScenarioVariants,
  calculateHoldingPeriodWealth,
  calculateNPV,
  calculateIRR,
  normalizeAssetClass,
};

if (typeof globalThis !== 'undefined') {
  (globalThis as any).PropertyMath = PropertyMath;
}
if (typeof window !== 'undefined') {
  (window as any).PropertyMath = PropertyMath;
}
