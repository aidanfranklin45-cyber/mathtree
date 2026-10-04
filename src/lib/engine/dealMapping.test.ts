import { describe, it, expect } from 'vitest';
import { mapSupabaseDeal } from '../../stores/useDealStore';
import { computeDealMetrics, calculateProjections } from './testEngine';

/**
 * Real prospect deals from production (inputs trimmed to the fields the engine reads).
 * `storedIrr` is what the old edge function saved on 9/25 (engine 7a6ba9e reproduces it exactly).
 * The 9/28 engine commits (multi-timeline calendar, stub-year proration) and the 9/30 lease-expiry default
 * (engine 2026-09-30.3: a lease with no stated expiry assumption renews on current terms instead of its income
 * stopping) intentionally moved the results, so `currentIrr` pins today's engine. Regression covered: the mapper used to inject
 * defaults (vacancyRatePercent 5, rentGrowthPercent 3) that shadowed legitimate zeros.
 */
const rows = [
  {
    name: '301 Pleasant Ave (vacancyRate 0)',
    storedIrr: 8.72,
    currentIrr: 8.56,
    row: {
      id: '2f890d0d', asset_type: 'single-family', status: 'prospect', purchase_price: '280000',
      inputs: {
        purchasePrice: 280000, downPaymentPercent: 25, interestRate: 6, loanTerm: 25, exitYear: 15,
        rehabCosts: 15000, rehabBudget: 15000, closingCosts: 0, rentGrowth: 3, annualRentGrowth: 3,
        vacancyRate: 0, monthlyRent: 1450, grossRentPerMonth: 1450, grossRentAnnual: 17400,
        expenseRatio: 27, operatingExpenseRatio: 27, appreciationRate: 3, targetCapRate: 3,
        targetExitCapRate: 3, exitCapTiming: 'day1', financingType: 'fixed', leaseType: 'Gross',
        closingDate: '2026-10-01', arv: 300000, totalAssessedValue: 331000, combinedAssessedValue: 331000,
        manageProperty: false, unitCount: 1, numUnits: 1, discountRate: 8, rehabFinancingMode: 'out_of_pocket',
        armInitialYears: 5, armAdjustmentRate: 7.75, armRateCap: 9.5, interestOnlyYears: 3,
        prorateFirstYear: false, firstYearMonths: 12, loiDate: '', initialCashInvested: 0, financeRehabAndClosingCosts: false,
        leases: [{
          is_active: true, leaseType: 'Gross', annualRent: 17400, tenantName: '301 pleasant', monthlyRent: 1450,
          leaseEndDate: '', escalationRate: 3, escalationType: 'Percentage Bump (%)', leaseStartDate: '2026-10-01',
          nextEscalationDate: '', escalationFrequency: 'Annual on Anniversary',
        }],
      },
    },
  },
  {
    name: '411 S 3rd St (rentGrowth 0, all-cash)',
    storedIrr: 6.69,
    currentIrr: 6.85, // 4.92 before 2026-09-30.3: its 2029-05-31 lease expiry now renews instead of stopping income
    row: {
      id: '0c1f74b8', asset_type: 'single-family', status: 'prospect', purchase_price: '596200',
      inputs: {
        purchasePrice: 596200, downPaymentPercent: 100, interestRate: 6.5, loanTerm: 30, exitYear: 10,
        rehabCosts: 0, rehabBudget: 0, closingCosts: 9000, rentGrowth: 0, annualRentGrowth: 0,
        vacancyRate: 4, monthlyRent: 3182.7, grossRentPerMonth: 3182.7, grossRentAnnual: 38192.4,
        expenseRatio: 25, operatingExpenseRatio: 25, appreciationRate: 4, targetCapRate: 4,
        targetExitCapRate: 4, exitCapTiming: 'amortized', financingType: 'fixed', leaseType: 'Gross',
        closingDate: '', totalAssessedValue: 596200, combinedAssessedValue: 596200,
        manageProperty: true, unitCount: 1, numUnits: 1, discountRate: 6, rehabFinancingMode: 'out_of_pocket',
        armInitialYears: 5, armAdjustmentRate: 7.75, armRateCap: 9.5, interestOnlyYears: 3,
        prorateFirstYear: false, firstYearMonths: 12, loiDate: '', initialCashInvested: 0, financeRehabAndClosingCosts: false,
        leases: [{
          is_active: true, leaseType: 'Gross', annualRent: 37080, tenantName: 'Benchmark Gamma', monthlyRent: 3090,
          leaseEndDate: '2029-05-31', escalationRate: 3, escalationType: 'Percentage Bump (%)',
          leaseStartDate: '2024-06-01', nextEscalationDate: '2026-06-01', escalationFrequency: 'Annual on Anniversary',
        }],
      },
    },
  },
];

describe('DB row -> mapSupabaseDeal -> engine', () => {
  for (const c of rows) {
    it(`${c.name}: mapping adds nothing, so the result equals the engine run on the raw DB inputs`, () => {
      const viaMapper = computeDealMetrics(mapSupabaseDeal(c.row)).irr;
      const direct = calculateProjections(c.row.asset_type, { ...c.row.inputs }).irr;
      expect(viaMapper).toBe(direct);
    });

    it(`${c.name}: current-engine IRR is pinned (stored IRR ${c.storedIrr} predates the 9/28 and 9/30 engine changes)`, () => {
      expect(computeDealMetrics(mapSupabaseDeal(c.row)).irr).toBeCloseTo(c.currentIrr, 1);
    });
  }

  it('the mapper never fabricates values that shadow an explicit zero', () => {
    const deal = mapSupabaseDeal(rows[0].row);
    expect(deal.inputs.vacancyRatePercent).toBeUndefined();
    expect(deal.inputs.rentGrowthPercent).toBeUndefined();
    const deal2 = mapSupabaseDeal(rows[1].row);
    expect(deal2.inputs.rentGrowth).toBe(0);
    expect(deal2.inputs.rentGrowthPercent).toBeUndefined();
  });
});
