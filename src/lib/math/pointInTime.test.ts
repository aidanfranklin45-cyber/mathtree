import { describe, it, expect } from 'vitest';
import { resolvePointInTimeDealMetrics } from './pointInTime';
import { computeDealMetrics } from '../engine/compute';

// Facts only: no metrics, irr, total_equity, year1_cashflow or any other stored analysis.
const facts = (over: Record<string, any> = {}): any => ({
  id: 'x',
  asset_class: 'commercial',
  status: 'owned',
  purchase_price: 1000000,
  inputs: {
    purchasePrice: 1000000, downPaymentPercent: 25, interestRate: 6, loanTerm: 30,
    grossRentAnnual: 120000, vacancyRate: 5, expenseRatio: 20, rentGrowth: 3, appreciationRate: 3,
    closingCosts: 10000, closingDate: '2024-01-15',
  },
  ...over,
});

describe('resolvePointInTimeDealMetrics without stored analysis', () => {
  it('pipeline deal: acquisition numbers come from the engine', () => {
    const d = facts({ status: 'prospect' });
    const pit = resolvePointInTimeDealMetrics(d, new Date('2026-06-01'));
    const m = computeDealMetrics(d);
    expect(pit.currentDebt).toBeCloseTo(m.loanAmount, 0);
    expect(pit.currentEquity).toBeCloseTo(d.purchase_price - m.loanAmount, 0);
    expect(pit.initialCashInvested).toBeCloseTo(m.initialCashInvested as number, 0);
    expect(pit.currentEquity).toBeLessThanOrEqual(pit.currentVal);
    expect(pit.irr).toBeCloseTo(m.irr, 5);
    expect(pit.currentCashFlow).toBeCloseTo(m.year1Cashflow, 0);
    expect(pit.currentDebt).toBeGreaterThan(0);
  });

  it('owned deal: balance amortises from the engine loan and equity grows', () => {
    const d = facts();
    const m = computeDealMetrics(d);
    const early = resolvePointInTimeDealMetrics(d, new Date('2024-02-15'));
    const later = resolvePointInTimeDealMetrics(d, new Date('2029-01-15'));
    expect(early.baseLoanAmount).toBeCloseTo(m.loanAmount, 0);
    expect(later.currentDebt).toBeLessThan(early.currentDebt);
    expect(later.currentEquity).toBeGreaterThan(early.currentEquity);
    expect(later.currentNoi).toBeGreaterThan(0);
    expect(later.irr).toBeCloseTo(m.irr, 5);
  });

  it('owned deal is not zeroed by elapsed months (regression: maxMonths capped the loan term)', () => {
    const later = resolvePointInTimeDealMetrics(facts(), new Date('2026-06-01'));
    // 30-yr loan, 29 months in: balance must still be ~96-99% of the original loan
    expect(later.currentDebt).toBeGreaterThan(0.9 * later.baseLoanAmount);
  });

  it('a deal with no usable inputs degrades to zeros instead of throwing', () => {
    const pit = resolvePointInTimeDealMetrics({ id: 'e', asset_class: 'commercial', status: 'prospect', purchase_price: 0, inputs: {} } as any);
    expect(Number.isFinite(pit.currentDebt)).toBe(true);
  });

  it('unleveraged prospect equity equals purchase price and never exceeds current value when closing costs exist', () => {
    const d = facts({
      status: 'prospect',
      purchase_price: 785300,
      inputs: {
        purchasePrice: 785300,
        downPaymentPercent: 100,
        closingCosts: 35000,
      },
    });
    const pit = resolvePointInTimeDealMetrics(d);
    expect(pit.currentVal).toBe(785300);
    expect(pit.currentDebt).toBe(0);
    expect(pit.currentEquity).toBe(785300);
    expect(pit.currentEquity).toBeLessThanOrEqual(pit.currentVal);
    expect(pit.initialCashInvested).toBe(820300); // 785,300 + 35,000
  });
});

import { generateMonthlyAmortizationSchedule, resolveCalendarProjections } from './pointInTime';

describe('single-calculator consolidation', () => {
  it('monthly schedule ties to the engine annual amortization and the loan term is untouched', () => {
    const d = facts();
    const m = computeDealMetrics(d);
    const rows = generateMonthlyAmortizationSchedule(d, 360);
    expect(rows).toHaveLength(360);
    expect(rows[0].beginningBalance).toBeCloseTo(m.loanAmount, 0);
    // End of year 1 balance matches the engine's annual schedule
    expect(rows[11].endingBalance).toBeCloseTo(m.amortizationSchedule[0].endingBalance, 0);
    expect(rows[359].endingBalance).toBeCloseTo(0, 0);
    // A short display window must not re-amortise the loan over fewer months
    const first24 = generateMonthlyAmortizationSchedule(d, 24);
    expect(first24).toHaveLength(24);
    expect(first24[23].endingBalance).toBeCloseTo(rows[23].endingBalance, 2);
  });

  it('calendar pro-forma is a pure reshape of engine projections (no second income model)', () => {
    const d = facts({ inputs: { ...facts().inputs, expenseRatio: 0, leaseType: 'NNN' } });
    const m = computeDealMetrics(d);
    const cal = resolveCalendarProjections(d, 10);
    expect(cal).toHaveLength(m.projections.length >= 10 ? 10 : m.projections.length);
    cal.forEach((c, i) => {
      expect(c.netOperatingIncome).toBe(m.projections[i].netOperatingIncome);
      expect(c.debtService).toBe(m.projections[i].debtService);
      expect(c.endingLoanBalance).toBe(m.projections[i].loanBalanceRemaining);
      expect(m.projections[i].endingLoanBalance).toBe(m.projections[i].loanBalanceRemaining);
      expect(m.projections[i].grossPotentialRent).toBe(m.projections[i].grossPotentialIncome);
    });
  });

  it('applies no hidden default expense ratio: 0% in, 0 opex out', () => {
    const d = facts({ inputs: { ...facts().inputs, expenseRatio: 0 } });
    expect(computeDealMetrics(d).projections[1].operatingExpenses).toBe(0);
  });
});
