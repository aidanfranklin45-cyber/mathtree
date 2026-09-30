import { describe, it, expect } from 'vitest';
import { buildOperations, escalationInfo, formatPeriodMonth } from './rentRoll';

const NOW = new Date('2026-09-29T12:00:00Z');
const base = { units: [], payments: [], increases: [], scope: 'owned' as const, entityId: 'all', dealId: 'all', activeDate: new Date('2026-09-01T12:00:00Z'), now: NOW };

const deals = [
  { id: 'd1', title: 'Burgers', status: 'owned', entity_id: 'e1', inputs: {} },
  { id: 'd2', title: 'Dirt Pit', status: 'owned', entity_id: 'e2', inputs: { unitCount: 1 } },
  { id: 'd3', title: 'Prospect', status: 'prospect', entity_id: 'e1', inputs: { monthlyRent: 2000 } },
];
const leases = [
  { id: 'l1', deal_id: 'd1', tenant_name: 'Stop and Go', monthly_rent: 3000, is_active: true, escalation_type: 'Percentage Bump (%)', escalation_rate: 3, escalation_frequency: 'Annual on Anniversary', next_escalation_date: '2026-06-01', lease_start_date: '2024-06-01' },
];

describe('buildOperations', () => {
  it('scopes to owned deals and surfaces a vacant property row', () => {
    const r = buildOperations({ ...base, deals, leases });
    expect(r.scopedDeals.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(r.rows.map((x) => [x.id, x.is_vacant])).toEqual([['l1', false], ['vacant-d2', true]]);
    expect(r.kpis.monthlyRent).toBe(3000);
    expect(r.kpis.annualRent).toBe(36000);
    expect(r.kpis.totalUnits).toBe(2);
    expect(r.kpis.occupiedUnits).toBe(1);
    expect(r.kpis.occupancyPct).toBe(50);
  });

  it('entity and property filters narrow the scope', () => {
    expect(buildOperations({ ...base, deals, leases, entityId: 'e2' }).rows.map((x) => x.id)).toEqual(['vacant-d2']);
    expect(buildOperations({ ...base, deals, leases, dealId: 'd1' }).rows.map((x) => x.id)).toEqual(['l1']);
  });

  it("'all' scope includes the pipeline and derives a lease from deal inputs", () => {
    const r = buildOperations({ ...base, deals, leases, scope: 'all' });
    const derived = r.rows.find((x) => x.deal_id === 'd3');
    expect(derived?.is_derived).toBe(true);
    expect(derived?.monthly_rent).toBe(2000);
    expect(r.kpis.monthlyRent).toBe(5000);
  });

  it('collections: no payment for a past month is overdue; a paid one counts toward the percentage', () => {
    const past = buildOperations({ ...base, deals, leases, activeDate: new Date('2026-08-01T12:00:00Z') });
    expect(past.kpis.overdueCount).toBe(1);
    expect(past.kpis.collectedPct).toBe(0);
    const paid = buildOperations({
      ...base, deals, leases, activeDate: new Date('2026-08-01T12:00:00Z'),
      payments: [{ lease_id: 'l1', period_month: '2026-08-01', status: 'paid', amount_paid: 3000 }],
    });
    expect(paid.kpis.paidCount).toBe(1);
    expect(paid.kpis.collectedPct).toBe(100);
  });

  it('an annual lease whose next escalation date has passed counts as due', () => {
    const r = buildOperations({ ...base, deals, leases });
    expect(r.kpis.escalationsDueCount).toBe(1);
  });
});

describe('escalationInfo', () => {
  it('flags a due escalation, and a queued future step', () => {
    const due = escalationInfo(leases[0], [], NOW);
    expect(due.isScheduledDue).toBe(true);
    const future = escalationInfo(
      { ...leases[0], next_escalation_date: null },
      [{ lease_id: 'l1', effective_date: '2027-06-01', increase_type: 'percentage', scheduled_amount: 3, is_applied: false }],
      NOW,
    );
    expect(future.isAdvanceScheduled).toBe(true);
    expect(future.scheduledValStr).toBe('+3%');
  });

  it('a lease with no schedule for over a year needs review', () => {
    const info = escalationInfo(
      { id: 'x', escalation_type: 'none', escalation_rate: 0, lease_start_date: '2024-01-01' },
      [],
      NOW,
    );
    expect(info.hasDefinedSchedule).toBe(false);
    expect(info.isUnscheduledReviewDue).toBe(true);
  });
});

describe('formatPeriodMonth', () => {
  it('formats the first of the month', () => {
    expect(formatPeriodMonth(new Date(2026, 8, 15))).toBe('2026-09-01');
  });
});
