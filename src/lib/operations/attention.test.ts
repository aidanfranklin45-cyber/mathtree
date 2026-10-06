import { describe, it, expect } from 'vitest';
import { buildInboxItems, operateLink, type InboxInput } from './attention';
import { buildOperations } from './rentRoll';
import { buildRowView } from '../../components/operations/rowStatus';

const NOW = new Date('2026-10-15T12:00:00');
const deals = [
  { id: 'd1', title: 'Burgers', status: 'owned', inputs: {} },
  { id: 'd2', title: 'Dirt Pit', status: 'owned', inputs: {} },
  { id: 'd3', title: 'Prospect', status: 'prospect', inputs: { leases: [{ tenantName: 'X', monthlyRent: 1000 }] } },
  { id: 'd4', title: 'Demo', status: 'owned', is_demo: true, inputs: {} },
];
const lease = (o: Record<string, any>) => ({ is_active: true, payment_due_day: 1, grace_period_days: 0, ...o });

function run(leaseRows: any[], payments: any[] = [], extra: Partial<InboxInput> = {}) {
  const ops = buildOperations({ deals, leases: leaseRows, units: [], payments, increases: [], scope: 'all', entityId: 'all', dealId: 'all', activeDate: NOW, now: NOW });
  const views = ops.rows.map((r) => buildRowView(r, undefined, undefined, [], NOW, true));
  return buildInboxItems({ deals, leaseRows, units: [], payments, views, rentRollLeases: ops.scopedLeases, currentPeriod: true, now: NOW, ...extra });
}

describe('buildInboxItems', () => {
  it('flags overdue rent with the lease rent as a contracted figure and links to the Operate tab', () => {
    const items = run([lease({ id: 'l1', deal_id: 'd1', tenant_name: 'Stop', monthly_rent: 3000, lease_start_date: '2025-01-01', lease_end_date: '2030-01-01' })]);
    const overdue = items.find((i) => i.kind === 'overdue')!;
    expect(overdue).toMatchObject({ dealId: 'd1', dealTitle: 'Burgers', amount: 3000, basis: 'contracted', link: operateLink('d1') });
  });

  it('uses the payment record, and the unpaid balance, when one exists', () => {
    const pay = [{ deal_id: 'd1', lease_id: 'l1', amount_due: 3000, amount_paid: 1000, period_month: '2026-10-01', status: 'overdue' }];
    const ops = buildOperations({ deals, leases: [lease({ id: 'l1', deal_id: 'd1', tenant_name: 'Stop', monthly_rent: 3000 })], units: [], payments: pay, increases: [], scope: 'all', entityId: 'all', dealId: 'all', activeDate: NOW, now: NOW });
    const views = ops.rows.map((r) => buildRowView(r, pay[0], pay[0], [], NOW, true));
    const items = buildInboxItems({ deals, leaseRows: [], units: [], payments: pay, views, rentRollLeases: ops.scopedLeases, currentPeriod: true, now: NOW });
    expect(items.find((i) => i.kind === 'overdue')).toMatchObject({ amount: 2000, basis: 'collected' });
  });

  it('leaves the amount blank when the lease states no rent', () => {
    const items = run([lease({ id: 'l1', deal_id: 'd1', tenant_name: 'Stop', tenant_email: 'a@b.c', monthly_rent: 0 })]);
    const o = items.find((i) => i.kind === 'overdue');
    if (o) expect(o).toMatchObject({ amount: null, basis: null });
    expect(items.some((i) => i.id === 'd1:missing:rent')).toBe(true);
  });

  it('flags in-force leases with no start date', () => {
    const items = run([lease({ id: 'l1', deal_id: 'd1', tenant_name: 'Stop', monthly_rent: 3000, lease_end_date: '2030-01-01' })]);
    expect(items.find((i) => i.id === 'd1:missing:start')).toMatchObject({ kind: 'missing_data', headline: '1 lease with no start date' });
    const ok = run([lease({ id: 'l1', deal_id: 'd1', tenant_name: 'Stop', monthly_rent: 3000, lease_start_date: '2025-01-01', lease_end_date: '2030-01-01' })]);
    expect(ok.some((i) => i.id === 'd1:missing:start')).toBe(false);
  });

  it('flags leases expiring soon and holding over, but not month-to-month or far-off ones', () => {
    const items = run([
      lease({ id: 'a', deal_id: 'd1', tenant_name: 'Soon', monthly_rent: 1000, lease_end_date: '2026-12-31' }),
      lease({ id: 'b', deal_id: 'd1', tenant_name: 'Held', monthly_rent: 1000, lease_end_date: '2026-06-30' }),
      lease({ id: 'c', deal_id: 'd1', tenant_name: 'Mtm', monthly_rent: 1000, term_type: 'month_to_month', lease_end_date: '2026-11-01' }),
      lease({ id: 'd', deal_id: 'd1', tenant_name: 'Far', monthly_rent: 1000, lease_end_date: '2030-01-01' }),
    ]);
    const exp = items.filter((i) => i.kind === 'lease_expiring');
    expect(exp.map((i) => i.leaseId).sort()).toEqual(['a', 'b']);
    expect(exp.find((i) => i.leaseId === 'a')).toMatchObject({ amount: 12000, basis: 'contracted' });
  });

  it('reports missing data for owned deals only, never for prospects or demos', () => {
    const items = run([]);
    const missing = items.filter((i) => i.kind === 'missing_data' && !i.id.endsWith(':missing:inputs'));
    expect(missing.map((i) => i.dealId).sort()).toEqual(['d1', 'd2']);
    expect(missing.every((i) => i.amount === null && i.basis === null)).toBe(true);
  });

  it('lists an owned property that lacks underwriting inputs, the same rule as the dashboard badge, and links to the property', () => {
    const items = run([]);
    const gaps = items.filter((i) => i.id.endsWith(':missing:inputs'));
    expect(gaps.map((i) => i.dealId).sort()).toEqual(['d1', 'd2']);
    expect(gaps[0].link).toBe('/project?id=d1');
  });

  it('asks for payments when a leased property has none recorded', () => {
    const items = run([lease({ id: 'l1', deal_id: 'd1', tenant_name: 'Stop', monthly_rent: 3000, lease_end_date: '2030-01-01' })]);
    expect(items.some((i) => i.id === 'd1:missing:payments')).toBe(true);
  });

  it('appends items from other sources and sorts by kind', () => {
    const review = { id: 'imp1', kind: 'needs_review' as const, dealId: 'd1', dealTitle: 'Burgers', leaseId: null, headline: 'Imported rent roll: 3 rows to confirm', detail: 'From rent-roll.csv', amount: null, basis: null, link: operateLink('d1') };
    const items = run([], [], { extra: [review] });
    expect(items.filter((i) => !i.id.endsWith(':missing:inputs')).map((i) => i.kind)).toEqual(['missing_data', 'missing_data', 'needs_review']);
  });
});

describe('muting', () => {
  it('mutes one item type for one property and leaves the rest', async () => {
    const { applyMutes, inboxMuteKey } = await import('./attention');
    const items = run([]);
    const noLease = items.filter((i) => i.id.endsWith(':missing:leases'));
    expect(noLease.length).toBeGreaterThan(1);
    const first = noLease[0];
    const left = applyMutes(items, new Set([inboxMuteKey(first)]));
    expect(left.some((i) => i.id === first.id)).toBe(false);
    expect(left.length).toBe(items.length - 1);
  });
});
