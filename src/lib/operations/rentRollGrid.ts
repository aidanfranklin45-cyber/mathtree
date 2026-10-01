/**
 * The tenant-by-tenant rent roll: one row per unit or suite, with the tenant in it and what that tenant pays. Pure (no database, no UI) so
 * pasting from a spreadsheet, validating, and planning the writes can all be tested.
 *
 * Every tenant is its own lease row with its own rent and move-in date, because tenants in one building pay different amounts depending on
 * when they came in. A row with no tenant is a vacant unit (its rent column is the asking / market rent).
 */

export type Term = 'fixed' | 'month_to_month';

export interface GridRow {
  /** Stable client-side key for React. */
  key: string;
  /** Existing lease / unit this row edits; null for a new row. */
  leaseId: string | null;
  unitId: string | null;
  unit: string;
  /** Blank = vacant unit. */
  tenant: string;
  /** Monthly rent for a tenant; asking rent for a vacant unit. */
  rent: string;
  /** Move-in / lease start, YYYY-MM-DD. */
  start: string;
  /** Lease end, YYYY-MM-DD; blank for month to month. */
  end: string;
  term: Term;
  dueDay: string;
  /** Contractual yearly increase in %, blank = none. */
  annualPct: string;
  deposit: string;
  email: string;
  /** Row is being removed: its lease is closed (never deleted, the payment history stays). */
  remove?: boolean;
}

let counter = 0;
export const newKey = (): string => `r${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyRow = (over: Partial<GridRow> = {}): GridRow => ({
  key: newKey(), leaseId: null, unitId: null, unit: '', tenant: '', rent: '', start: '', end: '', term: 'fixed', dueDay: '1', annualPct: '', deposit: '', email: '', ...over,
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------------------

export function parseMoney(v: string): number | null {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s.replace(/^\((.*)\)$/, '-$1'));
  return isNaN(n) ? null : n;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const realDate = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Accepts YYYY-MM-DD, YYYY/M/D, M/D/YYYY, M/D/YY, "Jan 5, 2024" and "5 January 2024"; returns YYYY-MM-DD or null. */
export function parseDate(v: string): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return realDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return realDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  const monthNum = (name: string): number | undefined => MONTHS[name.slice(0, 3).toLowerCase()];
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && monthNum(m[1])) return realDate(+m[3], monthNum(m[1]) as number, +m[2]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m && monthNum(m[2])) return realDate(+m[3], monthNum(m[2]) as number, +m[1]);
  return null;
}

const MTM = /^(m\s*\/?\s*t\s*\/?\s*m|m2m|mtm|month[\s-]*to[\s-]*month|monthly|periodic)$/i;

/** One CSV/TSV line into cells (tabs from a spreadsheet, or commas with simple quoting). */
function splitLine(line: string, delim: string): string[] {
  if (delim === '\t') return line.split('\t').map((c) => c.trim());
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

type Field = 'unit' | 'tenant' | 'rent' | 'start' | 'end' | 'dueDay' | 'deposit' | 'email' | 'annualPct' | 'term';
const DEFAULT_ORDER: Field[] = ['unit', 'tenant', 'rent', 'start', 'end', 'dueDay', 'deposit', 'email', 'annualPct'];
const HEADERS: Array<[Field, RegExp]> = [
  ['unit', /^(unit|suite|apt|apartment|space|bay|room|unit\s*(#|no|number)|suite\s*(#|no|number))$/i],
  ['tenant', /^(tenant|tenant\s*name|name|resident|lessee|occupant)$/i],
  ['rent', /^(rent|monthly\s*rent|current\s*rent|rent\s*amount|amount|base\s*rent|market\s*rent|asking(\s*rent)?)$/i],
  ['start', /^(start|lease\s*start|move[\s-]*in|move[\s-]*in\s*date|commencement|start\s*date|lease\s*begin|since)$/i],
  ['end', /^(end|lease\s*end|expiration|expires|lease\s*expiration|end\s*date|expiry|lease\s*to)$/i],
  ['term', /^(term|lease\s*term|lease\s*type|tenancy)$/i],
  ['dueDay', /^(due|due\s*day|rent\s*due|due\s*date|day\s*due)$/i],
  ['deposit', /^(deposit|security\s*deposit|sec\s*dep)$/i],
  ['email', /^(email|e-mail|tenant\s*email)$/i],
  ['annualPct', /^(increase|annual\s*increase|escalation|annual\s*%|bump|annual\s*escalation|increase\s*%)$/i],
];

export interface ParsedRow extends Omit<GridRow, 'key' | 'leaseId' | 'unitId'> {}

/**
 * Turns text pasted from a spreadsheet into rows. A first line of column names is recognised (in any order); otherwise the columns are
 * Unit, Tenant, Rent, Start, End, Due day, Deposit, Email, Annual %. Dates may be typed any common way; "MTM" or "month to month" in the
 * End (or Term) column makes the lease month to month. Lines that are empty or unusable are reported, not silently dropped.
 */
export function parsePasted(text: string): { rows: ParsedRow[]; notes: string[] } {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  const notes: string[] = [];
  if (lines.length === 0) return { rows: [], notes };
  const delim = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  const cells = lines.map((l) => splitLine(l, delim));

  let order: Field[] = DEFAULT_ORDER;
  let body = cells;
  const first = cells[0].map((c) => c.trim());
  const mapped = first.map((c) => HEADERS.find(([, re]) => re.test(c))?.[0] ?? null);
  if (mapped.filter(Boolean).length >= 2) {
    order = mapped.map((f, i) => f ?? (`ignore${i}` as unknown as Field));
    body = cells.slice(1);
  }

  const rows: ParsedRow[] = [];
  body.forEach((c, idx) => {
    const get = (f: Field): string => {
      const i = order.indexOf(f);
      return i >= 0 ? (c[i] ?? '').trim() : '';
    };
    const unit = get('unit');
    const tenant = get('tenant');
    const rentRaw = get('rent');
    if (!unit && !tenant && !rentRaw) { notes.push(`Row ${idx + 1} was empty and skipped.`); return; }
    const endRaw = get('end');
    const termRaw = get('term');
    const m2m = MTM.test(endRaw) || MTM.test(termRaw);
    const startIso = parseDate(get('start'));
    const endIso = m2m ? '' : parseDate(endRaw);
    const rentNum = parseMoney(rentRaw);
    if (get('start') && !startIso) notes.push(`Row ${idx + 1}: could not read the start date "${get('start')}".`);
    if (endRaw && !m2m && !endIso) notes.push(`Row ${idx + 1}: could not read the end date "${endRaw}".`);
    if (rentRaw && rentNum === null) notes.push(`Row ${idx + 1}: could not read the rent "${rentRaw}".`);
    const pct = get('annualPct').replace(/%/g, '');
    rows.push({
      unit,
      tenant,
      rent: rentNum === null ? '' : String(rentNum),
      start: startIso ?? '',
      end: endIso ?? '',
      term: m2m || (!endRaw && /month/i.test(termRaw)) ? 'month_to_month' : 'fixed',
      dueDay: /^\d{1,2}$/.test(get('dueDay')) ? get('dueDay') : '1',
      annualPct: pct && !isNaN(Number(pct)) ? pct : '',
      deposit: parseMoney(get('deposit')) === null ? '' : String(parseMoney(get('deposit'))),
      email: get('email'),
    });
  });
  return { rows, notes };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------------------------

export interface RowIssue {
  key: string;
  field: keyof GridRow | 'row';
  message: string;
}

const isVacant = (r: GridRow): boolean => r.tenant.trim() === '';

export function validateGrid(rows: GridRow[]): RowIssue[] {
  const issues: RowIssue[] = [];
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.remove) continue;
    const add = (field: RowIssue['field'], message: string) => issues.push({ key: r.key, field, message });
    const unit = r.unit.trim();
    if (!unit) add('unit', 'Enter the unit or suite.');
    else {
      const k = unit.toLowerCase();
      if (seen.has(k)) add('unit', `"${unit}" appears twice. Each unit can have one tenant at a time.`);
      else seen.set(k, r.key);
    }
    const rent = parseMoney(r.rent);
    if (isVacant(r)) {
      if (r.rent.trim() !== '' && (rent === null || rent < 0)) add('rent', 'Asking rent must be a number.');
      continue; // a vacant unit needs nothing else
    }
    if (rent === null || rent < 0) add('rent', 'Enter the monthly rent.');
    if (!parseDate(r.start)) add('start', 'Enter the move-in or lease start date.');
    if (r.term === 'fixed') {
      const end = parseDate(r.end);
      if (!end) add('end', 'Enter the lease end date, or set the tenant to month to month.');
      else if (parseDate(r.start) && end < (parseDate(r.start) as string)) add('end', 'The lease ends before it starts.');
    }
    const due = Number(r.dueDay);
    if (!Number.isInteger(due) || due < 1 || due > 31) add('dueDay', 'Due day must be 1 to 31.');
    if (r.annualPct.trim() !== '') {
      const p = Number(r.annualPct);
      if (isNaN(p) || p < 0 || p > 25) add('annualPct', 'Yearly increase must be between 0 and 25%.');
    }
    if (r.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())) add('email', 'That does not look like an email address.');
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Planning the writes
// ---------------------------------------------------------------------------------------------------------------------------------

export interface UnitWrite {
  unitId: string | null;
  unit_number: string;
  unit_type: string;
  market_rent: number | null;
  status: 'occupied' | 'vacant';
  /** The grid row this unit belongs to, so the lease can be linked once the unit has an id. */
  rowKey: string;
}

export interface LeaseWrite {
  leaseId: string | null;
  rowKey: string;
  tenant_name: string;
  tenant_email: string | null;
  monthly_rent: number;
  security_deposit: number;
  lease_start_date: string;
  lease_end_date: string | null;
  term_type: Term;
  payment_due_day: number;
  grace_period_days: number;
  escalation_type: string | null;
  escalation_rate: number;
  escalation_frequency: string | null;
  next_escalation_date: string | null;
  lease_type: string | null;
  is_active: true;
}

export interface WritePlan {
  units: UnitWrite[];
  leases: LeaseWrite[];
  /** Existing leases to close (tenant moved out / row removed). Closed, never deleted: payment history stays. */
  deactivate: string[];
}

const addYears = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y + n, m - 1, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

/** The next anniversary of the start date that is after `today`. */
export function nextAnniversary(start: string, today: string): string {
  let n = 1;
  let next = addYears(start, n);
  while (next <= today && n < 100) { n += 1; next = addYears(start, n); }
  return next;
}

export interface PlanOptions {
  today: string;
  /** Default lease type for new leases (e.g. 'Gross' for residential, 'NNN' for commercial). */
  defaultLeaseType?: string | null;
  defaultUnitType?: string;
  /** Washington residential: no contractual yearly increase is scheduled (increases need written notice, decided one at a time). */
  noAutoIncrease?: boolean;
  defaultGraceDays?: number;
}

export function planWrites(rows: GridRow[], opts: PlanOptions): WritePlan {
  const plan: WritePlan = { units: [], leases: [], deactivate: [] };
  for (const r of rows) {
    if (r.remove) {
      if (r.leaseId) plan.deactivate.push(r.leaseId);
      continue;
    }
    const unit = r.unit.trim();
    const rent = parseMoney(r.rent);
    const vacant = isVacant(r);
    plan.units.push({
      unitId: r.unitId,
      unit_number: unit,
      unit_type: opts.defaultUnitType ?? 'Residential',
      market_rent: rent,
      status: vacant ? 'vacant' : 'occupied',
      rowKey: r.key,
    });
    if (vacant) {
      // A row that used to have a tenant and no longer does: close that lease
      if (r.leaseId) plan.deactivate.push(r.leaseId);
      continue;
    }
    const pct = r.annualPct.trim() === '' ? 0 : Number(r.annualPct);
    const increases = !opts.noAutoIncrease && r.term === 'fixed' && pct > 0;
    const start = parseDate(r.start) as string;
    plan.leases.push({
      leaseId: r.leaseId,
      rowKey: r.key,
      tenant_name: r.tenant.trim(),
      tenant_email: r.email.trim() || null,
      monthly_rent: rent ?? 0,
      security_deposit: parseMoney(r.deposit) ?? 0,
      lease_start_date: start,
      lease_end_date: r.term === 'month_to_month' ? null : parseDate(r.end),
      term_type: r.term,
      payment_due_day: Math.min(31, Math.max(1, Math.round(Number(r.dueDay) || 1))),
      grace_period_days: opts.defaultGraceDays ?? 5,
      escalation_type: increases ? 'Percentage Bump (%)' : null,
      escalation_rate: increases ? pct : 0,
      escalation_frequency: increases ? 'Annual on Anniversary' : null,
      next_escalation_date: increases ? nextAnniversary(start, opts.today) : null,
      lease_type: opts.defaultLeaseType ?? null,
      is_active: true,
    });
  }
  return plan;
}

/** Totals shown above the grid. */
export function summarizeGrid(rows: GridRow[]): { units: number; occupied: number; vacant: number; monthlyRent: number; annualRent: number; occupancyPct: number } {
  const live = rows.filter((r) => !r.remove && r.unit.trim() !== '');
  const occupied = live.filter((r) => !isVacant(r));
  const monthlyRent = occupied.reduce((s, r) => s + (parseMoney(r.rent) ?? 0), 0);
  return {
    units: live.length,
    occupied: occupied.length,
    vacant: live.length - occupied.length,
    monthlyRent,
    annualRent: monthlyRent * 12,
    occupancyPct: live.length > 0 ? Math.round((occupied.length / live.length) * 1000) / 10 : 0,
  };
}
