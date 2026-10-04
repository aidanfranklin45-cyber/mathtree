// The one rule for "is this lease in force", and the one accessor for what it pays. Pure (no Deno / database access), so the app,
// the engine-side helpers and the daily email job all read the same definition. Works on both shapes a lease comes in: a row of the
// `leases` table (snake_case) and a lease object inside a deal's inputs (camelCase).

export type LeaseLike = Record<string, any>;

export type LeaseStatus = "in_force" | "inactive" | "not_started" | "ended";

const day = (v: unknown): string | null => {
  const m = String(v ?? "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
};

/** YYYY-MM-DD in local time; a string is passed through (time part ignored). */
export const isoDay = (d: Date | string): string =>
  typeof d === "string" ? day(d) ?? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const pick = (l: LeaseLike, snake: string, camel: string): unknown => l[snake] ?? l[camel];

/**
 * Status of a lease on a date. Inactive leases are never in force; a lease that has not started is not yet; a fixed-term lease past
 * its end date has ended. A month-to-month lease has no real end (a stale end date is ignored). A missing start or end date is
 * open-ended.
 */
export function leaseStatusOn(lease: LeaseLike | null | undefined, asOf: Date | string = new Date()): LeaseStatus {
  if (!lease) return "inactive";
  const active = lease.is_active ?? lease.isActive;
  if (active === false) return "inactive";
  const t = isoDay(asOf);
  const start = day(pick(lease, "lease_start_date", "leaseStartDate"));
  const m2m = String(pick(lease, "term_type", "termType") ?? "").toLowerCase() === "month_to_month";
  const end = m2m ? null : day(pick(lease, "lease_end_date", "leaseEndDate"));
  if (start && start > t) return "not_started";
  if (end && end < t) return "ended";
  return "in_force";
}

export const isLeaseInForce = (lease: LeaseLike | null | undefined, asOf: Date | string = new Date()): boolean =>
  leaseStatusOn(lease, asOf) === "in_force";

/** Contract rent per month, or null when the lease states none (never 0 as a stand-in for unknown). */
export function leaseMonthlyRent(lease: LeaseLike | null | undefined): number | null {
  if (!lease) return null;
  const monthly = parseFloat(String(pick(lease, "monthly_rent", "monthlyRent") ?? ""));
  if (monthly > 0) return monthly;
  const annual = parseFloat(String(pick(lease, "annual_rent", "annualRent") ?? ""));
  return annual > 0 ? annual / 12 : null;
}
