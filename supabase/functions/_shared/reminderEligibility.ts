// Who gets rent emails. Pure (no Deno / database access) so the rule can be tested.
//
// A tenant is only chased for rent when the property is OWNED (a prospect is still being underwritten and has nobody to collect
// from), is not demo data, and the lease is in force today: active, already started, and not yet ended.

import { leaseStatusOn } from "./leaseInForce.ts";

export interface EligibilityInput {
  dealStatus?: string | null;
  isDemo?: boolean | null;
  leaseActive?: boolean | null;
  /** YYYY-MM-DD (a time part is ignored) */
  leaseStartDate?: string | null;
  leaseEndDate?: string | null;
  /** 'month_to_month' leases have no real end: a stale end date must not stop reminders */
  termType?: string | null;
  today?: Date;
}

/** True when the lease is running on `today` (the shared rule; no start or end date means open-ended). */
export function leaseInForce(
  start: string | null | undefined,
  end: string | null | undefined,
  today: Date = new Date(),
): boolean {
  return leaseStatusOn({ lease_start_date: start, lease_end_date: end }, today) === "in_force";
}

/**
 * True when `today` is exactly `advanceDays` before this lease's next rent due date. A due day of 29-31 falls on the last day of
 * shorter months, and an early due day (1st with a 3-day notice) is announced in the previous month.
 */
export function isAdvanceNoticeDay(today: Date, dueDay: number, advanceDays: number): boolean {
  if (!(advanceDays > 0)) return false;
  const want = Math.max(1, Math.floor(dueDay) || 1);
  for (const offset of [0, 1]) {
    const lastDay = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0).getDate();
    const due = new Date(today.getFullYear(), today.getMonth() + offset, Math.min(want, lastDay));
    const notice = new Date(due.getFullYear(), due.getMonth(), due.getDate() - advanceDays);
    if (notice.getFullYear() === today.getFullYear() && notice.getMonth() === today.getMonth() && notice.getDate() === today.getDate()) return true;
  }
  return false;
}

export type EligibilityReason = "ok" | "not_owned" | "demo" | "inactive" | "not_started" | "ended";

export function reminderEligibility(i: EligibilityInput): { eligible: boolean; reason: EligibilityReason } {
  if (i.isDemo) return { eligible: false, reason: "demo" };
  if (String(i.dealStatus ?? "").toLowerCase() !== "owned") return { eligible: false, reason: "not_owned" };
  const status = leaseStatusOn(
    { is_active: i.leaseActive, lease_start_date: i.leaseStartDate, lease_end_date: i.leaseEndDate, term_type: i.termType },
    i.today ?? new Date(),
  );
  if (status !== "in_force") return { eligible: false, reason: status };
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
