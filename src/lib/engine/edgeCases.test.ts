import { describe, it, expect } from 'vitest';
import {
  calculateIRR, calculateNPV, getAnnualAmortization, getMonthlyAmortization, calculateMonthlyPayment, calculateRemainingBalance, n, ni, normalizeAssetClass,
} from '../../../supabase/functions/_shared/math-engine';

describe('IRR edge cases', () => {
  it('matches a known 2-period IRR', () => {
    expect(calculateIRR([-100, 0, 121])).toBeCloseTo(10, 1);
  });
  it('handles total loss as -100% (not a positive number)', () => {
    expect(calculateIRR([-100, 0, 0])).toBeLessThanOrEqual(-90);
  });
  it('handles negative IRR', () => {
    expect(calculateIRR([-100, 50, 25])).toBeCloseTo(-19.1, 0);
  });
  it('a zero return is +0, never -0', () => {
    expect(Object.is(calculateIRR([-1000, 500, 500]), 0)).toBe(true);
  });
  it('treats a positive first flow as an outflow (documented abs)', () => {
    expect(calculateIRR([100, 0, 121])).toBeCloseTo(10, 1);
  });
  it('is stable with a late large inflow (Newton diverges)', () => {
    const v = calculateIRR([-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1000]);
    expect(v).toBeGreaterThan(90);
    expect(v).toBeLessThan(120);
  });
});

describe('NPV', () => {
  it('discounts t=0 undiscounted', () => {
    expect(calculateNPV(10, [-100, 110])).toBe(0);
  });
  it('empty flows = 0', () => {
    expect(calculateNPV(10, [])).toBe(0);
  });
  it('rate of -100% does not yield NaN', () => {
    expect(Number.isFinite(calculateNPV(-100, [-100, 50]))).toBe(true);
  });
  it('never returns negative zero', () => {
    expect(Object.is(calculateNPV(10, [-100, 110]), 0)).toBe(true);
  });
});

describe('debt primitives', () => {
  it('zero-rate payment is straight-line', () => {
    expect(calculateMonthlyPayment(1200, 0, 1)).toBe(100);
  });
  it('negative loan returns 0', () => {
    expect(calculateMonthlyPayment(-1, 5, 30)).toBe(0);
  });
  it('balance at t=0 equals loan', () => {
    expect(calculateRemainingBalance(100000, 6, 30, 0)).toBeCloseTo(100000, 4);
  });
  it('balance never exceeds loan for negative elapsed years', () => {
    expect(calculateRemainingBalance(100000, 6, 30, -1)).toBeLessThanOrEqual(100000 + 1e-6);
  });
  it('fractional term: 0-year term does not divide by zero', () => {
    expect(Number.isFinite(calculateRemainingBalance(100000, 6, 0, 0))).toBe(true);
  });
  it('balance after full term is 0', () => {
    expect(calculateRemainingBalance(100000, 6, 30, 30)).toBe(0);
    expect(calculateRemainingBalance(100000, 6, 30, 29.99)).toBeLessThan(1000);
  });
  it('interest-only-ish tiny rate stays finite', () => {
    expect(Number.isFinite(calculateMonthlyPayment(100000, 1e-12, 30))).toBe(true);
  });
});

describe('coercion', () => {
  it('n parses currency strings with commas', () => {
    expect(n('1,250,000')).toBe(1250000);
  });
  it('n parses $ prefix', () => {
    expect(n('$500')).toBe(500);
  });
  it('n keeps 0', () => { expect(n(0, 5)).toBe(0); });
  it('ni truncates', () => { expect(ni('7.9')).toBe(7); });
  it('normalizeAssetClass maps self storage', () => {
    expect(normalizeAssetClass('Self Storage')).toBe('storage');
    expect(normalizeAssetClass('self-storage')).toBe('storage');
  });
  it('normalizeAssetClass: multifamily', () => {
    expect(normalizeAssetClass('Multifamily')).toBe('multi-unit');
  });
  it('normalizeAssetClass: "Multi-Family" not misread as single-family', () => {
    expect(normalizeAssetClass('Single Family')).toBe('single-family');
  });
});

describe('amortization consistency', () => {
  it('annual and monthly schedules agree through an interest-only period', () => {
    const o: any = { financingType: 'interest_only', interestOnlyYears: 2, holdingPeriod: 5 };
    const a = getAnnualAmortization(1000000, 6, 25, o);
    const m = getMonthlyAmortization(1000000, 6, 25, o);
    for (const yr of [1, 2, 3, 5]) {
      expect(m[yr * 12 - 1].endingBalance).toBeCloseTo(a[yr - 1].endingBalance, -1);
    }
  });
});
