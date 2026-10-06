import { describe, it, expect } from 'vitest';
import { countyFromText, isRealParcel, pickPropertyResult, streetOf } from './parcelLookup';
import { collapseUnits } from './addressText';

describe('streetOf', () => {
  it('keeps the street line only, without unit, city or zip', () => {
    expect(streetOf('5101 W Powerhouse Rd #12, Yakima, WA 98908')).toBe('5101 W POWERHOUSE RD');
    expect(streetOf('5101 West Powerhouse Road Apt 4B, Yakima')).toBe('5101 W POWERHOUSE RD');
    expect(streetOf('5101 W. Powerhouse Rd., Yakima')).toBe('5101 W POWERHOUSE RD');
  });
});

describe('pickPropertyResult', () => {
  const results = [
    { formattedAddress: '5101 W Powerhouse Rd #12, Yakima, WA' },
    { formattedAddress: '5101 W Powerhouse Rd, Yakima, WA' },
    { formattedAddress: '5101 W Powerhouse Rd #3, Yakima, WA' },
    { formattedAddress: '5105 W Powerhouse Rd, Yakima, WA' },
  ];
  it('prefers the line without a unit for the same street address', () => {
    expect(pickPropertyResult(results, '5101 W Powerhouse Rd, Yakima')).toBe(results[1]);
  });
  it('falls back to a unit line of the same street when there is no plain one', () => {
    expect(pickPropertyResult([results[0], results[3]], '5101 W Powerhouse Rd')).toBe(results[0]);
  });
  it('never uses a different street number', () => {
    expect(pickPropertyResult([results[3]], '5101 W Powerhouse Rd')).toBeNull();
    expect(pickPropertyResult([], '5101 W Powerhouse Rd')).toBeNull();
  });
});

describe('isRealParcel', () => {
  it('needs county figures, not a placeholder', () => {
    expect(isRealParcel(null)).toBe(false);
    expect(isRealParcel({ owner: 'Owner of Record', zoning: 'Standard Municipal / Commercial' })).toBe(false);
    expect(isRealParcel({ totalAssessedValue: 12_500_000 })).toBe(true);
    expect(isRealParcel({ acres: 4.2 })).toBe(true);
  });
});

describe('countyFromText', () => {
  it('tells the county from the address, and does not guess', () => {
    expect(countyFromText('1 Main St, Spokane, WA')).toBe('Spokane');
    expect(countyFromText('5101 W Powerhouse Rd, Yakima, WA')).toBe('Yakima');
    expect(countyFromText('12 Oak St, Seattle, WA')).toBeNull();
  });
});

describe('collapseUnits', () => {
  const list = [
    { street: '5101 POWERHOUSE RD #39', formattedAddress: '5101 POWERHOUSE RD #39, YAKIMA, WA 98908', apn: '1' },
    { street: '5101 POWERHOUSE RD #40', formattedAddress: '5101 POWERHOUSE RD #40, YAKIMA, WA 98908', apn: '1' },
    { street: '5103 POWERHOUSE RD #1', formattedAddress: '5103 POWERHOUSE RD #1, YAKIMA, WA 98908', apn: '2' },
    { street: '5103 POWERHOUSE RD', formattedAddress: '5103 POWERHOUSE RD, YAKIMA, WA 98908', apn: '2' },
  ];
  it('shows one entry per property, without its unit', () => {
    const out = collapseUnits(list);
    expect(out.map((r) => r.formattedAddress)).toEqual(['5101 POWERHOUSE RD, YAKIMA, WA 98908', '5103 POWERHOUSE RD, YAKIMA, WA 98908']);
  });
  it('respects a limit on properties, not units', () => {
    expect(collapseUnits(list, 1)).toHaveLength(1);
  });
});
