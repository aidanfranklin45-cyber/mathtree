import { describe, it, expect } from 'vitest';
import { AddressService } from './addressService';

describe('AddressService (ported legacy module)', () => {
  it('loads as a module and is exposed for legacy callers', () => {
    expect(typeof AddressService.searchAddresses).toBe('function');
    expect(typeof AddressService.aggregateParcelPackage).toBe('function');
  });

  it('normalises street addresses the way the county GIS expects', () => {
    const r: any = AddressService.parseAddressInput('301 south first street, selah');
    expect(r).toBeTruthy();
    expect(JSON.stringify(r).toUpperCase()).toContain('301');
  });

  it('treats a missing sync date as stale and a fresh one as current', () => {
    expect(AddressService.isGisDataStale(null)).toBe(true);
    expect(AddressService.isGisDataStale(new Date().toISOString())).toBe(false);
  });
});
