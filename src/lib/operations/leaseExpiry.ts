/**
 * Lease-expiry ladder across tenants: how much rent (and space) rolls each year, plus the weighted-average lease term.
 * Pure functions only, derived on the fly from the lease rows the Operations page already has.
 *
 * Rules:
 * - Only leases in force today count (a lease that has not started yet would double-count the space).
 * - Month to month, or no end date at all, is its own bucket: it can end on notice at any time.
 * - An end date already past while the lease is still active is "holding over" and gets its own bucket.
 * - WALT (weighted-average lease term remaining) is weighted by monthly rent, and by square feet when every lease
 *   has a size. Month-to-month and holding-over leases count as zero years remaining.
 */

import type { Row } from './rentRoll';

export interface ExpiryLease {
  id: string;
  dealId: string;
  tenant: string;
  monthlyRent: number;
  sqft: number;
  endDate: string | null;
  yearsRemaining: number;
}

export interface ExpiryBucket {
  key: string;            // 'holdover' | 'mtm' | '2027' | 'later'
  label: string;
  leases: ExpiryLease[];
  monthlyRent: number;
  sqft: number;
  rentPct: number;        // share of in-force monthly rent, 0-100
  cumulativeRentPct: number;
}

export interface ExpiryLadder {
  buckets: ExpiryBucket[];
  leaseCount: number;
  monthlyRent: number;
  /** Rent-weighted average years remaining; null with no rent. */
  waltByRent: number | null;
  /** Area-weighted average years remaining; null unless every lease has a size. */
  waltBySqft: number | null;
  /** The next fixed-term expiry from today, if any. */
  nextExpiry: ExpiryLease | null;
}

const DAY_MS = 86400000;

const num = (v: unknown): number => {
  const p = parseFloat(String(v ?? ''));
  return isNaN(p) ? 0 : p;
};

/** 'YYYY-MM-DD' (or an ISO timestamp) as a local calendar date, so a lease never shifts a day by time zone. */
const parseDay = (v: unknown): Date | null => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export interface LadderOptions {
  today?: Date;
  /** Calendar years shown one by one, starting with this year; everything after is one "later" bucket. */
  years?: number;
  /** Square feet for a lease (unit size, or a derived lease's own size). Defaults to 0 (unknown). */
  sqftOf?: (lease: Row) => number;
}

export function buildExpiryLadder(leases: Row[], opts: LadderOptions = {}): ExpiryLadder {
  const today = startOfDay(opts.today ?? new Date());
  const years = Math.max(1, Math.floor(opts.years ?? 6));
  const sqftOf = opts.sqftOf ?? (() => 0);
  const thisYear = today.getFullYear();
  const lastListedYear = thisYear + years - 1;

  const inForce: Array<ExpiryLease & { kind: 'holdover' | 'mtm' | 'fixed'; endYear: number }> = [];
  for (const l of leases || []) {
    if (!l || l.is_active === false) continue;
    const start = parseDay(l.lease_start_date);
    if (start && start > today) continue;
    const end = l.term_type === 'month_to_month' ? null : parseDay(l.lease_end_date);
    const kind = !end ? 'mtm' : end < today ? 'holdover' : 'fixed';
    const yearsRemaining = kind === 'fixed' ? (end!.getTime() - today.getTime()) / DAY_MS / 365.25 : 0;
    inForce.push({
      id: String(l.id),
      dealId: String(l.deal_id),
      tenant: l.tenant_name || 'Tenant',
      monthlyRent: num(l.monthly_rent),
      sqft: Math.max(0, num(sqftOf(l))),
      endDate: end ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}` : null,
      yearsRemaining,
      kind,
      endYear: end ? end.getFullYear() : 0,
    });
  }

  const totalRent = inForce.reduce((s, l) => s + l.monthlyRent, 0);
  const strip = ({ kind: _k, endYear: _y, ...rest }: (typeof inForce)[number]): ExpiryLease => rest;

  const defs: Array<{ key: string; label: string; match: (l: (typeof inForce)[number]) => boolean }> = [
    { key: 'holdover', label: 'Past end date', match: (l) => l.kind === 'holdover' },
    { key: 'mtm', label: 'Month to month', match: (l) => l.kind === 'mtm' },
  ];
  for (let y = thisYear; y <= lastListedYear; y++) defs.push({ key: String(y), label: String(y), match: (l) => l.kind === 'fixed' && l.endYear === y });
  defs.push({ key: 'later', label: `${lastListedYear + 1}+`, match: (l) => l.kind === 'fixed' && l.endYear > lastListedYear });

  let cumulative = 0;
  const buckets: ExpiryBucket[] = defs.map(({ key, label, match }) => {
    const ls = inForce.filter(match).sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)) || b.monthlyRent - a.monthlyRent);
    const monthlyRent = ls.reduce((s, l) => s + l.monthlyRent, 0);
    const rentPct = totalRent > 0 ? (monthlyRent / totalRent) * 100 : 0;
    cumulative += rentPct;
    return { key, label, leases: ls.map(strip), monthlyRent, sqft: ls.reduce((s, l) => s + l.sqft, 0), rentPct, cumulativeRentPct: cumulative };
  })
    // Year rows always show so the ladder reads as a timeline; the two special buckets only when used
    .filter((b) => b.leases.length > 0 || /^\d{4}$/.test(b.key));

  const weighted = (w: (l: (typeof inForce)[number]) => number): number | null => {
    const total = inForce.reduce((s, l) => s + w(l), 0);
    return total > 0 ? inForce.reduce((s, l) => s + w(l) * l.yearsRemaining, 0) / total : null;
  };

  const fixed = inForce.filter((l) => l.kind === 'fixed').sort((a, b) => a.yearsRemaining - b.yearsRemaining);

  return {
    buckets,
    leaseCount: inForce.length,
    monthlyRent: totalRent,
    waltByRent: weighted((l) => l.monthlyRent),
    waltBySqft: inForce.length > 0 && inForce.every((l) => l.sqft > 0) ? weighted((l) => l.sqft) : null,
    nextExpiry: fixed.length > 0 ? strip(fixed[0]) : null,
  };
}
