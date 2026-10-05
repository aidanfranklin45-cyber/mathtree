import { describe, it, expect } from 'vitest';
import { proposeChanges, buildApplication, knownTenantNames } from './apply';
import { coerceIntake } from '@engine/intakeParse';

const rentRoll = coerceIntake('rent_roll', {
  asOfDate: { value: '2026-03-01', confidence: 1 },
  rentPeriod: { value: 'monthly', confidence: 1 },
  rows: [
    { unit: { value: '101', confidence: 1 }, tenantName: { value: 'Jane Doe', confidence: 1 }, monthlyRent: { value: 1500, confidence: 1 }, status: { value: 'occupied', confidence: 1 }, leaseStartDate: { value: '2025-06-01', confidence: 1 }, leaseEndDate: { value: '2026-05-31', confidence: 1 } },
  ],
});

describe('applying parsed documents', () => {
  const deal = { asset_class: 'multi-unit', purchase_price: 300000, inputs: { purchasePrice: 300000, leases: [{ tenantName: 'Old Tenant' }] } as Record<string, any> };

  it('proposes the tenants, flags that they replace the current list, and applies only what is ticked', () => {
    const p = proposeChanges([rentRoll], deal);
    const leases = p.changes.find((c) => c.key === 'leases')!;
    expect(leases.proposed).toBe('1 tenant');
    expect(leases.replaces).toBe(true);
    expect(knownTenantNames(deal)).toEqual(['Old Tenant']);

    expect(buildApplication(deal, p, new Set()).inputsPatch).toEqual({});
    const applied = buildApplication(deal, p, new Set(['leases']));
    expect((applied.inputsPatch.leases as any[])[0].tenantName).toBe('Jane Doe');
    expect(applied.top).toEqual({});
  });
});
