import { describe, it, expect } from 'vitest';
import { dueDateIn, getDueInfo } from './rentRoll';

const lease = { payment_due_day: 3, grace_period_days: 5, monthly_rent: 2600 };
const d = (s: string) => new Date(`${s}T12:00:00`);
const fmt = (x: Date) => x.toISOString().slice(0, 10);

describe('rent due dates (recurring obligation, never complete)', () => {
  it('before the due date and unpaid: next due is this month\u2019s date', () => {
    const i = getDueInfo(lease, undefined, d('2026-03-01'));
    expect(fmt(new Date(i.nextDue.getTime() - i.nextDue.getTimezoneOffset() * 60000))).toBe('2026-03-03');
    expect(i.state).toBe('upcoming');
    expect(i.daysUntilNext).toBe(2);
  });

  it('on the due date: due today', () => {
    expect(getDueInfo(lease, undefined, d('2026-03-03')).state).toBe('due_today');
  });

  it('after the due date and paid: paid through this month, next due is the 3rd of next month', () => {
    const i = getDueInfo(lease, { status: 'paid', amount_paid: 2600 }, d('2026-03-20'));
    expect(i.state).toBe('paid');
    expect(i.summary).toBe('Paid through Mar');
    expect(i.nextDue.getMonth()).toBe(3); // April
    expect(i.nextDue.getDate()).toBe(3);
  });

  it('after the due date and unpaid: late (within grace) then overdue (past grace), next due is still next month\u2019s 3rd', () => {
    const late = getDueInfo(lease, undefined, d('2026-03-06'));
    expect(late.state).toBe('late');
    expect(late.daysLate).toBe(3);
    const overdue = getDueInfo(lease, undefined, d('2026-03-12'));
    expect(overdue.state).toBe('overdue');
    expect(overdue.nextDue.getMonth()).toBe(3);
    expect(overdue.nextDue.getDate()).toBe(3);
  });

  it('a snoozed late payment is reported as snoozed, not overdue', () => {
    const i = getDueInfo(lease, { status: 'snoozed', amount_paid: 0, snooze_until: '2026-03-15' }, d('2026-03-12'));
    expect(i.state).toBe('snoozed');
  });

  it('a partial payment does not count as paid', () => {
    expect(getDueInfo(lease, { status: 'partial', amount_paid: 1000 }, d('2026-03-20')).state).not.toBe('paid');
  });

  it('due days 29-31 fall on the last day of shorter months', () => {
    expect(dueDateIn(2026, 1, 31).getDate()).toBe(28); // Feb 2026
    expect(dueDateIn(2028, 1, 30).getDate()).toBe(29); // leap-year Feb
    expect(dueDateIn(2026, 3, 31).getDate()).toBe(30); // April
  });

  it('defaults to the 1st when no due day is set', () => {
    expect(getDueInfo({ monthly_rent: 100 }, undefined, d('2026-03-10')).dueDay).toBe(1);
  });

  it('rolls over the year: paid in December means next due is January', () => {
    const i = getDueInfo(lease, { status: 'paid', amount_paid: 2600 }, d('2026-12-20'));
    expect(i.nextDue.getFullYear()).toBe(2027);
    expect(i.nextDue.getMonth()).toBe(0);
  });
});
