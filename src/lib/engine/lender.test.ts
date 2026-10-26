import { describe, it, expect } from 'vitest';
import { calculateLenderMetrics, calculateProjections, firstFullYear, LENDER_STRESS } from './index';
import { withLegacyDefaults } from './testInputs';

const inputs = withLegacyDefaults('commercial', {
  purchasePrice: 1_000_000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30, grossRentAnnual: 120_000,
  vacancyRate: 5, expenseRatio: 20, closingCosts: 20_000, rehabCosts: 30_000, exitYear: 10,
});

describe('calculateLenderMetrics', () => {
  const m = calculateLenderMetrics('commercial', inputs);
  const direct = calculateProjections('commercial', inputs);
  const y1: any = firstFullYear(direct.projections as any[]);

  it('reads coverage and debt yield from the same run as the pro forma', () => {
    expect(m.loanAmount).toBe(direct.loanAmount);
    expect(m.netOperatingIncome).toBe(y1.netOperatingIncome);
    expect(m.debtService).toBe(y1.debtService);
    expect(m.dscr).toBeCloseTo(y1.netOperatingIncome / y1.debtService, 10);
    expect(m.debtYield).toBeCloseTo((y1.netOperatingIncome / direct.loanAmount) * 100, 10);
  });

  it('computes break-even occupancy as (operating expenses + debt service) over potential gross income', () => {
    const gpi = y1.grossPotentialIncome ?? y1.grossPotentialRent;
    expect(m.breakEvenOccupancyPct).toBeCloseTo(((y1.operatingExpenses + y1.debtService) / gpi) * 100, 10);
    expect(m.breakEvenOccupancyPct!).toBeGreaterThan(0);
    expect(m.breakEvenOccupancyPct!).toBeLessThan(100);
  });

  it('stresses NOI down and the rate up, and the combination is the worst', () => {
    const by = Object.fromEntries(m.stress.map((r) => [r.id, r]));
    expect(by.base.dscr).toBe(m.dscr);
    expect(by.noi.netOperatingIncome).toBeCloseTo(m.netOperatingIncome * (1 - LENDER_STRESS.noiDeclinePercent / 100), 6);
    expect(by.noi.debtService).toBe(m.debtService);
    expect(by.rate.debtService).toBeGreaterThan(m.debtService);
    expect(by.rate.netOperatingIncome).toBeCloseTo(m.netOperatingIncome, 6);
    expect(by.both.dscr!).toBeLessThan(by.noi.dscr!);
    expect(by.both.dscr!).toBeLessThan(by.rate.dscr!);
    expect(by.rate.dscr!).toBeLessThan(by.base.dscr!);
  });

  it('reports what is owed against the projected value at the end of the hold', () => {
    const last: any = direct.projections[direct.projections.length - 1];
    expect(m.atExit.propertyValue).toBe(last.propertyValue);
    expect(m.atExit.loanBalance).toBe(last.loanBalanceRemaining ?? last.endingLoanBalance);
    expect(m.atExit.ltvPct).toBeCloseTo((m.atExit.loanBalance / m.atExit.propertyValue) * 100, 10);
    expect(m.atExit.ltvPct!).toBeLessThan(75);
  });

  it('has no coverage figures when there is no loan', () => {
    const cash = calculateLenderMetrics('commercial', { ...inputs, downPaymentPercent: 100 });
    expect(cash.dscr).toBeNull();
    expect(cash.debtYield).toBeNull();
    expect(cash.stress.every((r) => r.dscr === null)).toBe(true);
  });
});
