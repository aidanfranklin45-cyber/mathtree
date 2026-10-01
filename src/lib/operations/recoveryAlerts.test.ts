import { describe, it, expect } from 'vitest';
import { planRecoveryAlerts, type AlertLease } from '../../../supabase/functions/_shared/recoveryAlerts';
import { reconcileCam, meterCharge, estimatesPaidInYear } from '../../../supabase/functions/_shared/recoveryReconcile';
import type { RecoveryItem, RecoveryTerm } from '../../../supabase/functions/_shared/recoveries';

const lease = (over: Partial<AlertLease> = {}): AlertLease => ({ id: 'l1', deal_id: 'd1', user_id: 'u1', tenant_name: 'Rosewood Dental', track_recoveries: true, ...over });
const deals = [{ id: 'd1', title: 'Elm Plaza' }];
const terms: RecoveryTerm[] = [
  { id: 't1', lease_id: 'l1', category: 'property_tax', mode: 'direct_pay', frequency: 'semiannual', first_due_date: '2026-04-30' },
  { id: 't2', lease_id: 'l1', category: 'cam', mode: 'reimburse', frequency: 'monthly', first_due_date: '2026-01-01' },
];
const plan = (over: Partial<Parameters<typeof planRecoveryAlerts>[0]> = {}) =>
  planRecoveryAlerts({ leases: [lease()], deals, terms, items: [], reconciliations: [{ lease_id: 'l1', year: 2025, status: 'settled' }], existing: [], today: '2026-10-01', ...over });

describe('planRecoveryAlerts', () => {
  it('rolls a lease\'s late items into one overdue notification and upcoming ones into one heads-up', () => {
    const items: RecoveryItem[] = [
      { term_id: 't1', due_date: '2026-04-30', verified: false },            // overdue tax
      { term_id: 't2', due_date: '2026-09-01', paid_date: null },            // overdue CAM
      { term_id: 't2', due_date: '2026-10-10', paid_date: null },            // due in 9 days
      { term_id: 't2', due_date: '2026-08-01', paid_date: '2026-08-02' },    // complete, ignored
    ];
    const p = plan({ items });
    expect(p.insert.map((a) => a.type).sort()).toEqual(['recovery_due_soon', 'recovery_overdue']);
    const overdue = p.insert.find((a) => a.type === 'recovery_overdue')!;
    expect(overdue.message).toContain('2 items');
    expect(overdue.message).toContain('Property tax, CAM');
    expect(overdue.title).toContain('Rosewood Dental · Elm Plaza');
    expect(overdue.action_payload.lease_id).toBe('l1');
  });

  it('ignores leases that have not opted in', () => {
    const items: RecoveryItem[] = [{ term_id: 't1', due_date: '2026-04-30', verified: false }];
    expect(plan({ leases: [lease({ track_recoveries: false })], items }).insert).toEqual([]);
  });

  it('does not alert for items more than 14 days out', () => {
    expect(plan({ items: [{ term_id: 't2', due_date: '2026-10-16', paid_date: null }] }).insert).toEqual([]);
  });

  it('refreshes an open notification that still applies and dismisses one that has cleared or is duplicated', () => {
    const items: RecoveryItem[] = [{ term_id: 't1', due_date: '2026-04-30', verified: false }];
    const p = plan({
      items,
      existing: [
        { id: 'n1', type: 'recovery_overdue', lease_id: 'l1' },
        { id: 'n2', type: 'recovery_overdue', lease_id: 'l1' },
        { id: 'n3', type: 'recovery_due_soon', lease_id: 'l1' },
        { id: 'n4', type: 'missing_lease', lease_id: null },
      ],
    });
    expect(p.insert).toEqual([]);
    expect(p.update.map((u) => u.id)).toEqual(['n1']);
    expect(p.dismissIds.sort()).toEqual(['n2', 'n3']);
  });

  it('flags a missing prior-year CAM reconciliation only after the deadline', () => {
    expect(plan({ today: '2027-03-31' }).insert.map((a) => a.type)).not.toContain('recovery_reconciliation');
    const late = plan({ today: '2027-04-01' });
    expect(late.insert.find((a) => a.type === 'recovery_reconciliation')?.title).toContain('2026 CAM reconciliation');
    const done = plan({ today: '2027-04-01', reconciliations: [{ lease_id: 'l1', year: 2026, status: 'billed' }] });
    expect(done.insert.map((a) => a.type)).not.toContain('recovery_reconciliation');
    const draft = plan({ today: '2027-04-01', reconciliations: [{ lease_id: 'l1', year: 2026, status: 'draft' }] });
    expect(draft.insert.map((a) => a.type)).toContain('recovery_reconciliation');
  });
});

describe('reconcileCam', () => {
  it('charges the tenant share of actual expenses and returns the true-up against estimates', () => {
    const r = reconcileCam({ totalExpenses: 80000, sharePct: 25, estimatesPaid: 18000 });
    expect(r).toEqual({ uncappedCharge: 20000, charge: 20000, capApplied: false, trueUp: 2000 });
  });
  it('returns a negative true-up (refund) when estimates exceeded the charge', () => {
    expect(reconcileCam({ totalExpenses: 60000, sharePct: 25, estimatesPaid: 18000 }).trueUp).toBe(-3000);
  });
  it('adds the admin fee to the tenant share', () => {
    expect(reconcileCam({ totalExpenses: 80000, sharePct: 25, estimatesPaid: 0, adminFeePct: 10 }).charge).toBe(22000);
  });
  it('limits the charge to prior-year billing plus the cap', () => {
    const r = reconcileCam({ totalExpenses: 100000, sharePct: 25, estimatesPaid: 20000, capPct: 5, priorYearBilled: 20000 });
    expect(r).toMatchObject({ uncappedCharge: 25000, charge: 21000, capApplied: true, trueUp: 1000 });
  });
  it('does not apply a cap without a prior-year base', () => {
    expect(reconcileCam({ totalExpenses: 100000, sharePct: 25, estimatesPaid: 0, capPct: 5 }).capApplied).toBe(false);
  });
});

describe('meterCharge', () => {
  it('prices usage with the multiplier and a base charge', () => {
    expect(meterCharge({ previousReading: 1000, currentReading: 1400, ratePerUnit: 0.12, multiplier: 2, baseCharge: 10 }))
      .toEqual({ usage: 800, charge: 106, error: null });
  });
  it('rejects a reading that went backwards', () => {
    expect(meterCharge({ previousReading: 500, currentReading: 400, ratePerUnit: 1 }).error).toContain('lower');
  });
});

describe('estimatesPaidInYear', () => {
  it('sums what was actually paid within the calendar year, preferring the actual amount', () => {
    const items = [
      { due_date: '2026-01-01', paid_date: '2026-01-03', amount_expected: 1500 },
      { due_date: '2026-02-01', paid_date: '2026-02-01', amount_expected: 1500, amount_actual: 1600 },
      { due_date: '2026-03-01', paid_date: null, amount_expected: 1500 },
      { due_date: '2025-12-01', paid_date: '2025-12-02', amount_expected: 1500 },
    ];
    expect(estimatesPaidInYear(items, 2026)).toBe(3100);
  });
});
