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
