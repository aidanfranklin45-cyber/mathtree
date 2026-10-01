import { describe, it, expect } from 'vitest';
import { isReminderEligible, reminderEligibility, leaseInForce, unitLabel } from '../../../supabase/functions/_shared/reminderEligibility';

const today = new Date('2026-10-01T12:00:00');
const base = { dealStatus: 'owned', isDemo: false, leaseActive: true, leaseStartDate: '2026-08-03', leaseEndDate: '2036-08-03', today };

describe('who gets rent emails', () => {
  it('an owned, non-demo property with a lease in force is emailed', () => {
    expect(reminderEligibility(base)).toEqual({ eligible: true, reason: 'ok' });
  });

  it('never for a prospect (still being underwritten)', () => {
    expect(reminderEligibility({ ...base, dealStatus: 'prospect' })).toEqual({ eligible: false, reason: 'not_owned' });
    expect(isReminderEligible({ ...base, dealStatus: 'under_contract' })).toBe(false);
    expect(isReminderEligible({ ...base, dealStatus: undefined })).toBe(false);
  });

  it('never for demo data, even when it is marked owned', () => {
    expect(reminderEligibility({ ...base, isDemo: true })).toEqual({ eligible: false, reason: 'demo' });
  });

  it('never for an inactive lease, one that has not started, or one that has ended', () => {
    expect(reminderEligibility({ ...base, leaseActive: false }).reason).toBe('inactive');
    expect(reminderEligibility({ ...base, leaseStartDate: '2026-12-01' }).reason).toBe('not_started');
    expect(reminderEligibility({ ...base, leaseEndDate: '2026-09-30' }).reason).toBe('ended');
  });

  it('the first and last day of a lease are still in force', () => {
    expect(isReminderEligible({ ...base, leaseStartDate: '2026-10-01' })).toBe(true);
    expect(isReminderEligible({ ...base, leaseEndDate: '2026-10-01' })).toBe(true);
  });

  it('open-ended leases (no end date, e.g. month to month) stay eligible', () => {
    expect(isReminderEligible({ ...base, leaseEndDate: null })).toBe(true);
    expect(isReminderEligible({ ...base, leaseStartDate: null, leaseEndDate: null })).toBe(true);
    expect(leaseInForce(null, null, today)).toBe(true);
  });

  it('is case-insensitive about the status and ignores a time part on dates', () => {
    expect(isReminderEligible({ ...base, dealStatus: 'OWNED', leaseEndDate: '2036-08-03T00:00:00+00:00' })).toBe(true);
  });
});

describe('how a tenant space reads in an email', () => {
  it('keeps labels that already say what they are', () => {
    expect(unitLabel('Suite 100')).toBe('Suite 100');
    expect(unitLabel('Main Building')).toBe('Main Building');
    expect(unitLabel('Apt 4B')).toBe('Apt 4B');
    expect(unitLabel('Unit 12')).toBe('Unit 12');
  });

  it('prefixes a bare number or code', () => {
    expect(unitLabel('12')).toBe('Unit 12');
    expect(unitLabel('4B')).toBe('Unit 4B');
    expect(unitLabel('#7')).toBe('Unit 7');
  });

  it('is empty when there is no unit', () => {
    expect(unitLabel(null)).toBe('');
    expect(unitLabel('  ')).toBe('');
  });
});
