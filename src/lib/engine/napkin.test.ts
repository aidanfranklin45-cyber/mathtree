import { describe, it, expect } from 'vitest';
import { calculateNapkin, calculateProjections, firstFullYear } from './index';
import { withLegacyDefaults } from './testInputs';

const multi = withLegacyDefaults('multi-unit', {
  purchasePrice: 1_200_000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30, closingCosts: 15_000, rehabCosts: 0, exitYear: 10,
  vacancyRate: 5, expenseRatio: 40, rentGrowth: 3, unitCount: 10, monthlyRentPerUnit: 1500,
});

describe('calculateNapkin', () => {
  const k = calculateNapkin('multi-unit', multi);
  const direct = calculateProjections('multi-unit', multi);
  const y: any = firstFullYear(direct.projections as any[]);

  it('reads the first full year of the pro forma, so the story matches the table', () => {
    expect(k.grossRentAnnual).toBe(y.grossPotentialIncome ?? y.grossPotentialRent);
    expect(k.noi).toBe(y.netOperatingIncome);
    expect(k.debtService).toBe(y.debtService);
    expect(k.cashFlow).toBe(y.cashFlow);
    expect(k.basisYear).toBe(y.calendarYear);
  });

  it('builds the rent from units and an average, and the NOI from rent less vacancy and expenses', () => {
    expect(k.units).toEqual({ count: 10, label: 'unit' });
    expect(k.avgRentMonthly! * 10 * 12).toBeCloseTo(k.grossRentAnnual, 6);
    expect(k.grossRentAnnual - k.vacancyLoss - k.operatingExpenses).toBeCloseTo(k.noi, 0);
  });

  it('foots from NOI to cash flow with the loan payment and the reserve', () => {
    expect(k.noi - k.debtService - k.replacementReserve - k.otherCash).toBeCloseTo(k.cashFlow, 0);
  });

  it('measures the yield on the whole cost of acquisition and what the loan costs', () => {
    expect(k.totalCost).toBe(1_200_000 + 15_000);
    expect(k.yieldOnCostPct).toBeCloseTo((k.noi / k.totalCost) * 100, 10);
    expect(k.loanConstantPct).toBeCloseTo((k.debtService / k.loanAmount) * 100, 10);
    expect(k.leverage).toBe(k.yieldOnCostPct! > k.loanConstantPct! + 0.05 ? 'positive' : k.yieldOnCostPct! < k.loanConstantPct! - 0.05 ? 'negative' : 'neutral');
    expect(k.dscr).toBeCloseTo(k.noi / k.debtService, 10);
  });

  it('counts a home as one unit, and a lease-only commercial deal by its tenants', () => {
    const house = calculateNapkin('single-family', withLegacyDefaults('single-family', { purchasePrice: 300_000, downPaymentPercent: 20, interestRate: 6.5, loanTerm: 30, closingCosts: 6000, exitYear: 10, vacancyRate: 5, expenseRatio: 30, monthlyRent: 2400 }));
    expect(house.units).toEqual({ count: 1, label: 'home' });
    const comm = calculateNapkin('commercial', withLegacyDefaults('commercial', {
      purchasePrice: 900_000, downPaymentPercent: 30, interestRate: 6.5, loanTerm: 25, closingCosts: 9000, exitYear: 10, closingDate: '2026-01-01',
      leases: [{ tenantName: 'A', monthlyRent: 5000, leaseType: 'NNN', leaseStartDate: '2026-01-01', leaseEndDate: '2033-12-31' }, { tenantName: 'B', monthlyRent: 4000, leaseType: 'NNN', leaseStartDate: '2026-01-01', leaseEndDate: '2033-12-31' }],
    }));
    expect(comm.units).toEqual({ count: 2, label: 'tenant' });
  });

  it('has no unit story when the deal does not give one, and no loan figures with no debt', () => {
    const bare = calculateNapkin('commercial', withLegacyDefaults('commercial', { purchasePrice: 500_000, downPaymentPercent: 100, closingCosts: 5000, exitYear: 10, monthlyRent: 4000 }));
    expect(bare.units).toBeNull();
    expect(bare.avgRentMonthly).toBeNull();
    expect(bare.loanConstantPct).toBeNull();
    expect(bare.dscr).toBeNull();
    expect(bare.leverage).toBe('none');
  });
});
