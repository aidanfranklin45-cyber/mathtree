import { describe, it, expect } from 'vitest';
import { classifyAgainstOpportunityCost, classifyNapkin } from './stoplight';

describe('classifyAgainstOpportunityCost', () => {
  it.each([
    [8.0, 6, 'green'],
    [7.0, 6, 'green'],      // exactly one point above is a pass
    [6.99, 6, 'yellow'],
    [6.06, 6, 'yellow'],
    [6.0, 6, 'yellow'],
    [5.0, 6, 'yellow'],     // exactly one point below is still close
    [4.99, 6, 'red'],
    [-3, 6, 'red'],
  ])('IRR %s against %s%% is %s', (irr, rate, light) => {
    expect(classifyAgainstOpportunityCost(irr, rate).light).toBe(light);
  });

  it('says in words how far the deal is from the opportunity cost', () => {
    const y = classifyAgainstOpportunityCost(6.06, 6);
    expect(y.spreadPoints).toBeCloseTo(0.06, 6);
    expect(y.headline).toContain('6.06% annualized IRR');
    expect(y.headline).toContain('6.0% opportunity cost');
    expect(classifyAgainstOpportunityCost(3, 6).headline).toContain('below');
  });

  it('refuses to guess when a figure is missing', () => {
    expect(() => classifyAgainstOpportunityCost(NaN, 6)).toThrow();
    expect(() => classifyAgainstOpportunityCost(6, NaN)).toThrow();
  });

  it('honors a different band when one is given', () => {
    expect(classifyAgainstOpportunityCost(5.2, 6, 0.5).light).toBe('red');
    expect(classifyAgainstOpportunityCost(6.5, 6, 0.5).light).toBe('green');
  });
});

describe('classifyNapkin (does it make money?)', () => {
  const v = (yieldOnCostPct: number | null, dscr: number | null, over: Record<string, number> = {}) =>
    classifyNapkin({ yieldOnCostPct, opportunityCost: 6, dscr, minDscr: 1.25, ...over });

  it('follows the yield against the opportunity cost when the loan is covered', () => {
    expect(v(8, 1.6).light).toBe('green');
    expect(v(6.5, 1.6).light).toBe('yellow');
    expect(v(4.5, 1.6).light).toBe('red');
    expect(v(8, null).light).toBe('green'); // no debt: nothing to cover
  });

  it('is red when the income does not cover the loan, whatever the yield', () => {
    const r = v(9, 0.84);
    expect(r.light).toBe('red');
    expect(r.cap).toBe('does-not-cover-loan');
    expect(r.headline).toContain('0.84x of the loan payment');
  });

  it('cannot be green when the loan is covered below the lender minimum', () => {
    const r = v(8, 1.1);
    expect(r.light).toBe('yellow');
    expect(r.cap).toBe('below-minimum');
    expect(r.headline).toContain('below the 1.25x');
    expect(v(6.2, 1.1).cap).toBe('none'); // already yellow: nothing was capped
  });

  it('describes the 5.64% yield against 6.0% with a 0.84x loan cover as not making money', () => {
    const r = v(5.64, 0.84);
    expect(r.verdict).toBe('Does not make money');
    expect(r.headline).toContain('5.64% yield');
  });

  it('refuses to guess without a yield', () => {
    expect(() => v(null, 1.5)).toThrow();
  });
});
