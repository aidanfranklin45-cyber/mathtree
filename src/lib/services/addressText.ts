/**
 * Plain address text helpers (no network), shared by the address search and the parcel lookup. The county's address search returns every
 * apartment and unit at a street number; a property is the street address with the unit taken off.
 */

const UNIT = /(#\s*[A-Z0-9-]+|\b(APT|APARTMENT|SUITE|STE|UNIT|BLDG|BUILDING|SPACE|SPC|RM|ROOM|LOT)\b\.?\s*#?\s*[A-Z0-9-]+)/gi;
const ABBREV: Array<[RegExp, string]> = [
  [/\bROAD\b/g, 'RD'], [/\bSTREET\b/g, 'ST'], [/\bAVENUE\b/g, 'AVE'], [/\bDRIVE\b/g, 'DR'], [/\bLANE\b/g, 'LN'], [/\bBOULEVARD\b/g, 'BLVD'],
  [/\bCOURT\b/g, 'CT'], [/\bPLACE\b/g, 'PL'], [/\bPARKWAY\b/g, 'PKWY'], [/\bHIGHWAY\b/g, 'HWY'],
  [/\bWEST\b/g, 'W'], [/\bEAST\b/g, 'E'], [/\bNORTH\b/g, 'N'], [/\bSOUTH\b/g, 'S'],
];

/** The street line only, upper case, without city or zip, without any unit, with the usual abbreviations: "5101 W POWERHOUSE RD". */
export function streetOf(address: string): string {
  let t = String(address ?? '').split(',')[0].toUpperCase();
  t = t.replace(UNIT, ' ').replace(/[.]/g, ' ');
  for (const [re, to] of ABBREV) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

/** Whether the street line of an address names a unit ("#12", "Apt 4B"). */
export const hasUnit = (address: string): boolean => new RegExp(UNIT.source, 'i').test(String(address ?? '').split(',')[0]);

/** The address as written, with the unit taken off the street line ("5101 Powerhouse Rd #39, Yakima" becomes "5101 Powerhouse Rd, Yakima"). */
export function withoutUnit(address: string): string {
  const parts = String(address ?? '').split(',');
  parts[0] = parts[0].replace(UNIT, ' ').replace(/\s+/g, ' ').trim();
  return parts.map((p, i) => (i === 0 ? p : p.trim())).join(', ');
}

/**
 * One entry per property. Results that differ only by unit collapse into one: the unit-less line when the list has it, else the first, shown
 * without its unit. The first result of each property keeps its place, so the order the county gave is kept.
 */
export function collapseUnits<T extends { street?: string; formattedAddress?: string }>(results: T[], limit = Infinity): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const r of results) {
    const key = streetOf(r.formattedAddress || r.street || '') || (r.formattedAddress || r.street || '').toUpperCase();
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(r);
  }
  return order.slice(0, limit).map((key) => {
    const list = groups.get(key)!;
    const plain = list.find((r) => !hasUnit(r.formattedAddress || r.street || ''));
    if (plain) return plain;
    const first = list[0];
    return {
      ...first,
      ...(first.formattedAddress !== undefined ? { formattedAddress: withoutUnit(first.formattedAddress) } : {}),
      ...(first.street !== undefined ? { street: withoutUnit(first.street) } : {}),
    };
  });
}

/**
 * A property listed under several street numbers ("1403-1407 S 18th Ave", "1403, 1405 & 1407 S 18th Ave") becomes one address per number, so
 * each can be looked up on its own. A range steps by two when both ends are on the same side of the street. An address that is not a range or
 * a list comes back as it is, and so does a range too wide to be one building group.
 */
export function expandAddressRange(address: string): string[] {
  const text = String(address ?? '');
  const range = /^\s*(\d+)\s*(?:[-\u2010-\u2015]|to)\s*(\d+)\s+([^,]+?)(\s*,.*)?$/i.exec(text);
  if (range) {
    const a = Number(range[1]); const b = Number(range[2]);
    const step = (b - a) % 2 === 0 ? 2 : 1;
    const count = Math.floor((b - a) / step) + 1;
    if (b > a && count <= 12) {
      return Array.from({ length: count }, (_, i) => `${a + i * step} ${range[3].trim()}${range[4] ?? ''}`);
    }
    return [text];
  }
  const list = /^\s*(\d+(?:\s*(?:,|&|and)\s*\d+)+)\s+([^,]+?)(\s*,.*)?$/i.exec(text);
  if (list) {
    const numbers = list[1].split(/\s*(?:,|&|and)\s*/i).filter(Boolean);
    if (numbers.length <= 12) return numbers.map((n) => `${n} ${list[2].trim()}${list[3] ?? ''}`);
  }
  return [text];
}
