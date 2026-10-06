import { describe, it, expect } from 'vitest';
import { calculateProjections as engineProjections, calculateMonthlyPayment, aggregatePortfolio } from './index';
import { withLegacyDefaults } from './testInputs';

const calculateProjections = (asset: string, inputs: Record<string, any>) => engineProjections(asset, withLegacyDefaults(asset, inputs));

/**
 * Golden test for the shared math engine. If a later phase changes any of these headline
 * numbers, the snapshot diff shows exactly what drifted. Update snapshots only on purpose.
 */
const CASES: Record<string, { assetClass: string; inputs: Record<string, any> }> = {
  commercialNNN: {
    assetClass: 'commercial',
    inputs: {
      purchasePrice: 1850000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30,
      grossRentAnnual: 198000, vacancyRate: 5, expenseRatio: 0, rentGrowth: 3,
      appreciationRate: 3, leaseType: 'NNN', closingCosts: 37000, rehabCosts: 50000,
      exitYear: 10, discountRate: 8,
    },
  },
  multiFamily: {
    assetClass: 'multi_family',
    inputs: {
      purchasePrice: 575000, downPaymentPercent: 20, interestRate: 7, loanTerm: 30,
      monthlyRent: 5200, vacancyRate: 7, expenseRatio: 40, rentGrowth: 2.5,
      appreciationRate: 3, targetCapRate: 6.5, otherIncomeAnnual: 6000, closingCosts: 9000, exitYear: 10, discountRate: 8,
    },
  },
  residential: {
    assetClass: 'residential',
    inputs: {
      purchasePrice: 300000, downPaymentPercent: 25, interestRate: 6.75, loanTerm: 30,
      monthlyRent: 2600, vacancyRate: 5, expenseRatio: 35, rentGrowth: 3,
      appreciationRate: 3, closingCosts: 6000, exitYear: 10, discountRate: 8,
    },
  },
};

function headline(m: any) {
  const r = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  return {
    loanAmount: r(m.loanAmount),
    ltv: r(m.ltv),
    initialCashInvested: r(m.initialCashInvested),
    monthlyMortgagePayment: r(m.monthlyMortgagePayment),
    irr: r(m.irr),
    npv: r(m.npv),
    equityMultiplier: r(m.equityMultiplier),
    projectionYears: m.projections?.length,
    year1: {
      noi: r(m.projections?.[0]?.netOperatingIncome),
      debtService: r(m.projections?.[0]?.debtService),
      cashFlow: r(m.projections?.[0]?.cashFlow),
      dscr: r(m.projections?.[0]?.dscr),
    },
    year10: {
      propertyValue: r(m.projections?.[9]?.propertyValue),
      loanBalanceRemaining: r(m.projections?.[9]?.loanBalanceRemaining),
    },
  };
}

describe('math engine (shared, browser-importable)', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(`${name}: headline metrics are stable`, () => {
      const m = calculateProjections(c.assetClass, c.inputs);
      expect(m.projections.length).toBeGreaterThanOrEqual(10);
      expect(headline(m)).toMatchSnapshot();
    });
  }

  it('is pure: same inputs give identical output and inputs are not mutated', () => {
    const inputs = { ...CASES.residential.inputs };
    const before = JSON.stringify(inputs);
    const a = calculateProjections('residential', inputs);
    const b = calculateProjections('residential', inputs);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(inputs)).toBe(before);
  });

  it('loan amount and payment agree with the closed-form annuity formula', () => {
    const m = calculateProjections('residential', CASES.residential.inputs);
    const expectedLoan = 300000 * 0.75;
    expect(m.loanAmount).toBeCloseTo(expectedLoan, 0);
    expect(m.monthlyMortgagePayment).toBeCloseTo(calculateMonthlyPayment(expectedLoan, 6.75, 30), 1);
  });

  it('exports aggregatePortfolio', () => {
    expect(typeof aggregatePortfolio).toBe('function');
  });
});
