import { describe, it, expect } from 'vitest';
import { classifyAgainstTargetRate, classifyNapkin, STOPLIGHT_BAND_POINTS, STOPLIGHT_RED_POINTS, SEVERE_COVERAGE_FLOOR } from './stoplight';

describe('the starting thresholds', () => {
  it('are green 1 point above target, red more than 3 below, and coverage under 0.80x', () => {
    expect(STOPLIGHT_BAND_POINTS).toBe(1);
    expect(STOPLIGHT_RED_POINTS).toBe(3);
    expect(SEVERE_COVERAGE_FLOOR).toBe(0.8);
  });
});

describe('classifyAgainstTargetRate (the 10-year IRR)', () => {
  it.each([
    [8.0, 6, 'green'],
    [7.0, 6, 'green'],      // exactly one point above is a pass
    [6.99, 6, 'yellow'],
    [6.0, 6, 'yellow'],
    [5.0, 6, 'yellow'],
    [4.2, 6, 'yellow'],     // 1.8 below used to be red; now it is close enough
    [3.0, 6, 'yellow'],     // exactly three below is still yellow
    [2.99, 6, 'red'],
    [-3, 6, 'red'],
  ])('IRR %s against a %s%% target is %s', (irr, rate, light) => {
    expect(classifyAgainstTargetRate(irr, rate).light).toBe(light);
  });

  it('says in words how far the deal is from the target rate', () => {
    const y = classifyAgainstTargetRate(6.06, 6);
    expect(y.spreadPoints).toBeCloseTo(0.06, 6);
    expect(y.headline).toContain('6.06% annualized IRR');
    expect(y.headline).toContain('6.0% target rate');
    expect(classifyAgainstTargetRate(1, 6).headline).toContain('below');
    expect(classifyAgainstTargetRate(6, 6).verdict).toBe('Projected close to your target rate');
  });

  it('refuses to guess when a figure is missing', () => {
    expect(() => classifyAgainstTargetRate(NaN, 6)).toThrow();
    expect(() => classifyAgainstTargetRate(6, NaN)).toThrow();
  });

  it('honors the investor\'s own thresholds', () => {
    expect(classifyAgainstTargetRate(5.2, 6, 0.5, 0.5).light).toBe('red');   // strict: red beyond half a point
    expect(classifyAgainstTargetRate(6.5, 6, 0.5, 0.5).light).toBe('green');
    expect(classifyAgainstTargetRate(1, 6, 1, 8).light).toBe('yellow');       // lenient: red only beyond eight points
  });
});

describe('classifyNapkin (is it projected to be profitable?)', () => {
  const v = (yieldOnCostPct: number | null, dscr: number | null, over: Record<string, number> = {}) =>
    classifyNapkin({ yieldOnCostPct, targetRate: 6, dscr, minDscr: 1.25, ...over });

  it('follows the yield against the target rate when the loan is covered', () => {
    expect(v(8, 1.6).light).toBe('green');
    expect(v(6.5, 1.6).light).toBe('yellow');
    expect(v(3.5, 1.6).light).toBe('yellow');   // 2.5 below: close enough to be yellow
    expect(v(2.5, 1.6).light).toBe('red');      // 3.5 below: clearly short
    expect(v(8, null).light).toBe('green');     // no debt: nothing to cover
  });

  it('is yellow, not red, when the income falls short of the loan payment but the yield is in range', () => {
    const r = v(5.64, 0.84, { cashFlow: -2760 });
    expect(r.light).toBe('yellow');
    expect(r.cap).toBe('does-not-cover-loan');
    expect(r.verdict).toBe('Projected to be marginal');
    expect(r.headline).toContain('0.84x of the loan payment');
    expect(r.headline).toContain('about $2,760 a year would have to come from you');
  });

  it('is red when income pays under the coverage floor, whatever the yield', () => {
    const r = v(9, 0.7, { cashFlow: -9000 });
    expect(r.light).toBe('red');
    expect(r.cap).toBe('severe-shortfall');
    expect(r.verdict).toBe('Not projected to be profitable');
    expect(v(9, 0.8).light).toBe('yellow');    // exactly at the floor is not under it
  });

  it('moves the floor with the investor\'s setting', () => {
    expect(v(9, 0.84, { coverageFloor: 0.9 }).light).toBe('red');
    expect(v(9, 0.6, { coverageFloor: 0.5 }).light).toBe('yellow');
  });

  it('cannot be green when the loan is covered below the lender minimum', () => {
    const r = v(8, 1.1);
    expect(r.light).toBe('yellow');
    expect(r.cap).toBe('below-minimum');
    expect(r.headline).toContain('below the 1.25x');
    expect(v(6.2, 1.1).cap).toBe('none'); // already yellow: nothing was capped
  });

  it('stays red when the yield is clearly short, even if the loan is covered', () => {
    expect(v(1.5, 1.4).light).toBe('red');
  });

  it('refuses to guess without a yield', () => {
    expect(() => v(null, 1.5)).toThrow();
  });
});
