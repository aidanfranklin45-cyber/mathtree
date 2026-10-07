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

describe('Spokane County Assessor mapping', () => {
  it('maps real owner and taxpayer names from SCOUT records instead of placeholder', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('SCOUTSimple')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                PID_NUM: '01014.9005',
                owner_name: 'HARRIS, ROBERT W / JOHN M',
                taxpayer_name: 'HARRIS, ROBERT W & JOHN M',
                owner_address1: '36309 S MULLINIX RD',
                owner_city: 'CHENEY',
                owner_state: 'WA',
                owner_zip: '99004',
                site_address: '36603 S MULLINIX RD',
                site_city: 'CHENEY',
                land_value: 150550,
                acreage: 136.86,
                prop_use_desc: 'Cur - Use - Ag'
              }
            }]
          })
        } as any;
      }
      if (u.includes('Parcels/FeatureServer')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                PID_NUM: '01014.9005',
                assessed_amt: 32480,
                taxable_amt: 32480,
                tax_code_area: '1880',
                prop_use_code: '83'
              }
            }]
          })
        } as any;
      }
      return { ok: true, json: async () => ({ features: [] }) } as any;
    }) as any;

    try {
      const result: any = await (AddressService as any).fetchSpokaneAssessorData('01014.9005');
      expect(result).toBeTruthy();
      expect(result.owner).toBe('HARRIS, ROBERT W / JOHN M');
      expect(result.taxpayer).toBe('HARRIS, ROBERT W & JOHN M');
      expect(result.ownerAddress).toBe('36309 S MULLINIX RD, CHENEY, WA, 99004');
      expect(result.totalAssessedValue).toBe(32480);
      expect(result.marketLandValue).toBe(150550);
      expect(result.taxCodeArea).toBe('1880');
      expect(result.isSpokaneCounty).toBe(true);
      expect(result.assessorPortalUrl).toContain('010149005');
    } finally {
      globalThis.fetch = orig;
    }
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

describe('King County Assessor mapping', () => {
  it('maps PIN, property name, appraised values, and levy code from King parcel records', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('Ej0PsM5Aw677QF1W')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                PIN: '0924049001',
                PROP_NAME: 'NORTHWEST MEDICAL TOWER',
                ADDR_FULL: '1201 3RD AVE',
                CTYNAME: 'SEATTLE',
                ZIP5: '98101',
                APPRLNDVAL: 8500000,
                APPR_IMPR: 42000000,
                LEVYCODE: '0010',
                KCA_ZONING: 'DOC2 500/300-500',
                PREUSE_DESC: 'Commercial / Office',
                KCTP_ADDR: 'PO BOX 123, SEATTLE, WA 98101',
                LOTSQFT: 45000,
              }
            }]
          })
        } as any;
      }
      return { ok: true, json: async () => ({ features: [] }) } as any;
    }) as any;

    try {
      const result: any = await (AddressService as any).fetchKingAssessorData('0924049001');
      expect(result).toBeTruthy();
      expect(result.apn).toBe('0924049001');
      expect(result.owner).toBe('NORTHWEST MEDICAL TOWER');
      expect(result.address).toBe('1201 3RD AVE, SEATTLE, WA 98101');
      expect(result.marketLandValue).toBe(8500000);
      expect(result.marketImprovementValue).toBe(42000000);
      expect(result.totalAssessedValue).toBe(50500000);
      expect(result.taxCodeArea).toBe('0010');
      expect(result.zoning).toBe('DOC2 500/300-500');
      expect(result.sqft).toBe(45000);
      expect(result.isKingCounty).toBe(true);
      expect(result.assessorPortalUrl).toContain('0924049001');
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('Pierce County Assessor mapping', () => {
  it('maps TaxParcelNumber, business name, appraised values, and tax area code from Pierce records', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('1UvBaQ5y1ubjUPmd')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                TaxParcelNumber: '0320141020',
                Business_Name: 'PACIFIC SOUND HOLDINGS LLC',
                Site_Address: '950 PACIFIC AVE',
                City_State: 'TACOMA WA',
                Zipcode: '98402',
                Land_Value: 3200000,
                Improvement_Value: 15400000,
                Taxable_Value: 18600000,
                Tax_Area_Code: '005',
                Landuse_Description: 'Commercial Retail / Office',
                Land_Gross_Acres: 2.15,
              }
            }]
          })
        } as any;
      }
      return { ok: true, json: async () => ({ features: [] }) } as any;
    }) as any;

    try {
      const result: any = await (AddressService as any).fetchPierceAssessorData('0320141020');
      expect(result).toBeTruthy();
      expect(result.apn).toBe('0320141020');
      expect(result.owner).toBe('PACIFIC SOUND HOLDINGS LLC');
      expect(result.address).toBe('950 PACIFIC AVE, TACOMA, WA 98402');
      expect(result.marketLandValue).toBe(3200000);
      expect(result.marketImprovementValue).toBe(15400000);
      expect(result.totalAssessedValue).toBe(18600000);
      expect(result.taxCodeArea).toBe('005');
      expect(result.acres).toBe(2.15);
      expect(result.isPierceCounty).toBe(true);
      expect(result.assessorPortalUrl).toContain('0320141020');
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('resolveParcelDetails routing', () => {
  it('routes to King assessor for King county parcels', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('Ej0PsM5Aw677QF1W')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                PIN: '1234567890',
                PROP_NAME: 'BELLEVUE COMMONS',
                ADDR_FULL: '100 110TH AVE NE',
                CTYNAME: 'BELLEVUE',
                ZIP5: '98004',
                APPRLNDVAL: 5000000,
                APPR_IMPR: 10000000,
              }
            }]
          })
        } as any;
      }
      return { ok: true, json: async () => ({ features: [] }) } as any;
    }) as any;

    try {
      const result: any = await AddressService.resolveParcelDetails({ apn: '1234567890', county: 'King' });
      expect(result).toBeTruthy();
      expect(result.isKingCounty).toBe(true);
      expect(result.owner).toBe('BELLEVUE COMMONS');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('routes to Pierce assessor for Pierce county parcels', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('1UvBaQ5y1ubjUPmd')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                TaxParcelNumber: '9876543210',
                Business_Name: 'PUYALLUP LOGISTICS LLC',
                Site_Address: '110 9TH AVE SW',
                City_State: 'PUYALLUP WA',
                Zipcode: '98371',
                Land_Value: 2000000,
                Improvement_Value: 8000000,
                Taxable_Value: 10000000,
              }
            }]
          })
        } as any;
      }
      return { ok: true, json: async () => ({ features: [] }) } as any;
    }) as any;

    try {
      const result: any = await AddressService.resolveParcelDetails({ apn: '9876543210', county: 'Pierce' });
      expect(result).toBeTruthy();
      expect(result.isPierceCounty).toBe(true);
      expect(result.owner).toBe('PUYALLUP LOGISTICS LLC');
    } finally {
      globalThis.fetch = orig;
    }
  });
});


