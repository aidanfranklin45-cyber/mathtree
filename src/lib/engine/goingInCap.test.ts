import { describe, it, expect } from 'vitest';
import { computeDealMetrics } from './compute';

/** A lease that starts after closing makes year 1 a partial year; the going-in cap rate must use a full year of income. */
const deal = (over: Record<string, unknown> = {}): any => ({
  id: 'd1', asset_class: 'commercial', purchase_price: 300000,
  inputs: {
    purchasePrice: 300000, downPaymentPercent: 0, interestRate: 4.53, loanTerm: 20, exitYear: 10, closingDate: '2025-07-15',
    closingCosts: 12000, grossRentAnnual: 31200, monthlyRent: 2600, vacancyRate: 1, expenseRatio: 1, targetCapRate: 7.5,
    leaseType: 'NNN', discountRate: 6, exitCapTiming: 'amortized',
    leases: [{ tenantName: 'T', monthlyRent: 2600, annualRent: 31200, leaseStartDate: '2025-08-03', leaseEndDate: '2045-08-03', escalationRate: 3, nextEscalationDate: '2026-08-03', leaseType: 'NNN' }],
    ...over,
  },
});

describe('going-in cap rate with a partial first year', () => {
  const m: any = computeDealMetrics(deal());
  const p1 = m.projections[0];
  const p2 = m.projections[1];

  it('year 1 is partial (the premise of this test)', () => {
    expect(p1.netOperatingIncome).toBeLessThan(p2.netOperatingIncome * 0.6);
  });

  it('values the asset off the first full year, not a partial year (no jump in value, no ~4% cap rate)', () => {
    const goingIn = (p2.netOperatingIncome / 300000) * 100;
    expect(m.capRate).toBeGreaterThan(goingIn - 0.5);
    expect(m.capRate).toBeLessThan(goingIn + 0.1);
    expect(p2.propertyValue).toBeLessThan(300000 * 1.1);
  });

  it('still converges to the target cap rate at exit', () => {
    expect(m.projections[m.projections.length - 1].capRate).toBeCloseTo(7.5, 1);
  });

  it('is unchanged for a deal whose year 1 is already a full year', () => {
    const full: any = computeDealMetrics(deal({ closingDate: '2025-01-01', leases: [{ tenantName: 'T', monthlyRent: 2600, leaseStartDate: '2025-01-01', leaseEndDate: '2045-01-01', escalationRate: 3, leaseType: 'NNN' }] }));
    const f1 = full.projections[0];
    expect(f1.capRate).toBeCloseTo((f1.netOperatingIncome / 300000) * 100, 1);
  });

  it('holds value at cost through every partial year when income starts late, then values off the first full year', () => {
    const late: any = computeDealMetrics(deal({ leases: [{ tenantName: 'T', monthlyRent: 2600, annualRent: 31200, leaseStartDate: '2026-08-03', leaseEndDate: '2046-08-03', escalationRate: 3, nextEscalationDate: '2027-08-03', leaseType: 'NNN' }] }));
    const [y1, y2, y3] = late.projections;
    expect(y1.propertyValue).toBe(300000);
    expect(y2.propertyValue).toBe(300000);
    expect(y3.propertyValue).toBeLessThan(300000 * 1.1);
    expect(y3.capRate).toBeGreaterThan(9);
  });
});
