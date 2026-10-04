import { describe, it, expect } from 'vitest';
import { isLeaseInForce, leaseMonthlyRent, leaseStatusOn } from './leases';

describe('isLeaseInForce (the one rule, both lease shapes)', () => {
  const t = '2026-10-01';
  it('table and inputs shapes agree', () => {
    expect(isLeaseInForce({ lease_start_date: '2026-01-01', lease_end_date: '2027-01-01' }, t)).toBe(true);
    expect(isLeaseInForce({ leaseStartDate: '2026-01-01', leaseEndDate: '2027-01-01' }, t)).toBe(true);
    expect(isLeaseInForce({ leaseEndDate: '2026-09-30' }, t)).toBe(false);
    expect(isLeaseInForce({ lease_start_date: '2026-10-02' }, t)).toBe(false);
  });
  it('inclusive on start and end day; open-ended when undated', () => {
    expect(isLeaseInForce({ lease_start_date: t, lease_end_date: t }, t)).toBe(true);
    expect(isLeaseInForce({}, t)).toBe(true);
  });
  it('month to month ignores a stale end date; inactive is never in force', () => {
    expect(isLeaseInForce({ term_type: 'month_to_month', lease_end_date: '2026-01-31' }, t)).toBe(true);
    expect(isLeaseInForce({ is_active: false }, t)).toBe(false);
    expect(leaseStatusOn(null, t)).toBe('inactive');
  });
  it('accepts a Date', () => {
    expect(isLeaseInForce({ lease_end_date: '2026-10-01' }, new Date('2026-10-01T12:00:00'))).toBe(true);
  });
});

describe('leaseMonthlyRent', () => {
  it('reads either shape, falls back to annual / 12, and is null (not 0) when unstated', () => {
    expect(leaseMonthlyRent({ monthly_rent: 1500 })).toBe(1500);
    expect(leaseMonthlyRent({ monthlyRent: '1200' })).toBe(1200);
    expect(leaseMonthlyRent({ annualRent: 24000 })).toBe(2000);
    expect(leaseMonthlyRent({ monthly_rent: 0 })).toBeNull();
    expect(leaseMonthlyRent({})).toBeNull();
  });
});
