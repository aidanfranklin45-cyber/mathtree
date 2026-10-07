import { describe, it, expect } from 'vitest';
import { AddressService } from '../../src/lib/services/addressService';

/**
 * Live multi-county GIS integration suite.
 * Queries live county GIS endpoints to verify online availability and schema stability.
 * Safe to run on-demand; does not write any state to Supabase.
 */
describe('Live County GIS Integration Suite (On-Demand)', () => {
  it('queries Spokane County SCOUT MapServer and retrieves real owner data', async () => {
    // 1111 W Wellesley Ave, Spokane, WA
    const apn = '35062.4517';
    const result = await AddressService.fetchSpokaneAssessorData(apn);

    expect(result).toBeTruthy();
    expect(result?.apn).toBe(apn);
    expect(result?.isSpokaneCounty).toBe(true);
    expect(result?.owner).not.toBe('Owner of Record');
    expect(result?.owner).toBe('11.2 KM PER SEC LLC');
    expect(Number(result?.totalAssessedValue)).toBeGreaterThan(0);
    expect(Number(result?.marketLandValue)).toBeGreaterThan(0);
    expect(result?.assessorPortalUrl).toContain('350624517');
  }, 15000);

  it('queries King County GIS FeatureServer and retrieves Seattle parcel details', async () => {
    // Hampton Inn - SLU / 700 5th Ave N, Seattle, WA
    const apn = '5458300285';
    const result = await AddressService.fetchKingAssessorData(apn);

    expect(result).toBeTruthy();
    expect(result?.apn).toBe(apn);
    expect(result?.isKingCounty).toBe(true);
    expect(result?.owner).toContain('HAMPTON INN');
    expect(Number(result?.totalAssessedValue)).toBeGreaterThan(0);
    expect(Number(result?.marketLandValue)).toBeGreaterThan(0);
    expect(result?.taxCodeArea).toBe('0010');
    expect(result?.assessorPortalUrl).toContain('5458300285');
  }, 15000);

  it('queries King County GIS by address and accurately resolves Kirkland City Hall', async () => {
    const searchRes = await AddressService.searchKingAddresses('123 5th Ave, Kirkland, WA', 3);
    expect(searchRes.length).toBeGreaterThan(0);

    const first = searchRes[0];
    expect(first.city?.toUpperCase()).toBe('KIRKLAND');
    expect(first.owner).toContain('KIRKLAND CITY HALL');
    expect(first.apn).toBe('3885808355');
  }, 15000);

  it('queries Pierce County GIS FeatureServer and retrieves Tacoma commercial parcel details', async () => {
    // W.R. Rust Building / 950 Pacific Ave, Tacoma, WA
    const apn = '2009040130';
    const result = await AddressService.fetchPierceAssessorData(apn);

    expect(result).toBeTruthy();
    expect(result?.apn).toBe(apn);
    expect(result?.isPierceCounty).toBe(true);
    expect(result?.owner).toBe('W.R. RUST BUILDING');
    expect(Number(result?.totalAssessedValue)).toBeGreaterThan(0);
    expect(Number(result?.acres)).toBeGreaterThan(0);
    expect(result?.taxCodeArea).toBe('005');
  }, 15000);

  it('queries Yakima County Assessor Taxlots and retrieves government building details', async () => {
    // Yakima County Facilities / 128 N 2nd St, Yakima, WA
    const apn = '19131922484';
    const result = await AddressService.fetchYakimaAssessorData(apn);

    expect(result).toBeTruthy();
    expect(result?.apn).toBe(apn);
    expect(result?.isYakimaCounty).toBe(true);
    expect(result?.owner).toContain('PUBLIC SERVICES');
    expect(Number(result?.totalAssessedValue)).toBeGreaterThan(0);
    expect(Number(result?.acres)).toBeGreaterThan(0);
  }, 15000);

  it('resolves parcel details dynamically across counties via resolveParcelDetails', async () => {
    const spokane = await AddressService.resolveParcelDetails({ apn: '35062.4517', county: 'Spokane' });
    const king = await AddressService.resolveParcelDetails({ apn: '5458300285', county: 'King' });
    const pierce = await AddressService.resolveParcelDetails({ apn: '2009040130', county: 'Pierce' });
    const yakima = await AddressService.resolveParcelDetails({ apn: '19131922484', county: 'Yakima' });

    expect(spokane?.isSpokaneCounty).toBe(true);
    expect(king?.isKingCounty).toBe(true);
    expect(pierce?.isPierceCounty).toBe(true);
    expect(yakima?.isYakimaCounty).toBe(true);
  }, 20000);
});
