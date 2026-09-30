// Rent follow-up rules, kept pure (no Deno / database access) so they can be tested.
//
// After the due-date reminder, unpaid rent keeps getting follow-up emails, at a pace the user chooses:
//   * followup_grace_period   on/off master switch for follow-ups                    (default on)
//   * followup_frequency_days minimum days between follow-up emails for one month's rent (default 3)
//   * followup_max_count      most follow-ups to send per month's rent; 0 = no limit   (default 3)
// A follow-up starts once a snooze has run out, or (if the owner simply ignored the reminder) once the lease's grace period
// has passed. Snoozing again pauses follow-ups until the new snooze runs out.

export interface FollowupPrefs {
  followup_grace_period: boolean;
  followup_frequency_days: number;
  followup_max_count: number;
}

export const DEFAULT_FOLLOWUP_PREFS: FollowupPrefs = {
  followup_grace_period: true,
  followup_frequency_days: 3,
  followup_max_count: 3,
};

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export function normalizeFollowupPrefs(p: Record<string, unknown> | null | undefined): FollowupPrefs {
  const src = p && typeof p === "object" ? p : {};
  return {
    followup_grace_period: src.followup_grace_period !== false,
    followup_frequency_days: clampInt(src.followup_frequency_days, 1, 30, DEFAULT_FOLLOWUP_PREFS.followup_frequency_days),
    followup_max_count: clampInt(src.followup_max_count, 0, 20, DEFAULT_FOLLOWUP_PREFS.followup_max_count),
  };
}

export interface FollowupInput {
  today: Date;
  dueDay: number;
  graceDays: number;
  rent: number;
  payment?: { status?: string | null; amount_paid?: number | string | null; snooze_until?: string | null } | null;
  /** created_at of every confirm token issued for this lease and month (the first is the due-date reminder). */
  reminderTimes: Array<Date | string>;
  prefs: FollowupPrefs;
}

export type FollowupDecision =
  | { send: false; reason: "disabled" | "paid" | "snoozed" | "not_due_yet" | "within_grace" | "too_soon" | "max_reached" }
  | { send: true; reason: "snooze_expired" | "past_grace"; followupNumber: number };

const DAY_MS = 86400000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);

/** A due day of 29-31 falls on the last day of shorter months. */
export function dueDateFor(today: Date, dueDay: number): Date {
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return new Date(today.getFullYear(), today.getMonth(), Math.min(Math.max(1, Math.floor(dueDay) || 1), last));
}

export function decideFollowup(i: FollowupInput): FollowupDecision {
  if (!i.prefs.followup_grace_period) return { send: false, reason: "disabled" };

  const today = startOfDay(i.today);
  const paidAmount = Number(i.payment?.amount_paid ?? 0);
  if (i.payment && (i.payment.status === "paid" || (i.rent > 0 && paidAmount >= i.rent))) return { send: false, reason: "paid" };

  const due = dueDateFor(today, i.dueDay);
  if (today < due) return { send: false, reason: "not_due_yet" };

  // Snooze: paused while it is running; its expiry is the trigger for the next follow-up
  let snoozeExpired = false;
  if (i.payment?.snooze_until) {
    const until = startOfDay(new Date(`${String(i.payment.snooze_until).slice(0, 10)}T12:00:00`));
    if (today < until) return { send: false, reason: "snoozed" };
    snoozeExpired = i.payment.status === "snoozed";
  }

  const graceEnds = new Date(due.getFullYear(), due.getMonth(), due.getDate() + Math.max(0, i.graceDays));
  const pastGrace = today > graceEnds;
  if (!snoozeExpired && !pastGrace) return { send: false, reason: "within_grace" };

  const times = i.reminderTimes.map((t) => new Date(t)).filter((t) => !isNaN(t.getTime())).sort((a, b) => b.getTime() - a.getTime());
  const followupsSent = Math.max(0, times.length - 1); // the first email is the due-date reminder, not a follow-up
  const max = i.prefs.followup_max_count;
  if (max > 0 && followupsSent >= max) return { send: false, reason: "max_reached" };

  if (times.length > 0 && daysBetween(times[0], today) < i.prefs.followup_frequency_days) return { send: false, reason: "too_soon" };

  return { send: true, reason: snoozeExpired ? "snooze_expired" : "past_grace", followupNumber: followupsSent + 1 };
}
