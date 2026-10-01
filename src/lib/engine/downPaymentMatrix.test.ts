import { describe, it, expect } from 'vitest';
import { calculateDownPaymentMatrix, calculateProjections, firstFullYear } from './index';

describe('calculateDownPaymentMatrix', () => {
  const baseCommercial = {
    purchasePrice: 1000000,
    downPaymentPercent: 25,
    interestRate: 6.5,
    loanTerm: 30,
    grossRentAnnual: 120000,
    vacancyRate: 5,
    expenseRatio: 20,
    closingCosts: 20000,
    rehabCosts: 30000,
  };

  it('matches calculateProjections headline figures for the baseline row', () => {
    const matrixRes = calculateDownPaymentMatrix('commercial', baseCommercial);
    const baselineRow = matrixRes.rows.find((r) => r.isBaseline);

    expect(baselineRow).toBeDefined();
    expect(baselineRow?.downPaymentPercent).toBe(25);

    const directRes = calculateProjections('commercial', baseCommercial);
    const y1 = firstFullYear(directRes.projections) || directRes.projections[0];

    expect(baselineRow?.loanAmount).toBe(directRes.loanAmount);
    expect(baselineRow?.initialCashInvested).toBe(directRes.initialCashInvested);
    expect(baselineRow?.downPaymentAmount).toBe(directRes.downPaymentAmount);
    expect(baselineRow?.monthlyDebtService).toBe(directRes.monthlyMortgagePayment);
    expect(baselineRow?.annualDebtService).toBe(y1.debtService);
    expect(baselineRow?.netCashFlow).toBe(y1.cashFlow);
    expect(baselineRow?.cashOnCash).toBe(y1.cashOnCash);
    expect(baselineRow?.dscr).toBe(y1.dscr);
  });

  it('correctly calculates out_of_pocket vs roll_into_loan rehab financing modes', () => {
    // Mode 1: Out of pocket
    const outOfPocketRes = calculateDownPaymentMatrix('commercial', {
      ...baseCommercial,
      rehabFinancingMode: 'out_of_pocket',
    });
    const oop20 = outOfPocketRes.rows.find((r) => r.downPaymentPercent === 20)!;
    // Price = 1,000,000. 20% down = 200,000. Cash invested = 200,000 + 20,000 closing + 30,000 rehab = 250,000
    expect(oop20.downPaymentAmount).toBe(200000);
    expect(oop20.loanAmount).toBe(800000);
    expect(oop20.initialCashInvested).toBe(250000);

    // Mode 2: Roll into loan
    const rollInRes = calculateDownPaymentMatrix('commercial', {
      ...baseCommercial,
      rehabFinancingMode: 'roll_into_loan',
    });
    const roll20 = rollInRes.rows.find((r) => r.downPaymentPercent === 20)!;
    // Basis = 1,000,000 + 20,000 + 30,000 = 1,050,000. 20% down = 210,000. Cash invested = 210,000
    expect(roll20.downPaymentAmount).toBe(210000);
    expect(roll20.loanAmount).toBe(840000);
    expect(roll20.initialCashInvested).toBe(210000);

    const roll40 = rollInRes.rows.find((r) => r.downPaymentPercent === 40)!;
    // 40% of 1,050,000 = 420,000. Initial cash invested scales to 420,000
    expect(roll40.downPaymentAmount).toBe(420000);
    expect(roll40.initialCashInvested).toBe(420000);
  });

  it('handles edge cases: 0% down, 100% all-cash, and interest-only loans without divide-by-zero', () => {
    const edgeRes = calculateDownPaymentMatrix('commercial', baseCommercial, [0, 25, 100]);

    const zeroRow = edgeRes.rows.find((r) => r.downPaymentPercent === 0)!;
    expect(zeroRow.downPaymentAmount).toBe(0);
    expect(zeroRow.loanAmount).toBe(1000000);
    expect(zeroRow.ltv).toBe(100);
    expect(zeroRow.annualDebtService).toBeGreaterThan(0);

    const fullRow = edgeRes.rows.find((r) => r.downPaymentPercent === 100)!;
    expect(fullRow.loanAmount).toBe(0);
    expect(fullRow.ltv).toBe(0);
    expect(fullRow.annualDebtService).toBe(0);
    expect(fullRow.dscr).toBeNull();
    const directFull = calculateProjections('commercial', { ...baseCommercial, downPaymentPercent: 100 });
    const fullY1 = firstFullYear(directFull.projections) || directFull.projections[0];
    expect(fullRow.netCashFlow).toBe(fullY1.cashFlow);

    // Interest-only check
    const ioRes = calculateDownPaymentMatrix('commercial', {
      ...baseCommercial,
      financingType: 'interest_only',
      interestOnlyYears: 5,
    });
    const io25 = ioRes.rows.find((r) => r.downPaymentPercent === 25)!;
    const expectedIoAnnualPayment = 750000 * (6.5 / 100);
    expect(Math.round(io25.annualDebtService)).toBe(Math.round(expectedIoAnnualPayment));
  });

  it('deduplicates presets with baseline and sorts percentages ascending', () => {
    // Presets with duplicate baseline and unordered list
    const res = calculateDownPaymentMatrix('commercial', { ...baseCommercial, downPaymentPercent: 20 }, [35, 20, 15, 35, 10]);
    const percentages = res.rows.map((r) => r.downPaymentPercent);

    expect(percentages).toEqual([10, 15, 20, 35]);
    const baselineRow = res.rows.find((r) => r.isBaseline);
    expect(baselineRow?.downPaymentPercent).toBe(20);
  });

  it('evaluates leverage type accurately by comparing going-in cap rate against loan constant', () => {
    // 1. Positive leverage: High Net Operating Income ($100k on $1M = 10% cap) vs 5% rate (loan constant ~6.44%)
    const positiveRes = calculateDownPaymentMatrix('commercial', {
      purchasePrice: 1000000,
      downPaymentPercent: 25,
      interestRate: 5.0,
      loanTerm: 30,
      grossRentAnnual: 125000,
      vacancyRate: 0,
      expenseRatio: 20, // NOI = 100,000 -> 10% cap rate
    });
    expect(positiveRes.goingInCapRate).toBeCloseTo(10.0, 1);
    expect(positiveRes.loanConstant).toBeLessThan(positiveRes.goingInCapRate);
    expect(positiveRes.leverageType).toBe('positive');

    // 2. Negative leverage: Low NOI ($40k on $1M = 4% cap) vs 7.5% rate (loan constant ~8.39%)
    const negativeRes = calculateDownPaymentMatrix('commercial', {
      purchasePrice: 1000000,
      downPaymentPercent: 25,
      interestRate: 7.5,
      loanTerm: 30,
      grossRentAnnual: 50000,
      vacancyRate: 0,
      expenseRatio: 20, // NOI = 40,000 -> 4% cap rate
    });
    expect(negativeRes.goingInCapRate).toBeCloseTo(4.0, 1);
    expect(negativeRes.loanConstant).toBeGreaterThan(negativeRes.goingInCapRate);
    expect(negativeRes.leverageType).toBe('negative');
  });
});
