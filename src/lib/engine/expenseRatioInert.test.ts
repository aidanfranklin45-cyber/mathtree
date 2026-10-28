import { describe, it, expect } from 'vitest';
import { computeDealMetrics, expenseRatioIsInert } from './compute';

// A commercial deal with no rent: the engine charges the stated carrying costs, so the expense ratio cannot move NOI
const land: Record<string, any> = {
  purchasePrice: 100000, downPaymentPercent: 20, interestRate: 7, amortizationYears: 25, loanMaturityYears: 25, closingDate: '2026-01-01',
  vacancyRate: 5, expenseRatio: 25, rentGrowth: 3, targetCapRate: 7, sellingCostPercent: 0, closingCosts: 0, discountRate: 8,
  holdingPeriod: 10, exitYear: 10, capexReserveAnnual: 0, annualTaxes: 3000, annualInsurance: 1500, annualMaintenance: 2000, leaseType: 'NNN',
};
const rented = { ...land, monthlyRent: 2000, grossRentAnnual: 24000 };

describe('expense ratio on a deal with no income', () => {
  it('does not change NOI when carrying costs are stated', () => {
    const noi = (r: number) => computeDealMetrics({ asset_class: 'commercial', inputs: { ...land, expenseRatio: r, operatingExpenseRatio: r } as any }).projections[0].netOperatingIncome;
    expect(noi(10)).toBeLessThan(0);
    expect(noi(10)).toBe(noi(60));
    expect(expenseRatioIsInert({ asset_class: 'commercial', inputs: land as any })).toBe(true);
  });
  it('does change NOI when the deal has rent', () => {
    expect(expenseRatioIsInert({ asset_class: 'commercial', inputs: rented as any })).toBe(false);
  });
});
