/** Parsing for the free-typed fields in the recovery form, so people can type "10/15/2026" or "25%" instead of fighting a picker. */

const pad = (n: number) => String(n).padStart(2, '0');

/** Real calendar date check (rejects 02/30). Returns YYYY-MM-DD or null. */
const iso = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Accepts YYYY-MM-DD, M/D/YYYY, M-D-YYYY, M.D.YYYY and M/D/YY (20YY). Returns YYYY-MM-DD, or null when it isn't a real date. */
export function parseDateInput(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}

/** YYYY-MM-DD -> MM/DD/YYYY for display in the form. */
export const formatDateInput = (isoDate: string): string => {
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
};

/** Blank -> null (not set). "25", "25%", "12.5" -> number. Anything else, or outside 0-100 -> NaN so the caller can show an error. */
export function parsePercentInput(raw: string): number | null {
  const s = raw.trim().replace(/%$/, '').trim();
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return NaN;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : NaN;
}
