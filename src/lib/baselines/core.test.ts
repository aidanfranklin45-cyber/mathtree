import { describe, it, expect } from 'vitest';
import { buildBaselineDraft, compareToBaseline, firstFullYear, type BaselineRow } from './core';
import { computeDealMetrics } from '../engine/compute';
import { ENGINE_VERSION } from '../engine/version';

/** Pure tests: in-memory fixtures only, no database access. */
const deal: any = {
  id: 'deal-1',
  asset_class: 'commercial',
  purchase_price: 300000,
  inputs: {
    purchasePrice: 300000, downPaymentPercent: 0, interestRate: 4.53, loanTerm: 20, exitYear: 15, closingDate: '2025-07-15',
    closingCosts: 12000, grossRentAnnual: 31200, monthlyRent: 2600, vacancyRate: 1, expenseRatio: 1, targetCapRate: 7.5,
    leaseType: 'NNN', discountRate: 6, assessorData: { big: 'blob' }, parcels: [{ apn: '1' }],
  },
};

const asRow = (d: ReturnType<typeof buildBaselineDraft>): BaselineRow => ({ ...d, id: 'b1', captured_at: '2025-07-20T00:00:00Z' });

describe('baseline capture', () => {
  const draft = buildBaselineDraft(deal, 'user-1');
  const live: any = computeDealMetrics(deal);

  it('freezes the engine output on a first-full-year basis and stamps the engine version', () => {
    const ff: any = firstFullYear(live.projections);
    expect(draft.baseline_type).toBe('initial_underwriting');
    expect(draft.projected_irr).toBeCloseTo(live.irr, 2);
    expect(draft.projected_noi).toBeCloseTo(ff.netOperatingIncome, 2);
    expect(draft.projected_cash_flow).toBeCloseTo(ff.cashFlow, 2);
    expect((draft.metrics_snapshot as any).engineVersion).toBe(ENGINE_VERSION);
    expect((draft.metrics_snapshot as any).projections.length).toBe(live.projections.length);
  });

  it('stores the assumptions but not the bulky parcel / assessor blobs', () => {
    expect((draft.inputs_snapshot as any).interestRate).toBe(4.53);
    expect((draft.inputs_snapshot as any).assessorData).toBeUndefined();
    expect((draft.inputs_snapshot as any).parcels).toBeUndefined();
  });

  it('is a record, not a live view: later input changes do not alter it, but do move the current outlook', () => {
    const changed: any = { ...deal, inputs: { ...deal.inputs, interestRate: 7.5 } };
    const cmp = compareToBaseline({ baseline: asRow(draft), live: computeDealMetrics(changed), payments: [], leases: [], now: new Date('2026-09-15') });
    const irr = cmp.headline.find((h) => h.key === 'irr')!;
    expect(irr.expected).toBeCloseTo(draft.projected_irr as number, 4);
    expect(irr.current).not.toBeCloseTo(irr.expected as number, 2);
    expect(irr.delta).toBeCloseTo((irr.current as number) - (irr.expected as number), 6);
  });
});

describe('expected vs actual revenue', () => {
  const draft = buildBaselineDraft(deal, 'user-1');
  const baseline = asRow(draft);
  const live: any = computeDealMetrics(deal);
  const expectedMonthly2026 = (draft.metrics_snapshot as any).projections.find((p: any) => p.calendarYear === 2026).effectiveGrossIncome / 12;

  it('expects the baseline year’s income spread evenly over its months, and 0 before acquisition', () => {
    const cmp = compareToBaseline({ baseline, live, payments: [], leases: [], now: new Date('2026-03-10') });
    expect(cmp.months.find((m) => m.month === '2026-03')!.expected).toBeCloseTo(expectedMonthly2026, 2);
    expect(cmp.months.find((m) => m.month === '2025-12')!.expected).toBeGreaterThan(0); // stub year, after closing
    expect(cmp.months.find((m) => m.month === '2025-10')!.expected).toBeGreaterThan(0);
    const cmpEarly = compareToBaseline({ baseline, live, payments: [], leases: [], now: new Date('2025-08-10') });
    expect(cmpEarly.months.find((m) => m.month === '2025-03')!.expected).toBe(0);
  });

  it('sums collected rent from paid and partial payments only, and year-to-date expected income', () => {
    const payments = [
      { period_month: '2026-01-01', amount_due: 2600, amount_paid: 2600, status: 'paid' },
      { period_month: '2026-02-01', amount_due: 2600, amount_paid: 1000, status: 'partial' },
      { period_month: '2026-03-01', amount_due: 2600, amount_paid: 0, status: 'overdue' },
    ];
    const cmp = compareToBaseline({ baseline, live, payments, leases: [{ monthly_rent: 2600, is_active: true }], now: new Date('2026-03-20') });
    expect(cmp.collectedYtd).toBe(3600);
    expect(cmp.expectedYtd).toBeCloseTo(expectedMonthly2026 * 3, 2);
    expect(cmp.contractualYtd).toBe(2600 * 3);
  });

  it('degrades gracefully for an old snapshot with no year-by-year detail', () => {
    const legacy: BaselineRow = { ...baseline, metrics_snapshot: { irr: 12.5 } };
    const cmp = compareToBaseline({ baseline: legacy, live, payments: [], leases: [], now: new Date('2026-03-20') });
    expect(cmp.hasYearDetail).toBe(false);
    expect(cmp.expectedYtd).toBe(0);
    expect(cmp.headline.find((h) => h.key === 'irr')).toBeDefined();
  });
});
