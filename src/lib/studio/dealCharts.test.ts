import { describe, it, expect } from 'vitest';
import { coverageSeries, equityGrowth, incomeBreakdown, paybackYear } from './dealCharts';

describe('deal overview chart data', () => {
  it('splits gross rent into vacancy, expenses, loan interest, principal and cash flow', () => {
    const b = incomeBreakdown({ grossPotentialRent: 100_000, vacancyLoss: 5_000, operatingExpenses: 35_000, interestPaid: 25_000, principalPaid: 10_000, cashFlow: 25_000 });
    expect(b.gross).toBe(100_000);
    expect(b.slices.map((s) => s.key)).toEqual(['vacancy', 'opex', 'interest', 'principal', 'cashFlow']);
    expect(b.slices.reduce((a, s) => a + s.value, 0)).toBe(100_000);
    expect(b.shortfall).toBe(0);
  });

  it('reports a cash shortfall instead of drawing a negative slice, and skips empty slices', () => {
    const b = incomeBreakdown({ grossPotentialRent: 60_000, vacancyLoss: 0, operatingExpenses: 30_000, interestPaid: 28_000, principalPaid: 7_000, cashFlow: -5_000 });
    expect(b.slices.map((s) => s.key)).toEqual(['opex', 'interest', 'principal']);
    expect(b.shortfall).toBe(5_000);
    expect(incomeBreakdown(undefined)).toEqual({ gross: 0, slices: [], shortfall: 0 });
  });

  it('grows equity from the day of purchase and adds cash collected', () => {
    const pts = equityGrowth(
      [{ year: 1, cashFlow: 10_000, propertyValue: 1_030_000, endingLoanBalance: 740_000 }, { year: 2, cashFlow: 12_000, propertyValue: 1_060_000, endingLoanBalance: 730_000 }],
      1_000_000, 750_000,
    );
    expect(pts[0]).toMatchObject({ year: 0, equity: 250_000, total: 250_000 });
    expect(pts[1]).toMatchObject({ year: 1, equity: 290_000, cumulativeCash: 10_000, total: 300_000 });
    expect(pts[2]).toMatchObject({ year: 2, equity: 330_000, cumulativeCash: 22_000, total: 352_000 });
    // Equity is not cash back: $300,000 of value built against $250,000 in is not a payback while only $10,000 has been paid to you
    expect(paybackYear(pts, 250_000)).toBeNull();
    expect(paybackYear(pts, 400_000)).toBeNull();
    // Cash back counts: $10,000 then $12,000 received covers $15,000 put in during year 2
    const small = equityGrowth(
      [{ year: 1, cashFlow: 10_000, propertyValue: 1_030_000, endingLoanBalance: 740_000 }, { year: 2, cashFlow: 12_000, propertyValue: 1_060_000, endingLoanBalance: 730_000 }],
      1_000_000, 750_000, 15_000,
    );
    expect(paybackYear(small, 15_000)).toBe(2);
  });

  it('computes coverage each year and leaves it blank for an all-cash deal', () => {
    const c = coverageSeries([{ year: 1, netOperatingIncome: 75_000, debtService: 60_000 }, { year: 2, netOperatingIncome: 50_000, debtService: 0 }]);
    expect(c[0]).toEqual({ year: 1, noi: 75_000, debtService: 60_000, dscr: 1.25 });
    expect(c[1].dscr).toBeNull();
  });
});
