import { describe, it, expect } from 'vitest';
import { missingInputsFor } from './compute';

const base = {
  asset_class: 'multi-unit', purchase_price: 18_400_000,
  inputs: {
    purchasePrice: 18_400_000, closingDate: '2026-11-17', downPaymentPercent: 25, interestRate: 6.75, amortizationYears: 25,
    grossRentAnnual: 1_450_800, monthlyRent: 120_900, unitCount: 66, vacancyRate: 5, rentGrowth: 3, expenseGrowth: 3, expenseRatio: 21,
    capexReserveAnnual: 16_500, appreciationRate: 3, discountRate: 6, exitYear: 10, sellingCostPercent: 4, closingCosts: 368_000,
  } as Record<string, any>,
};

describe('a lease that is only a rent figure', () => {
  it('does not stop a property for an escalation no lease states', () => {
    const shell = { ...base, inputs: { ...base.inputs, leases: [{ monthlyRent: 120_900, annualRent: 1_450_800, is_active: true }] } };
    expect(missingInputsFor(shell as any).map((m) => m.key)).not.toContain('leases[0].escalationRate');
  });

  it('still asks when a real lease (a tenant or dates) has no escalation', () => {
    const real = { ...base, inputs: { ...base.inputs, leases: [{ tenantName: 'Acme', monthlyRent: 5000, leaseStartDate: '2026-01-01' }] } };
    expect(missingInputsFor(real as any).map((m) => m.key)).toContain('leases[0].escalationRate');
  });
});
