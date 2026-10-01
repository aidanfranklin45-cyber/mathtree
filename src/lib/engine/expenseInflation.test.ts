import { describe, it, expect } from 'vitest';
import { calculateProjections } from './index';
import { seedForm, buildInputs } from '../../components/studio/modals/editInputsForm';
import { computeDealMetrics } from './compute';
import type { DealRecord } from '../math/types';

describe('expense inflation underwriting mechanics', () => {
  it('escalates operating expenses at expenseGrowth when rent growth is zero', () => {
    const inputs = {
      purchasePrice: 1000000,
      downPaymentPercent: 25,
      interestRate: 6.5,
      loanTerm: 30,
      monthlyRent: 10000,
      vacancyRate: 0,
      expenseRatio: 30,
      rentGrowth: 0,
      expenseGrowth: 3.0,
      exitYear: 5,
    };

    const res = calculateProjections('residential', inputs);
    const y1Opex = res.projections[0].operatingExpenses;
    const y2Opex = res.projections[1].operatingExpenses;
    const y3Opex = res.projections[2].operatingExpenses;

    // Y1 opex: $120,000 * 30% = $36,000
    expect(y1Opex).toBeCloseTo(36000, 0);
    // Y2 opex: $36,000 * 1.03 = $37,080
    expect(y2Opex).toBeCloseTo(36000 * 1.03, 0);
    // Y3 opex: $36,000 * 1.03^2 = $38,192.40
    expect(y3Opex).toBeCloseTo(36000 * Math.pow(1.03, 2), 0);
  });

  it('keeps expense inflation decoupled from rent growth', () => {
    // 6% rent growth, but 2% expense inflation
    const inputs = {
      purchasePrice: 1000000,
      downPaymentPercent: 25,
      interestRate: 6.5,
      loanTerm: 30,
      monthlyRent: 10000,
      vacancyRate: 0,
      expenseRatio: 30,
      rentGrowth: 6.0,
      expenseGrowth: 2.0,
      exitYear: 5,
    };

    const res = calculateProjections('residential', inputs);
    // Y2 gross revenue grows 6%
    expect(res.projections[1].grossPotentialIncome).toBeCloseTo(120000 * 1.06, 0);
    // Y2 opex grows 2%, NOT 6%
    expect(res.projections[1].operatingExpenses).toBeCloseTo(36000 * 1.02, 0);
  });

  it('correctly handles aliases (expenseInflation, expenseGrowthPercent, expenseGrowthRate)', () => {
    const base = {
      purchasePrice: 500000,
      downPaymentPercent: 20,
      interestRate: 6.5,
      loanTerm: 30,
      monthlyRent: 4000,
      vacancyRate: 0,
      expenseRatio: 25,
      rentGrowth: 0,
      exitYear: 3,
    };

    const r1 = calculateProjections('residential', { ...base, expenseGrowth: 4.0 });
    const r2 = calculateProjections('residential', { ...base, expenseInflation: 4.0 });
    const r3 = calculateProjections('residential', { ...base, expenseGrowthPercent: 4.0 });
    const r4 = calculateProjections('residential', { ...base, expenseGrowthRate: 4.0 });

    expect(r1.projections[1].operatingExpenses).toBe(r2.projections[1].operatingExpenses);
    expect(r1.projections[1].operatingExpenses).toBe(r3.projections[1].operatingExpenses);
    expect(r1.projections[1].operatingExpenses).toBe(r4.projections[1].operatingExpenses);
  });

  it('round-trips expenseGrowth through seedForm and buildInputs', () => {
    const deal: DealRecord = {
      id: 'd-test-exp',
      title: 'Pine Ridge Apartments',
      asset_class: 'multi-unit',
      status: 'prospect',
      purchase_price: 1500000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      inputs: {
        purchasePrice: 1500000,
        downPaymentPercent: 25,
        interestRate: 6.5,
        loanTerm: 30,
        unitCount: 8,
        monthlyRentPerUnit: 1500,
        vacancyRate: 5,
        expenseRatio: 35,
        rentGrowth: 3.5,
        expenseGrowth: 2.8,
        appreciationRate: 3.5,
        closingDate: '2026-10-01',
        exitYear: 10,
      },
    };

    const form = seedForm(deal);
    expect(form.expenseGrowth).toBe('2.8');

    const rebuilt = buildInputs(form, deal);
    expect(rebuilt.expenseGrowth).toBe(2.8);
    expect(rebuilt.expenseInflation).toBe(2.8);

    const mOriginal = computeDealMetrics(deal);
    const mRebuilt = computeDealMetrics(deal, rebuilt);
    expect(mRebuilt.irr).toBeCloseTo(mOriginal.irr, 2);
    expect(mRebuilt.projections[2].operatingExpenses).toBeCloseTo(mOriginal.projections[2].operatingExpenses, 1);
  });

  it('preserves backward compatibility when expenseGrowth is undefined', () => {
    const inputs = {
      purchasePrice: 1000000,
      downPaymentPercent: 25,
      interestRate: 6.5,
      loanTerm: 30,
      monthlyRent: 8000,
      vacancyRate: 0,
      expenseRatio: 30,
      rentGrowth: 4.0,
      exitYear: 5,
    };

    const res = calculateProjections('residential', inputs);
    // When expenseGrowth is undefined, expenses grow with rent growth (4%)
    const y1Opex = res.projections[0].operatingExpenses;
    const y2Opex = res.projections[1].operatingExpenses;
    expect(y2Opex).toBeCloseTo(y1Opex * 1.04, 0);
  });

  it('escalates vacant holding costs with expenseGrowth', () => {
    const inputs = {
      purchasePrice: 500000,
      downPaymentPercent: 100,
      interestRate: 0,
      loanTerm: 30,
      grossRentAnnual: 0,
      vacancyRate: 0,
      expenseRatio: 0,
      rentGrowth: 0,
      expenseGrowth: 3.5,
      isVacantLand: true,
      annualTaxes: 4000,
      annualInsurance: 600,
      annualMaintenance: 600,
      exitYear: 4,
    };

    const res = calculateProjections('commercial', inputs);
    const y1 = res.projections[0].operatingExpenses; // 4000 + 600 + 600 = 5200
    const y2 = res.projections[1].operatingExpenses;
    const y3 = res.projections[2].operatingExpenses;

    expect(y1).toBe(5200);
    expect(y2).toBeCloseTo(5200 * 1.035, 0);
    expect(y3).toBeCloseTo(5200 * Math.pow(1.035, 2), 0);
  });
});

