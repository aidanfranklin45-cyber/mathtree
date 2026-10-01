import { describe, it, expect } from 'vitest';
import { currentLeases } from './leases';

const intercompany = { tenantName: 'Operating LLC (intercompany rent)', monthlyRent: 2600, leaseStartDate: '2025-07-15', leaseEndDate: '2026-07-31' };
const formal = { tenantName: 'Operating LLC', monthlyRent: 2600, leaseStartDate: '2026-08-03', leaseEndDate: '2036-08-03' };
const day = (s: string) => new Date(`${s}T12:00:00`);

describe('current leases (what the tenant count shows)', () => {
  it('counts only the lease in force today when an earlier period has ended', () => {
    const r = currentLeases({ leases: [formal, intercompany] }, day('2026-10-01'));
    expect(r.map((l) => l.tenantName)).toEqual(['Operating LLC']);
  });

  it('shows the earlier period while it is the one running', () => {
    const r = currentLeases({ leases: [formal, intercompany] }, day('2026-03-01'));
    expect(r.map((l) => l.tenantName)).toEqual(['Operating LLC (intercompany rent)']);
  });

  it('counts genuinely concurrent tenants (a multi-tenant building)', () => {
    const a = { tenantName: 'A', monthlyRent: 1000, leaseStartDate: '2025-01-01', leaseEndDate: '2030-01-01' };
    const b = { tenantName: 'B', monthlyRent: 1500 };
    expect(currentLeases({ leases: [a, b] }, day('2026-10-01'))).toHaveLength(2);
  });

  it('falls back to all leases when none is running (not started yet, or all ended)', () => {
    expect(currentLeases({ leases: [formal] }, day('2026-01-01'))).toHaveLength(1);
    expect(currentLeases({ leases: [intercompany] }, day('2030-01-01'))).toHaveLength(1);
  });

  it('ignores empty lease rows and missing leases', () => {
    expect(currentLeases({ leases: [{}, null, formal] }, day('2026-10-01'))).toHaveLength(1);
    expect(currentLeases({}, day('2026-10-01'))).toEqual([]);
    expect(currentLeases(null)).toEqual([]);
  });
});
