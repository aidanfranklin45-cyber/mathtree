/**
 * Finding the county parcel for a property when the owner has not picked an address from the search list. Used when a project is created.
 *
 * Two rules keep it honest:
 * 1. The county's address search returns every apartment and unit at a street number ("5101 W Powerhouse Rd #12" and so on). The property
 *    is the street address with those units taken off, so results are matched on the street alone and a unit-less match is preferred.
 *    A result for a different street number is never used: no match means no parcel, not a guess.
 * 2. The address service falls back to a placeholder record ("Owner of Record", "Standard Municipal / Commercial") when the county cannot
 *    be reached. That is not a parcel. Only a record with real county figures counts, so nothing is saved or labelled "verified" without them.
 */

import { AddressService } from './addressService';
import { expandAddressRange, hasUnit, streetOf } from './addressText';

export { streetOf };

/** A record from the county itself: it carries figures, not just an address. */
export function isRealParcel(data: any): boolean {
  return !!data && (Number(data.totalAssessedValue) > 0 || Number(data.acres) > 0 || Number(data.sqft) > 0 || Number(data.buildingSqFt) > 0 || Number(data.marketLandValue) > 0);
}

/** The county an address is in, when it can be told from the address itself; null otherwise (never a guess). */
export function countyFromText(text: string): 'Yakima' | 'Spokane' | null {
  if (/spokane/i.test(text)) return 'Spokane';
  if (/yakima|selah|union gap|sunnyside|grandview|toppenish|wapato|zillah|moxee|naches/i.test(text)) return 'Yakima';
  return null;
}

/** The one result that is the property itself: same street address, preferring the line without a unit. Null when nothing matches. */
export function pickPropertyResult<T extends { street?: string; formattedAddress?: string }>(results: T[], wanted: string): T | null {
  const want = streetOf(wanted);
  if (!want) return null;
  const same = results.filter((r) => streetOf(r.formattedAddress || r.street || '') === want || streetOf(r.street || '') === want);
  return same.find((r) => !hasUnit(r.formattedAddress || r.street || '')) ?? same[0] ?? null;
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

const digitsOf = (v: unknown): string => String(v ?? '').replace(/D/g, '');

/** The parcel for one street address: the property's own line (units taken off), looked up in the county's records. Null when none is real. */
async function parcelForAddress(address: string): Promise<any | null> {
  const service: any = AddressService;
  const results: any[] = (await withTimeout(service.searchAddresses(address), 12_000)) ?? [];
  const item = pickPropertyResult(results, address);
  if (!item) return null;
  const data = await withTimeout(service.resolveParcelDetails(item), 12_000);
  return isRealParcel(data) ? data : null;
}

/**
 * The parcels for a property: by the parcel number the documents gave when there is one, then by street address. A property listed under
 * several street numbers ("1403-1407 S 18th Ave") is looked up number by number. `primary` is the first parcel found; `others` are any
 * different parcels the other numbers lead to. Several numbers on one parcel are one parcel, not several. Never throws: a project is
 * created either way, and the deal page tries the county again later.
 */
export async function findParcels(args: { apn?: string | null; location?: string | null }): Promise<{ primary: any | null; others: any[]; method: 'apn' | 'address' | null; addressesChecked: string[] }> {
  const service: any = AddressService;
  const location = String(args.location ?? '').trim();
  const county = countyFromText(location);
  const found: any[] = [];
  let method: 'apn' | 'address' | null = null;
  let addressesChecked: string[] = [];
  const add = (d: any, how: 'apn' | 'address') => { if (d && !found.some((f) => digitsOf(f.apn) === digitsOf(d.apn))) { found.push(d); if (found.length === 1) method = how; } };
  try {
    const digits = digitsOf(args.apn);
    if (digits && county) {
      const byApn = await withTimeout(service.resolveParcelDetails({ apn: digits, county }), 12_000);
      if (isRealParcel(byApn)) add(byApn, 'apn');
    }
    if (location.length >= 6) {
      const addresses = expandAddressRange(location);
      addressesChecked = addresses;
      const results = await Promise.all(addresses.map((a) => parcelForAddress(a).catch(() => null)));
      results.forEach((d) => add(d, 'address'));
    }
  } catch (e) {
    console.warn('[parcelLookup] county lookup failed:', e);
  }
  return { primary: found[0] ?? null, others: found.slice(1), method, addressesChecked };
}

/** The first parcel found for a property, or null. */
export async function findParcel(args: { apn?: string | null; location?: string | null }): Promise<any | null> {
  return (await findParcels(args)).primary;
}
