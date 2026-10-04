import { describe, it, expect } from 'vitest';
import { rentRollToInputs } from './rentRollInputs';
import { computeDealMetrics } from '../engine/testEngine';
import { withLegacyDefaults } from '../engine/testInputs';

const units = [
  { id: 'u1', unit_number: '1A', status: 'occupied' },
  { id: 'u2', unit_number: '1B', status: 'occupied' },
  { id: 'u10', unit_number: '10A', status: 'occupied' },
  { id: 'u3', unit_number: '1C', status: 'vacant' },
];
const lease = (over: Record<string, any> = {}) => ({
  id: 'l1', unit_id: 'u1', tenant_name: 'Jane Doe', monthly_rent: 1450, lease_start_date: '2024-03-01', lease_end_date: '2028-02-29', term_type: 'fixed',
  lease_type: 'Gross', escalation_type: 'Percentage Bump (%)', escalation_rate: 3, escalation_frequency: 'Annual on Anniversary', next_escalation_date: '2027-03-01',
  payment_due_day: 1, grace_period_days: 5, is_active: true, ...over,
});
const today = '2026-10-01';
const run = (leases: any[], u = units, assetClass = 'multi-unit') => rentRollToInputs({ leases, units: u, today, assetClass });

describe('turning a rent roll into underwriting inputs', () => {
  it('each tenant becomes its own lease with its own rent, and the totals add up', () => {
    const r = run([
      lease(),
      lease({ id: 'l2', unit_id: 'u2', tenant_name: 'Sam Lee', monthly_rent: 1395, lease_start_date: '2023-09-15', lease_end_date: null, term_type: 'month_to_month' }),
    ]);
    expect(r.patch.leases).toHaveLength(2);
    expect(r.patch.leases.map((l: any) => [l.tenantName, l.unit, l.monthlyRent])).toEqual([['Jane Doe', '1A', 1450], ['Sam Lee', '1B', 1395]]);
    expect(r.patch.monthlyRent).toBe(2845);
    expect(r.patch.grossRentPerMonth).toBe(2845);
    expect(r.patch.grossRentAnnual).toBe(34140);
    expect(r.summary).toMatchObject({ tenants: 2, monthlyRent: 2845, annualRent: 34140, monthToMonth: 1, averageRent: 1422.5 });
  });

  it('month-to-month tenants have no end date and no scheduled increase; fixed terms keep theirs', () => {
    const r = run([lease(), lease({ id: 'l2', unit_id: 'u2', term_type: 'month_to_month', lease_end_date: null })]);
    const [fixed, mtm] = r.patch.leases;
    expect(fixed).toMatchObject({ leaseEndDate: '2028-02-29', escalationRate: 3, nextEscalationDate: '2027-03-01', termType: 'fixed' });
    expect(mtm).toMatchObject({ leaseEndDate: '', escalationRate: 0, escalationType: '', nextEscalationDate: '', termType: 'month_to_month' });
  });

  it('orders units naturally (10A after 1B) and counts vacant units', () => {
    const r = run([lease({ id: 'a', unit_id: 'u10', tenant_name: 'Ten' }), lease({ id: 'b', unit_id: 'u2', tenant_name: 'Two' }), lease({ id: 'c', unit_id: 'u1', tenant_name: 'One' })]);
    expect(r.patch.leases.map((l: any) => l.unit)).toEqual(['1A', '1B', '10A']);
    expect(r.summary.vacantUnits).toBe(1);
    expect(r.warnings.join(' ')).toContain('vacant');
  });

  it('leaves out inactive leases and fixed-term leases that already ended, and says so', () => {
    const r = run([lease(), lease({ id: 'x', unit_id: 'u2', is_active: false }), lease({ id: 'y', unit_id: 'u10', lease_end_date: '2026-06-30' })]);
    expect(r.patch.leases).toHaveLength(1);
    expect(r.summary.expiredLeases).toBe(1);
    expect(r.warnings.join(' ')).toContain('already ended');
  });

  it('a month-to-month lease with a stale end date is still in force', () => {
    const r = run([lease({ term_type: 'month_to_month', lease_end_date: '2020-01-01' })]);
    expect(r.patch.leases).toHaveLength(1);
    expect(r.patch.leases[0].leaseEndDate).toBe('');
  });

  it('marks where the numbers came from, and sets the unit count for apartments and storage only', () => {
    const apt = run([lease()]);
    expect(apt.patch).toMatchObject({ rentRollSource: 'rent_roll', rentRollAsOf: today, rentRollTenantCount: 1, unitCount: 4 });
    const office = run([lease()], units, 'commercial');
    expect(office.patch.unitCount).toBeUndefined();
    const storage = run([lease()], units, 'storage');
    expect(storage.patch).toMatchObject({ unitCount: 4, storageUnitCount: 4 });
  });

  it('warns when there are no tenants, and about very large rent rolls', () => {
    expect(run([]).warnings.join(' ')).toContain('no tenants in force');
    const many = Array.from({ length: 31 }, (_, i) => lease({ id: `m${i}`, unit_id: null, tenant_name: `T${i}` }));
    expect(run(many).warnings.join(' ')).toContain('large rent roll');
  });

  it('the engine reads each tenant separately: different rents, and rent after a lease ends follows the default', () => {
    const r = run([
      lease({ monthly_rent: 1000, lease_end_date: '2040-01-31', escalation_rate: 0, escalation_type: '' }),
      lease({ id: 'l2', unit_id: 'u2', tenant_name: 'Sam', monthly_rent: 2000, lease_end_date: '2040-01-31', escalation_rate: 0, escalation_type: '' }),
    ]);
    const deal: any = {
      id: 'd', asset_class: 'multi-unit', purchase_price: 500000,
      inputs: withLegacyDefaults('multi-unit', { purchasePrice: 500000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 25, exitYear: 5, closingDate: '2026-01-01', vacancyRate: 0, expenseRatio: 10, targetCapRate: 7, discountRate: 8, unitCount: 2, ...r.patch }),
    };
    const m: any = computeDealMetrics(deal);
    const year2 = m.projections[1];
    expect(Math.round(year2.grossPotentialIncome)).toBe(36000); // (1,000 + 2,000) x 12, tenant by tenant
  });
});
