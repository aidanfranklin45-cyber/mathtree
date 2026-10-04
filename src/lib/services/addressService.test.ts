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

describe('same-owner companion parcel rule', () => {
  it('matches the same owner regardless of order, punctuation and entity suffix', () => {
    expect(AddressService.ownersMatch('SMITH JOHN', 'John Smith')).toBe(true);
    expect(AddressService.ownersMatch('Acme Holdings LLC', 'ACME HOLDINGS, INC.')).toBe(true);
    expect(AddressService.ownersMatch('John Smith / Acme Holdings LLC', 'Acme Holdings')).toBe(true);
  });

  it('rejects different owners, including ones that share a first word', () => {
    expect(AddressService.ownersMatch('Acme Holdings LLC', 'Acme Storage LLC')).toBe(false);
    expect(AddressService.ownersMatch('John Smith', 'John Smithson')).toBe(false);
  });

  it('never matches placeholder or empty owners', () => {
    expect(AddressService.ownersMatch('Owner of Record', 'Owner of Record')).toBe(false);
    expect(AddressService.ownersMatch('', 'Acme')).toBe(false);
  });

  it('attaches nothing when the owner is unknown or the county has no owner data', async () => {
    expect(await AddressService.detectNearbySameOwnerParcels('18130211474', 'Owner of Record', undefined)).toEqual([]);
    expect(await AddressService.detectNearbySameOwnerParcels('12345.0001', 'Acme LLC', { isSpokaneCounty: true })).toEqual([]);
  });
});

describe('address search SQL safety', () => {
  it('escapes apostrophes so a street like O\'Brien does not break the GIS where clause', async () => {
    const wheres: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      wheres.push(decodeURIComponent(String(url).split('where=')[1]?.split('&')[0] || '').replace(/\+/g, ' '));
      return { ok: true, json: async () => ({ features: [] }) } as any;
    }) as any;
    try {
      await (AddressService as any).searchAddresses("12 O'Brien St, Yakima");
    } catch { /* network paths past the first layer are irrelevant here */ }
    globalThis.fetch = orig;
    const withQuote = wheres.filter((w) => w.includes("O'BRIEN") || w.includes("O'Brien"));
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of withQuote) expect(w).toContain("O''");
  });
});
