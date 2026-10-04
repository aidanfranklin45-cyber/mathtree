import { describe, it, expect } from 'vitest';
import { assetGroupOf, compareToBenchmark, geographyOf, lookupBenchmark } from './lookup';
import { checkPlausibility } from './plausibility';

describe('geographyOf', () => {
  it('reads state and county from parcels or the location string', () => {
    expect(geographyOf({ location: 'x', inputs: { parcels: [{ state: 'WA', county: 'Spokane' }] } })).toEqual({ state: 'WA', county: 'Spokane' });
    expect(geographyOf({ location: '2820 FRUITVALE BLVD, YAKIMA, WA 98902', inputs: { county: 'Yakima County, WA' } })).toEqual({ state: 'WA', county: 'Yakima' });
    expect(geographyOf({ location: 'Somewhere', inputs: {} })).toBeNull();
  });
});

describe('lookupBenchmark', () => {
  it('returns the latest dated fact with its source', () => {
    const r = lookupBenchmark('rental_vacancy_pct', { state: 'WA' });
    expect(r.kind === 'fact' && r.fact).toMatchObject({ period: '2025', value: 6.6 });
  });
  it('does not substitute the state value for a county', () => {
    expect(lookupBenchmark('rental_vacancy_pct', { state: 'WA', county: 'Spokane' }).kind).toBe('not_loaded');
  });
  it('reports a gap instead of inventing commercial figures', () => {
    expect(lookupBenchmark('cap_rate_pct', { state: 'WA' }).kind).toBe('gap');
  });
});

describe('compareToBenchmark', () => {
  it('gives the difference in points only', () => {
    expect(compareToBenchmark('rental_vacancy_pct', 5, { state: 'WA' })).toMatchObject({ status: 'compared', diffPoints: -1.6 });
    expect(compareToBenchmark('cap_rate_pct', 6.5, { state: 'WA' }).status).toBe('no_benchmark');
  });
});

describe('checkPlausibility', () => {
  it('flags unit slips and impossible values', () => {
    expect(checkPlausibility('cap_rate_pct', 6.5).level).toBe('ok');
    expect(checkPlausibility('cap_rate_pct', 0.065).level).toBe('invalid');
    expect(checkPlausibility('cap_rate_pct', 650).level).toBe('invalid');
    expect(checkPlausibility('vacancy_pct', 55).level).toBe('warn');
    expect(checkPlausibility('vacancy_pct', NaN).level).toBe('invalid');
  });
  it('asset groups', () => {
    expect(assetGroupOf('multi-unit')).toBe('residential');
    expect(assetGroupOf('commercial')).toBe('commercial');
  });
});
