// Who gets rent emails. Pure (no Deno / database access) so the rule can be tested.
//
// A tenant is only chased for rent when the property is OWNED (a prospect is still being underwritten and has nobody to collect
// from), is not demo data, and the lease is in force today: active, already started, and not yet ended.

export interface EligibilityInput {
  dealStatus?: string | null;
  isDemo?: boolean | null;
  leaseActive?: boolean | null;
  /** YYYY-MM-DD (a time part is ignored) */
  leaseStartDate?: string | null;
  leaseEndDate?: string | null;
  today?: Date;
}

const day = (v: unknown): string | null => {
  const m = String(v ?? "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
};

const isoToday = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** True when the lease is running on `today`. A lease with no start or end date is treated as running (open-ended). */
export function leaseInForce(
  start: string | null | undefined,
  end: string | null | undefined,
  today: Date = new Date(),
): boolean {
  const t = isoToday(today);
  const s = day(start);
  const e = day(end);
  return (!s || s <= t) && (!e || e >= t);
}

export type EligibilityReason = "ok" | "not_owned" | "demo" | "inactive" | "not_started" | "ended";

export function reminderEligibility(i: EligibilityInput): { eligible: boolean; reason: EligibilityReason } {
  if (i.isDemo) return { eligible: false, reason: "demo" };
  if (String(i.dealStatus ?? "").toLowerCase() !== "owned") return { eligible: false, reason: "not_owned" };
  if (i.leaseActive === false) return { eligible: false, reason: "inactive" };
  const today = i.today ?? new Date();
  const t = isoToday(today);
  const s = day(i.leaseStartDate);
  const e = day(i.leaseEndDate);
  if (s && s > t) return { eligible: false, reason: "not_started" };
  if (e && e < t) return { eligible: false, reason: "ended" };
  return { eligible: true, reason: "ok" };
}

export const isReminderEligible = (i: EligibilityInput): boolean => reminderEligibility(i).eligible;

/**
 * How a tenant's space reads in an email ("Suite 120", "Unit 4B", "Main Building"). Stored unit numbers often already say what
 * they are, so only a bare number or code gets a "Unit" prefix.
 */
export function unitLabel(unitNumber: unknown): string {
  const raw = String(unitNumber ?? "").trim();
  if (!raw) return "";
  if (/^(suite|ste|unit|apt|apartment|bldg|building|room|rm|lot|space|bay|studio|floor|#)\b/i.test(raw) || /\s/.test(raw)) return raw.replace(/^#\s*/, "Unit ");
  return `Unit ${raw}`;
}
