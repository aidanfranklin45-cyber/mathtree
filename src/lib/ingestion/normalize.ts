/**
 * The arithmetic the parser is not allowed to do. The model reports what the document says (a value and the period it is stated in);
 * everything that converts, annualises or sums happens here, deterministically, so it can be tested and never hallucinated.
 */

import type {
  ExpenseCategory,
  IncomeCategory,
  LeaseIntake,
  OperatingStatementIntake,
  RentRollIntake,
  RentRollRow,
} from './intake';
import { val } from './intake';

/** Expense categories that are not operating expenses: they are shown on a statement but kept out of the expense ratio. */
export const NON_OPERATING: ReadonlySet<ExpenseCategory> = new Set(['reserves_capex', 'debt_service', 'depreciation_amortization']);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whole months covered by a statement period, counting both end months (2025-01-01 to 2025-12-31 is 12). Null if either date is missing. */
export function periodMonths(start: string | null, end: string | null): number | null {
  const a = /^(\d{4})-(\d{2})/.exec(start ?? '');
  const b = /^(\d{4})-(\d{2})/.exec(end ?? '');
  if (!a || !b) return null;
  const months = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) + 1;
  return months >= 1 ? months : null;
}

/** A lease's base rent per month, from whatever period the lease states it in. Null when the rent, period (or square feet) is missing. */
export function leaseMonthlyRent(lease: LeaseIntake): number | null {
  const rent = val(lease.baseRent);
  const period = val(lease.baseRentPeriod);
  if (rent === null || period === null || !(rent >= 0)) return null;
  const sf = val(lease.squareFeet);
  switch (period) {
    case 'monthly':
      return round2(rent);
    case 'annual':
      return round2(rent / 12);
    case 'per_sf_annual':
      return sf !== null && sf > 0 ? round2((rent * sf) / 12) : null;
    case 'per_sf_monthly':
      return sf !== null && sf > 0 ? round2(rent * sf) : null;
  }
}

/** One rent-roll row's monthly rent. Null when the row has no rent or the roll's period is unknown. */
export function rowMonthlyRent(row: RentRollRow, rollPeriod: 'monthly' | 'annual' | null): number | null {
  const rent = val(row.monthlyRent);
  if (rent === null || rollPeriod === null) return null;
  return round2(rollPeriod === 'annual' ? rent / 12 : rent);
}

export function rentRollTotals(roll: RentRollIntake): { monthlyRent: number; rowsWithRent: number; occupied: number; vacant: number } {
  const period = val(roll.rentPeriod);
  let monthlyRent = 0;
  let rowsWithRent = 0;
  let occupied = 0;
  let vacant = 0;
  for (const row of roll.rows) {
    const status = val(row.status);
    if (status === 'vacant') {
      vacant += 1;
      continue;
    }
    occupied += 1;
    const rent = rowMonthlyRent(row, period);
    if (rent !== null) {
      monthlyRent += rent;
      rowsWithRent += 1;
    }
  }
  return { monthlyRent: round2(monthlyRent), rowsWithRent, occupied, vacant };
}

export interface StatementTotals {
  /** Months the statement covers; null when the dates are missing. Amounts below are annualised from it (x 12 / months). */
  months: number | null;
  annualFactor: number | null;
  /** Annualised revenue by category (vacancy as a positive loss figure). */
  income: Record<IncomeCategory, number>;
  /** Rent plus recoveries: the revenue the engine treats as gross rent. Before vacancy. */
  grossRent: number;
  /** Operating expenses only: reserves, debt service and depreciation excluded. */
  operatingExpenses: number;
  excludedExpenses: number;
  /** Annualised, by category (operating only). */
  expensesByCategory: Partial<Record<ExpenseCategory, number>>;
  linesMissingAmount: number;
}

export function statementTotals(stmt: OperatingStatementIntake): StatementTotals {
  const months = periodMonths(val(stmt.periodStart), val(stmt.periodEnd));
  const factor = months ? 12 / months : null;
  const annual = (n: number) => (factor === null ? n : n * factor);

  const income: Record<IncomeCategory, number> = { rent: 0, recoveries: 0, other_income: 0, vacancy_credit_loss: 0, other: 0 };
  let linesMissingAmount = 0;
  for (const line of stmt.income) {
    const amount = val(line.amount);
    if (amount === null) {
      linesMissingAmount += 1;
      continue;
    }
    const category = val(line.category) ?? 'other';
    // A vacancy or credit-loss line is printed as a negative on some statements and a positive on others. It is always a loss.
    income[category] += category === 'vacancy_credit_loss' ? Math.abs(annual(amount)) : annual(amount);
  }

  let operatingExpenses = 0;
  let excludedExpenses = 0;
  const expensesByCategory: Partial<Record<ExpenseCategory, number>> = {};
  for (const line of stmt.expenses) {
    const amount = val(line.amount);
    if (amount === null) {
      linesMissingAmount += 1;
      continue;
    }
    const category = val(line.category) ?? 'other';
    const a = annual(Math.abs(amount));
    if (NON_OPERATING.has(category)) {
      excludedExpenses += a;
    } else {
      operatingExpenses += a;
      expensesByCategory[category] = round2((expensesByCategory[category] ?? 0) + a);
    }
  }

  for (const k of Object.keys(income) as IncomeCategory[]) income[k] = round2(income[k]);
  return {
    months,
    annualFactor: factor,
    income,
    grossRent: round2(income.rent + income.recoveries),
    operatingExpenses: round2(operatingExpenses),
    excludedExpenses: round2(excludedExpenses),
    expensesByCategory,
    linesMissingAmount,
  };
}
