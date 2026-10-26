import { describe, it, expect } from 'vitest';
import { classifyAgainstOpportunityCost } from './stoplight';

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
