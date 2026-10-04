import { describe, it, expect } from 'vitest';
import { reminderEligibility } from '../../../supabase/functions/_shared/reminderEligibility';
import { getDueInfo } from './rentRoll';
import { buildExpiryLadder } from './leaseExpiry';

const today = new Date(2026, 9, 1, 12);

describe('operations edge cases', () => {
  it('a month-to-month lease with a stale end date still gets rent reminders (ladder treats it as in force)', () => {
    const lease = { id: 'a', deal_id: 'd', is_active: true, term_type: 'month_to_month', lease_end_date: '2026-01-31', monthly_rent: 1000 };
    const ladder = buildExpiryLadder([lease], { today });
    expect(ladder.buckets.find((b) => b.key === 'mtm')?.leases).toHaveLength(1);
    const v = reminderEligibility({ dealStatus: 'owned', leaseActive: true, leaseEndDate: '2026-01-31', termType: 'month_to_month', today });
    expect(v.eligible).toBe(true);
  });

  it('a snooze that runs through today (date-only value) still counts as snoozed', () => {
    const lease = { monthly_rent: 1000, payment_due_day: 1, grace_period_days: 0 };
    const info = getDueInfo(lease, { status: 'pending', amount_paid: 0, snooze_until: '2026-10-05' }, new Date(2026, 9, 5, 9));
    expect(info.state).toBe('snoozed');
  });
});

import { isAdvanceNoticeDay } from '../../../supabase/functions/_shared/reminderEligibility';
import { localTodayIso } from '../../../supabase/functions/_shared/recoveries';
import { buildOperations } from './rentRoll';

describe('advance rent notice', () => {
  it('fires in the previous month for an early due day', () => {
    expect(isAdvanceNoticeDay(new Date(2026, 9, 29), 1, 3)).toBe(true); // Oct 29 -> Nov 1
    expect(isAdvanceNoticeDay(new Date(2026, 11, 30), 2, 3)).toBe(true); // across the year end
    expect(isAdvanceNoticeDay(new Date(2026, 9, 28), 1, 3)).toBe(false);
  });
  it('fires inside the month as before, and clamps 31 to short months', () => {
    expect(isAdvanceNoticeDay(new Date(2026, 9, 12), 15, 3)).toBe(true);
    expect(isAdvanceNoticeDay(new Date(2026, 1, 25), 31, 3)).toBe(true); // Feb 28 due
    expect(isAdvanceNoticeDay(new Date(2026, 9, 12), 15, 0)).toBe(false);
  });
});

describe('local calendar dates', () => {
  it('today is the local day, not the UTC day', () => {
    expect(localTodayIso(new Date(2026, 9, 4, 20, 30))).toBe('2026-10-04');
  });
  it('a date-only escalation is not due the evening before', () => {
    const lease = { id: 'l1', deal_id: 'd1', is_active: true, monthly_rent: 1000, tenant_name: 'T', next_escalation_date: '2026-10-05', escalation_frequency: 'annual' };
    const res = buildOperations({ deals: [{ id: 'd1', title: 'D', status: 'owned' }], leases: [lease], units: [], payments: [], increases: [], scope: 'owned', entityId: 'all', dealId: 'all', activeDate: new Date(2026, 9, 1), now: new Date(2026, 9, 4, 18, 0) } as any);
    expect(res.kpis.escalationsDueCount).toBe(0);
    expect(res.kpis.scheduledCount).toBe(1);
  });
});
