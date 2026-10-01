import { describe, it, expect } from 'vitest';
import { buildBaselineDraft, compareToBaseline, type BaselineRow } from './core';
import { computeDealMetrics } from '../engine/compute';

/** Pure fixtures, no database. A deal projected at $2,600/month from closing. */
const deal: any = {
  id: 'deal-1',
  asset_class: 'commercial',
  purchase_price: 300000,
  inputs: {
    purchasePrice: 300000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 25, exitYear: 12, closingDate: '2025-07-15',
    closingCosts: 9000, grossRentAnnual: 31200, monthlyRent: 2600, vacancyRate: 1, expenseRatio: 1, targetCapRate: 7.5, leaseType: 'NNN', discountRate: 8,
  },
};
const draft = buildBaselineDraft(deal, 'user-1');
const baseline: BaselineRow = { ...draft, id: 'b1', captured_at: '2025-07-20T00:00:00Z' };
const live: any = computeDealMetrics(deal);
const now = new Date('2026-09-30T12:00:00');
const pay = (period: string, paid: number, status = 'paid') => ({ period_month: `${period}-01`, amount_due: 2600, amount_paid: paid, status });
const cmp = (payments: any[]) => compareToBaseline({ baseline, live, payments, leases: [{ monthly_rent: 2600, is_active: true }], deal, now });

describe('months with no payment record are "not recorded", not "collected nothing"', () => {
  it('marks only the months that have a record, and counts coverage', () => {
    const c = cmp([pay('2026-09', 2600)]);
    const recorded = c.months.filter((m) => m.recorded).map((m) => m.month);
    expect(recorded).toEqual(['2026-09']);
    expect(c.coverage.ytd.recorded).toBe(1);
    expect(c.coverage.ytd.total).toBe(9); // Jan to Sep had projected income
  });

  it('compares collections only with the projection for the recorded months (one good month is not 8% of a year)', () => {
    const c = cmp([pay('2026-09', 2600)]);
    const cov = c.coverage.ytd;
    const pct = (c.collectedYtd / cov.expectedRecorded) * 100;
    expect(pct).toBeGreaterThan(95);
    expect(pct).toBeLessThan(110);
    // the full-year projection is still reported as it was
    expect(c.expectedYtd).toBeGreaterThan(cov.expectedRecorded * 8);
  });

  it('with every month recorded, coverage is complete and the comparison is the plain total', () => {
    const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const c = cmp(months.map((m) => pay(m, 2600)));
    expect(c.coverage.trailing12.recorded).toBe(12);
    expect(c.coverage.trailing12.total).toBe(12);
    expect(c.coverage.trailing12.expectedRecorded).toBeCloseTo(c.trailing12.expected, 2);
    expect(c.trailing12.collected).toBe(31200);
  });

  it('no records at all: nothing recorded, so there is no percentage to show', () => {
    const c = cmp([]);
    expect(c.coverage.ytd.recorded).toBe(0);
    expect(c.coverage.ytd.expectedRecorded).toBe(0);
    expect(c.coverage.trailing12.recorded).toBe(0);
  });

  it('a past month with a row but nothing collected is a real shortfall, not "not recorded"', () => {
    const c = cmp([pay('2026-07', 0, 'overdue'), pay('2026-08', 2600)]);
    const jul = c.months.find((m) => m.month === '2026-07');
    expect(jul?.recorded).toBe(true);
    expect(jul?.collected).toBe(0);
    expect(c.coverage.ytd.recorded).toBe(2);
    expect(c.collectedYtd).toBe(2600); // 2,600 of the 5,200 projected for those two months
    expect(c.collectedYtd).toBeLessThan(c.coverage.ytd.expectedRecorded * 0.6);
  });

  it('the current month stays "not recorded" until something has come in', () => {
    const pending = cmp([pay('2026-09', 0, 'pending')]);
    expect(pending.months.find((m) => m.isCurrent)?.recorded).toBe(false);
    expect(pending.coverage.ytd.recorded).toBe(0);
    const paid = cmp([pay('2026-09', 2600)]);
    expect(paid.months.find((m) => m.isCurrent)?.recorded).toBe(true);
  });

  it('a partial payment counts as recorded, with what was actually collected', () => {
    const c = cmp([pay('2026-08', 1000, 'partial'), pay('2026-09', 2600)]);
    expect(c.months.find((m) => m.month === '2026-08')?.collected).toBe(1000);
    expect(c.coverage.ytd.recorded).toBe(2);
  });
});
