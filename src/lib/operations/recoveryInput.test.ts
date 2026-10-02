import { describe, it, expect } from 'vitest';
import { parseDateInput, formatDateInput, parsePercentInput } from './recoveryInput';

describe('parseDateInput', () => {
  it('accepts the formats people actually type', () => {
    expect(parseDateInput('10/15/2026')).toBe('2026-10-15');
    expect(parseDateInput('1/5/2027')).toBe('2027-01-05');
    expect(parseDateInput('2026-10-15')).toBe('2026-10-15');
    expect(parseDateInput('10-15-2026')).toBe('2026-10-15');
    expect(parseDateInput(' 10/15/26 ')).toBe('2026-10-15');
  });
  it('rejects non-dates and impossible dates', () => {
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput('soon')).toBeNull();
    expect(parseDateInput('02/30/2026')).toBeNull();
    expect(parseDateInput('13/01/2026')).toBeNull();
  });
  it('accepts Feb 29 only in leap years', () => {
    expect(parseDateInput('02/29/2028')).toBe('2028-02-29');
    expect(parseDateInput('02/29/2027')).toBeNull();
  });
  it('round-trips through the display format', () => {
    expect(formatDateInput('2026-08-02')).toBe('08/02/2026');
    expect(parseDateInput(formatDateInput('2026-08-02'))).toBe('2026-08-02');
  });
});

describe('parsePercentInput', () => {
  it('parses typed percentages, with or without a % sign', () => {
    expect(parsePercentInput('25')).toBe(25);
    expect(parsePercentInput('25%')).toBe(25);
    expect(parsePercentInput(' 12.5 % ')).toBe(12.5);
    expect(parsePercentInput('.5')).toBe(0.5);
    expect(parsePercentInput('0')).toBe(0);
    expect(parsePercentInput('100')).toBe(100);
  });
  it('treats blank as not set', () => {
    expect(parsePercentInput('')).toBeNull();
    expect(parsePercentInput('  ')).toBeNull();
  });
  it('flags invalid or out-of-range input', () => {
    expect(parsePercentInput('abc')).toBeNaN();
    expect(parsePercentInput('101')).toBeNaN();
    expect(parsePercentInput('-5')).toBeNaN();
    expect(parsePercentInput('1,5')).toBeNaN();
  });
});
