import { describe, it, expect } from 'vitest';
import { decideFollowup, normalizeFollowupPrefs, dueDateFor, type FollowupInput } from '../../../supabase/functions/_shared/followups';

const d = (s: string) => new Date(`${s}T12:00:00`);
const base = (over: Partial<FollowupInput> = {}): FollowupInput => ({
  today: d('2026-03-12'),
  dueDay: 3,
  graceDays: 5,
  rent: 2600,
  payment: null,
  reminderTimes: [d('2026-03-03')],
  prefs: normalizeFollowupPrefs({}),
  ...over,
});

describe('rent follow-up rules', () => {
  it('defaults: on, every 3 days, at most 3', () => {
    expect(normalizeFollowupPrefs(undefined)).toEqual({ followup_grace_period: true, followup_frequency_days: 3, followup_max_count: 3 });
  });

  it('clamps silly preference values', () => {
    const p = normalizeFollowupPrefs({ followup_frequency_days: 0, followup_max_count: 500 });
    expect(p.followup_frequency_days).toBe(1);
    expect(p.followup_max_count).toBe(20);
  });

  it('does nothing when the user turned follow-ups off', () => {
    expect(decideFollowup(base({ prefs: normalizeFollowupPrefs({ followup_grace_period: false }) }))).toEqual({ send: false, reason: 'disabled' });
  });

  it('never chases paid rent', () => {
    expect(decideFollowup(base({ payment: { status: 'paid', amount_paid: 2600 } })).send).toBe(false);
    expect(decideFollowup(base({ payment: { status: 'pending', amount_paid: 2600 } })).send).toBe(false);
  });

  it('a partial payment is still chased', () => {
    expect(decideFollowup(base({ payment: { status: 'partial', amount_paid: 1000 } })).send).toBe(true);
  });

  it('waits until the due date, then through the grace period', () => {
    expect(decideFollowup(base({ today: d('2026-03-02'), reminderTimes: [] })).send).toBe(false);
    expect(decideFollowup(base({ today: d('2026-03-07'), reminderTimes: [d('2026-03-03')] }))).toEqual({ send: false, reason: 'within_grace' });
  });

  it('an ignored reminder gets its first follow-up once the grace period has passed', () => {
    const r = decideFollowup(base({ today: d('2026-03-09') }));
    expect(r).toEqual({ send: true, reason: 'past_grace', followupNumber: 1 });
  });

  it('respects the chosen frequency between follow-ups', () => {
    const times = [d('2026-03-03'), d('2026-03-09')];
    expect(decideFollowup(base({ today: d('2026-03-11'), reminderTimes: times })).send).toBe(false); // 2 days since last
    expect(decideFollowup(base({ today: d('2026-03-12'), reminderTimes: times }))).toEqual({ send: true, reason: 'past_grace', followupNumber: 2 });
    const weekly = normalizeFollowupPrefs({ followup_frequency_days: 7 });
    expect(decideFollowup(base({ today: d('2026-03-12'), reminderTimes: times, prefs: weekly })).send).toBe(false);
    expect(decideFollowup(base({ today: d('2026-03-16'), reminderTimes: times, prefs: weekly })).send).toBe(true);
  });

  it('stops after the maximum number of follow-ups, and 0 means unlimited', () => {
    const times = [d('2026-03-03'), d('2026-03-09'), d('2026-03-12'), d('2026-03-15')]; // reminder + 3 follow-ups
    expect(decideFollowup(base({ today: d('2026-03-20'), reminderTimes: times }))).toEqual({ send: false, reason: 'max_reached' });
    const unlimited = normalizeFollowupPrefs({ followup_max_count: 0 });
    expect(decideFollowup(base({ today: d('2026-03-20'), reminderTimes: times, prefs: unlimited })).send).toBe(true);
  });

  it('while a snooze is running nothing is sent; when it runs out the follow-up goes out', () => {
    const snoozed = { status: 'snoozed', amount_paid: 0, snooze_until: '2026-03-15' };
    expect(decideFollowup(base({ today: d('2026-03-12'), payment: snoozed })).reason).toBe('snoozed');
    const r = decideFollowup(base({ today: d('2026-03-15'), payment: snoozed, reminderTimes: [d('2026-03-03')] }));
    expect(r).toEqual({ send: true, reason: 'snooze_expired', followupNumber: 1 });
  });

  it('after a follow-up the same day, the next one waits for the frequency (no daily spam)', () => {
    const snoozed = { status: 'snoozed', amount_paid: 0, snooze_until: '2026-03-15' };
    const after = decideFollowup(base({ today: d('2026-03-16'), payment: snoozed, reminderTimes: [d('2026-03-03'), d('2026-03-15')] }));
    expect(after).toEqual({ send: false, reason: 'too_soon' });
  });

  it('due days 29-31 fall on the last day of shorter months', () => {
    expect(dueDateFor(d('2026-02-10'), 31).getDate()).toBe(28);
  });
});
