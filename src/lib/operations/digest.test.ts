import { describe, it, expect } from 'vitest';
import { planDispatch, buildDigestEmail, normalizeDigestMin, escapeHtml, DEFAULT_DIGEST_MIN, type ReminderItem } from '../../../supabase/functions/_shared/digest';

const URL = 'https://app/reconcile?action=manage&token=abc123';
const item = (over: Partial<ReminderItem> = {}): ReminderItem => ({
  leaseId: 'l1', userId: 'u1', periodMonth: '2026-10-01', dealId: 'd1', dealTitle: '55 Main St', to: 'owner@example.com', tenant: 'Acme Dental', space: 'Suite 120', rent: 3400,
  kind: 'due', confirmUrl: 'https://app/reconcile?action=confirm&token=aaa', snoozeUrl: 'https://app/reconcile?action=snooze&token=bbb',
  digestMin: 3, single: { subject: 'single', html: '<p>single</p>' }, ...over,
});
const tenants = (n: number, over: Partial<ReminderItem> = {}) =>
  Array.from({ length: n }, (_, i) => item({ leaseId: `l${i}`, tenant: `Tenant ${i + 1}`, space: `Suite ${100 + i}`, ...over }));

describe('digest threshold', () => {
  it('defaults to 3, clamps, and 0 means never combine', () => {
    expect(normalizeDigestMin(undefined)).toBe(DEFAULT_DIGEST_MIN);
    expect(normalizeDigestMin('x')).toBe(3);
    expect(normalizeDigestMin(1)).toBe(2);
    expect(normalizeDigestMin(500)).toBe(100);
    expect(normalizeDigestMin(5)).toBe(5);
    expect(normalizeDigestMin(0)).toBe(0);
    expect(normalizeDigestMin('off')).toBe(0);
  });
});

describe('who gets a digest', () => {
  it('fewer tenants than the threshold stay as individual emails', () => {
    const plan = planDispatch(tenants(2));
    expect(plan.digests).toHaveLength(0);
    expect(plan.singles).toHaveLength(2);
  });

  it('at the threshold the property gets one digest instead of one email per tenant', () => {
    const plan = planDispatch(tenants(3));
    expect(plan.digests).toHaveLength(1);
    expect(plan.digests[0].items).toHaveLength(3);
    expect(plan.singles).toHaveLength(0);
  });

  it('a 120-unit building due on the same day is one email, not 120', () => {
    const plan = planDispatch(tenants(120));
    expect(plan.digests).toHaveLength(1);
    expect(plan.singles).toHaveLength(0);
  });

  it('tenants of different properties are never mixed', () => {
    const plan = planDispatch([...tenants(3, { dealId: 'a', dealTitle: 'A' }), ...tenants(3, { dealId: 'b', dealTitle: 'B' }), item({ dealId: 'c', leaseId: 'solo' })]);
    expect(plan.digests.map((d) => d.dealTitle).sort()).toEqual(['A', 'B']);
    expect(plan.singles.map((s) => s.leaseId)).toEqual(['solo']);
  });

  it('a past-due chase is not mixed with routine reminders', () => {
    const plan = planDispatch([...tenants(3), ...tenants(3, { kind: 'followup', leaseId: undefined as any }).map((t, i) => ({ ...t, leaseId: `f${i}` }))]);
    expect(plan.digests).toHaveLength(2);
    expect(plan.digests.filter((d) => d.isFollowup)).toHaveLength(1);
  });

  it('advance and due-today reminders for the same property combine, under their own headings', () => {
    const plan = planDispatch([...tenants(2, { kind: 'due' }), item({ leaseId: 'x', kind: 'advance', advanceDays: 2, tenant: 'Zed' })]);
    expect(plan.digests).toHaveLength(1);
    const { html } = buildDigestEmail(plan.digests[0], URL);
    expect(html).toContain('Due today');
    expect(html).toContain('Due in 2 days');
  });

  it('an owner who turned digests off always gets individual emails', () => {
    const plan = planDispatch(tenants(10, { digestMin: 0 }));
    expect(plan.digests).toHaveLength(0);
    expect(plan.singles).toHaveLength(10);
  });

  it('respects each owner\'s own threshold and recipient', () => {
    const plan = planDispatch([...tenants(4, { digestMin: 5 }), ...tenants(4, { dealId: 'other', to: 'second@example.com', digestMin: 4 })]);
    expect(plan.digests).toHaveLength(1);
    expect(plan.digests[0].to).toBe('second@example.com');
    expect(plan.singles).toHaveLength(4);
  });
});

describe('the digest email', () => {
  const group = planDispatch(tenants(3)).digests[0];

  it('lists every tenant with its space and rent, with ONE link to the checklist and no per-tenant buttons', () => {
    const { subject, html } = buildDigestEmail(group, URL);
    expect(subject).toContain('3 tenants at 55 Main St');
    expect(subject).toContain('$10,200');
    for (const i of group.items) {
      expect(html).toContain(i.tenant);
      expect(html).toContain(i.space);
    }
    expect(html).toContain('Manage rent payments');
    expect(html).toContain(URL.replace(/&/g, '&amp;'));
    expect(html.split('href=').length - 1).toBe(1);
    expect(html).not.toContain('action=confirm');
    expect(html).not.toContain('action=snooze');
  });

  it('tells the owner what Save does', () => {
    const { html } = buildDigestEmail(group, URL);
    expect(html).toContain('tick everyone who has paid');
    expect(html).toContain('snoozed');
    expect(html).toContain('No sign-in needed');
  });

  it('sorts rows naturally by space (Suite 2 before Suite 10)', () => {
    const g = planDispatch([item({ leaseId: 'a', space: 'Suite 10', tenant: 'B' }), item({ leaseId: 'b', space: 'Suite 2', tenant: 'A' }), item({ leaseId: 'c', space: 'Suite 3', tenant: 'C' })]).digests[0];
    const { html } = buildDigestEmail(g, URL);
    expect(html.indexOf('Suite 2')).toBeLessThan(html.indexOf('Suite 3'));
    expect(html.indexOf('Suite 3')).toBeLessThan(html.indexOf('Suite 10'));
  });

  it('escapes tenant and property names so they cannot inject markup', () => {
    const evil = planDispatch(tenants(3, { tenant: '<script>alert(1)</script>', dealTitle: 'A & B "Plaza"' })).digests[0];
    const { html, subject } = buildDigestEmail(evil, URL);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &quot;Plaza&quot;');
    expect(subject).toContain('A & B "Plaza"'); // the subject is plain text
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('a past-due digest is labelled as such and shows follow-up numbers', () => {
    const g = planDispatch(tenants(3, { kind: 'followup', followupNumber: 2 })).digests[0];
    const { subject, html } = buildDigestEmail(g, URL);
    expect(subject).toContain('Past-due rent');
    expect(html).toContain('Past due');
    expect(html).toContain('Follow-up #2');
  });

  it('an all-advance digest says how many days ahead in the subject', () => {
    const g = planDispatch(tenants(3, { kind: 'advance', advanceDays: 2 })).digests[0];
    expect(buildDigestEmail(g, URL).subject).toContain('Rent due in 2 days');
  });
});
