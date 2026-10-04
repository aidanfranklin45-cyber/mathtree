/**
 * NNN recovery tracking: pure logic for tenant-paid property tax, insurance, CAM and submetered
 * utilities. Tracking only — nothing here touches underwriting. No fetching, no React.
 *
 * A lease opts in via `track_recoveries`. Each opted-in lease has terms (what is owed, who pays the
 * vendor, how often) and items (one per term per due date) that the user marks paid / verified.
 */

export type RecoveryCategory = 'property_tax' | 'insurance' | 'cam' | 'utilities_submetered' | 'other';
export type RecoveryMode = 'direct_pay' | 'reimburse';
export type RecoveryFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type RecoveryStatus = 'complete' | 'overdue' | 'due_soon' | 'upcoming';

export const RECOVERY_CATEGORY_LABELS: Record<RecoveryCategory, string> = {
  property_tax: 'Property tax',
  insurance: 'Insurance',
  cam: 'CAM',
  utilities_submetered: 'Submetered utilities',
  other: 'Other',
};

export interface RecoveryTerm {
  id: string;
  lease_id: string;
  category: RecoveryCategory;
  mode: RecoveryMode;
  frequency: RecoveryFrequency;
  first_due_date: string; // YYYY-MM-DD
  expected_amount?: number | null;
  is_active?: boolean;
}

export interface RecoveryItem {
  id?: string;
  term_id: string;
  due_date: string; // YYYY-MM-DD
  amount_expected?: number | null;
  paid_date?: string | null;
  verified?: boolean;
}

interface StatusOpts {
  graceDays?: number;
  dueSoonDays?: number;
  /** Per-category look-ahead (owner preference); overrides `dueSoonDays` where set. */
  leadDays?: Partial<Record<RecoveryCategory, number>>;
}

const MONTHS_PER: Record<RecoveryFrequency, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const DAY_MS = 86_400_000;
const WITH_RECOVERIES = new Set(['NNN', 'Modified Gross']);

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY_MS);

/** Today as YYYY-MM-DD on the caller's calendar (toISOString would already be tomorrow on a US evening). */
export const localTodayIso = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Adds whole months, clamping to month end (Jan 31 + 1 month = Feb 28). */
const addMonths = (iso: string, months: number): string => {
  const d = parse(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d);
};

/** Pre-check for the lease toggle only; the user can always override. Gross and residential stay off. */
export const defaultTrackRecoveries = (leaseType: string | null | undefined): boolean =>
  WITH_RECOVERIES.has(String(leaseType ?? ''));

/** Tenant's pro-rata share of a property, as a percent (0–100), or null when it can't be derived. */
export const proRataSharePct = (tenantSqft: number | null | undefined, propertySqft: number | null | undefined): number | null => {
  const t = Number(tenantSqft), p = Number(propertySqft);
  if (!(t > 0) || !(p > 0)) return null;
  return Math.min(100, Math.round((t / p) * 10000) / 100);
};

/** Due dates for a term from its first due date through `through` (inclusive), oldest first. */
export const expectedDueDates = (term: Pick<RecoveryTerm, 'first_due_date' | 'frequency'>, through: string): string[] => {
  const step = MONTHS_PER[term.frequency];
  const out: string[] = [];
  for (let i = 0; i < 600; i++) {
    const due = addMonths(term.first_due_date, i * step);
    if (due > through) break;
    out.push(due);
  }
  return out;
};

/** A reimbursement is complete once the tenant has repaid; a direct-pay item once it is verified. */
export const isItemComplete = (item: Pick<RecoveryItem, 'paid_date' | 'verified'>, mode: RecoveryMode): boolean =>
  mode === 'reimburse' ? !!item.paid_date : !!item.verified;

export const itemStatus = (
  item: Pick<RecoveryItem, 'due_date' | 'paid_date' | 'verified'>,
  mode: RecoveryMode,
  today: string,
  opts: StatusOpts = {},
): RecoveryStatus => {
  const { graceDays = 0, dueSoonDays = 30 } = opts;
  if (isItemComplete(item, mode)) return 'complete';
  const late = daysBetween(item.due_date, today);
  if (late > graceDays) return 'overdue';
  if (late >= -dueSoonDays) return 'due_soon';
  return 'upcoming';
};

/**
 * How far back scheduling reaches for unpaid items: the later of 60 days or the start of the current year. The year floor
 * is what makes a yearly or twice-a-year charge (insurance, tax) show overdue when this year's payment was never marked,
 * instead of silently falling outside a short window and reading "up to date".
 */
export const backfillSinceIso = (today: string): string => {
  const sixty = fmt(new Date(parse(today).getTime() - 60 * DAY_MS));
  const jan1 = `${today.slice(0, 4)}-01-01`;
  return jan1 < sixty ? jan1 : sixty;
};

/** Items that should exist (due from `since`, if given, through `through`) but have not been created yet. */
export const missingItems = (terms: RecoveryTerm[], items: RecoveryItem[], through: string, since?: string): RecoveryItem[] => {
  const have = new Set(items.map((i) => `${i.term_id}|${i.due_date}`));
  const out: RecoveryItem[] = [];
  for (const t of terms) {
    if (t.is_active === false) continue;
    for (const due of expectedDueDates(t, through)) {
      if (since && due < since) continue; // never backfill a long history as a wall of overdue items
      if (!have.has(`${t.id}|${due}`)) out.push({ term_id: t.id, due_date: due, amount_expected: t.expected_amount ?? null });
    }
  }
  return out;
};

export interface LeaseRecoverySummary {
  tracked: boolean;
  overdue: number;
  dueSoon: number;
  complete: number;
  /** Earliest unfinished item, for the "next due" line. */
  next: (RecoveryItem & { category: RecoveryCategory; status: RecoveryStatus }) | null;
}

/** Rolls a lease's items into counts for the rent-roll badge and the Needs-attention list. */
export const summarizeLeaseRecoveries = (
  lease: { track_recoveries?: boolean | null },
  terms: RecoveryTerm[],
  items: RecoveryItem[],
  today: string,
  opts: StatusOpts = {},
): LeaseRecoverySummary => {
  const empty: LeaseRecoverySummary = { tracked: false, overdue: 0, dueSoon: 0, complete: 0, next: null };
  if (!lease.track_recoveries) return empty;
  const byTerm = new Map(terms.filter((t) => t.is_active !== false).map((t) => [t.id, t]));
  const sum: LeaseRecoverySummary = { ...empty, tracked: true };
  for (const item of items) {
    const term = byTerm.get(item.term_id);
    if (!term) continue;
    const status = itemStatus(item, term.mode, today, { ...opts, dueSoonDays: opts.leadDays?.[term.category] ?? opts.dueSoonDays });
    if (status === 'complete') { sum.complete++; continue; }
    if (status === 'overdue') sum.overdue++;
    if (status === 'due_soon') sum.dueSoon++;
    if (!sum.next || item.due_date < sum.next.due_date) sum.next = { ...item, category: term.category, status };
  }
  return sum;
};
