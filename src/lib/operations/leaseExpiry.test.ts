import { describe, it, expect } from 'vitest';
import { buildExpiryLadder } from './leaseExpiry';

const TODAY = new Date(2026, 9, 2); // 2026-10-02 local

const leases = [
  { id: 'a', deal_id: 'd1', tenant_name: 'Acme Dental', monthly_rent: 3000, lease_start_date: '2022-01-01', lease_end_date: '2027-06-30', sqft: 1500 },
  { id: 'b', deal_id: 'd1', tenant_name: 'Bean Co', monthly_rent: 1000, lease_start_date: '2024-01-01', lease_end_date: '2026-12-31', sqft: 500 },
  { id: 'c', deal_id: 'd2', tenant_name: 'Unit 4', monthly_rent: 1000, lease_start_date: '2025-01-01', term_type: 'month_to_month', lease_end_date: null, sqft: 800 },
  { id: 'd', deal_id: 'd2', tenant_name: 'Old Shop', monthly_rent: 500, lease_start_date: '2020-01-01', lease_end_date: '2026-08-31', sqft: 400 },
  { id: 'e', deal_id: 'd3', tenant_name: 'Anchor', monthly_rent: 4500, lease_start_date: '2021-01-01', lease_end_date: '2040-01-31', sqft: 9000 },
];
const sqftOf = (l: Record<string, any>) => l.sqft;

describe('buildExpiryLadder', () => {
  it('buckets in-force leases by year, with holdover, month to month and a later bucket', () => {
    const r = buildExpiryLadder(leases, { today: TODAY, years: 6, sqftOf });
    expect(r.buckets.map((b) => [b.key, b.leases.map((l) => l.id)])).toEqual([
      ['holdover', ['d']],
      ['mtm', ['c']],
      ['2026', ['b']],
      ['2027', ['a']],
      ['2028', []],
      ['2029', []],
      ['2030', []],
      ['2031', []],
      ['later', ['e']],
    ]);
    expect(r.buckets.find((b) => b.key === 'later')?.label).toBe('2032+');
    expect(r.leaseCount).toBe(5);
    expect(r.monthlyRent).toBe(10000);
    expect(r.buckets.find((b) => b.key === '2027')?.rentPct).toBeCloseTo(30);
    expect(r.buckets[r.buckets.length - 1].cumulativeRentPct).toBeCloseTo(100);
    expect(r.nextExpiry?.id).toBe('b');
  });

  it('weights the average term by rent and by area, with month to month and holdover at zero', () => {
    const r = buildExpiryLadder(leases, { today: TODAY, sqftOf });
    const yrs = (end: Date) => (end.getTime() - TODAY.getTime()) / 86400000 / 365.25;
    const a = yrs(new Date(2027, 5, 30));
    const b = yrs(new Date(2026, 11, 31));
    const e = yrs(new Date(2040, 0, 31));
    expect(r.waltByRent).toBeCloseTo((3000 * a + 1000 * b + 4500 * e) / 10000, 6);
    expect(r.waltBySqft).toBeCloseTo((1500 * a + 500 * b + 9000 * e) / 12200, 6);
  });

  it('skips inactive and not-yet-started leases, and drops area weighting when a size is missing', () => {
    const r = buildExpiryLadder(
      [
        ...leases,
        { id: 'f', deal_id: 'd1', monthly_rent: 9999, lease_start_date: '2027-01-01', lease_end_date: '2030-01-01' },
        { id: 'g', deal_id: 'd1', monthly_rent: 9999, is_active: false, lease_end_date: '2029-01-01' },
      ],
      { today: TODAY },
    );
    expect(r.leaseCount).toBe(5);
    expect(r.monthlyRent).toBe(10000);
    expect(r.waltBySqft).toBeNull();
  });

  it('handles no leases', () => {
    const r = buildExpiryLadder([], { today: TODAY, years: 3 });
    expect(r.buckets.map((b) => b.key)).toEqual(['2026', '2027', '2028']);
    expect(r.waltByRent).toBeNull();
    expect(r.nextExpiry).toBeNull();
  });
});
