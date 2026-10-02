// Recovery alerts: turns each opted-in lease's overdue / upcoming NNN items (and a missing annual CAM reconciliation) into in-app
// notifications. Pure (no Deno / network): the daily monitor loads the rows, calls planRecoveryAlerts, and applies the result.
// One notification per lease per kind, so a tenant with three late items is one line, not three.

import { RECOVERY_CATEGORY_LABELS, itemStatus, type RecoveryCategory, type RecoveryItem, type RecoveryTerm } from "./recoveries.ts";
import { escapeHtml } from "./digest.ts";

export const RECOVERY_ALERT_TYPES = ["recovery_overdue", "recovery_due_soon", "recovery_reconciliation"] as const;
export type RecoveryAlertType = (typeof RECOVERY_ALERT_TYPES)[number];

/** How many days before an item is due the owner wants to hear about it, per category. */
export type RecoveryLeadDays = Record<RecoveryCategory, number>;
export interface RecoveryPrefs { leadDays: RecoveryLeadDays; email: boolean }

// Insurance needs the longest runway (a renewed certificate takes time to chase); CAM and utilities recur monthly.
export const DEFAULT_RECOVERY_LEAD_DAYS: RecoveryLeadDays = { property_tax: 30, insurance: 45, cam: 7, utilities_submetered: 7, other: 14 };
export const DEFAULT_RECOVERY_PREFS: RecoveryPrefs = { leadDays: DEFAULT_RECOVERY_LEAD_DAYS, email: true };

const clampDays = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(180, Math.max(0, Math.round(n))) : fallback;
};

/** Reads the owner's saved alert preferences (profiles.alert_preferences), filling anything missing with the defaults. */
export function normalizeRecoveryPrefs(p: Record<string, unknown> | null | undefined): RecoveryPrefs {
  const src = p && typeof p === "object" ? p : {};
  const lead = src.recovery_lead_days && typeof src.recovery_lead_days === "object" ? (src.recovery_lead_days as Record<string, unknown>) : {};
  const leadDays = { ...DEFAULT_RECOVERY_LEAD_DAYS };
  for (const c of Object.keys(leadDays) as RecoveryCategory[]) leadDays[c] = clampDays(lead[c], DEFAULT_RECOVERY_LEAD_DAYS[c]);
  return { leadDays, email: src.recovery_email !== false };
}

/** The longest lead time across the given preferences: how far ahead items need to be scheduled. */
export const maxLeadDays = (prefs: RecoveryPrefs[]): number =>
  Math.max(DEFAULT_RECOVERY_LEAD_DAYS.insurance, ...prefs.flatMap((p) => Object.values(p.leadDays)));
/** The prior year's CAM reconciliation is expected by this month/day of the new year (Mar 31). */
export const RECON_DUE_MONTH_DAY = "03-31";

export interface AlertLease { id: string; deal_id: string; user_id: string; tenant_name: string; track_recoveries?: boolean | null; is_active?: boolean | null }
export interface AlertDeal { id: string; title?: string | null }
export interface AlertRecon { lease_id: string; year: number; status: string }
export interface ExistingAlert { id: string; type: string; lease_id: string | null }

export interface PlannedAlert {
  user_id: string;
  deal_id: string;
  type: RecoveryAlertType;
  severity: "warning" | "info";
  title: string;
  message: string;
  action_type: "view_deal";
  action_payload: { deal_id: string; lease_id: string; deal_title: string };
}

export interface RecoveryAlertPlan {
  insert: PlannedAlert[];
  /** Existing open notifications whose condition still holds: refresh their wording. */
  update: Array<{ id: string; title: string; message: string }>;
  /** Existing open notifications whose condition has cleared. */
  dismissIds: string[];
}

const names = (cats: string[]) => [...new Set(cats)].map((c) => RECOVERY_CATEGORY_LABELS[c as keyof typeof RECOVERY_CATEGORY_LABELS] ?? c).join(", ");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function planRecoveryAlerts(args: {
  leases: AlertLease[];
  deals: AlertDeal[];
  terms: RecoveryTerm[];
  items: RecoveryItem[];
  reconciliations: AlertRecon[];
  existing: ExistingAlert[];
  /** Per-owner preferences (by user id); owners without an entry get the defaults. */
  prefsByUser?: Record<string, RecoveryPrefs>;
  today: string; // YYYY-MM-DD
}): RecoveryAlertPlan {
  const { leases, deals, terms, items, reconciliations, existing, today, prefsByUser = {} } = args;
  const dealTitle = new Map(deals.map((d) => [d.id, d.title || "Property"]));
  const termById = new Map(terms.filter((t) => t.is_active !== false).map((t) => [t.id, t]));
  const wanted = new Map<string, PlannedAlert>(); // key: `${type}|${leaseId}`

  for (const lease of leases) {
    if (!lease.track_recoveries || lease.is_active === false) continue;
    const who = `${lease.tenant_name} · ${dealTitle.get(lease.deal_id) ?? "Property"}`;
    const base = { user_id: lease.user_id, deal_id: lease.deal_id, action_type: "view_deal" as const, action_payload: { deal_id: lease.deal_id, lease_id: lease.id, deal_title: dealTitle.get(lease.deal_id) ?? "Property" } };

    const overdue: string[] = [];
    const soon: string[] = [];
    for (const item of items) {
      const term = termById.get(item.term_id);
      if (!term || term.lease_id !== lease.id) continue;
      const lead = (prefsByUser[lease.user_id] ?? DEFAULT_RECOVERY_PREFS).leadDays[term.category] ?? DEFAULT_RECOVERY_LEAD_DAYS.other;
      const status = itemStatus(item, term.mode, today, { dueSoonDays: lead });
      if (status === "overdue") overdue.push(term.category);
      else if (status === "due_soon") soon.push(term.category);
    }
    if (overdue.length) {
      wanted.set(`recovery_overdue|${lease.id}`, { ...base, type: "recovery_overdue", severity: "warning",
        title: `NNN charges overdue · ${who}`,
        message: `${plural(overdue.length, "item")} past due (${names(overdue)}). Open the lease in Operations to mark them paid or verified.` });
    }
    if (soon.length) {
      wanted.set(`recovery_due_soon|${lease.id}`, { ...base, type: "recovery_due_soon", severity: "info",
        title: `NNN charges coming due · ${who}`,
        message: `${plural(soon.length, "item")} coming due soon (${names(soon)}), per your reminder lead times.` });
    }

    // The prior year's CAM true-up is due once the new year's reconciliation deadline has passed.
    const hasCam = [...termById.values()].some((t) => t.lease_id === lease.id && t.category === "cam");
    const year = Number(today.slice(0, 4)) - 1;
    if (hasCam && today > `${year + 1}-${RECON_DUE_MONTH_DAY}`) {
      const done = reconciliations.some((r) => r.lease_id === lease.id && r.year === year && r.status !== "draft");
      if (!done) {
        wanted.set(`recovery_reconciliation|${lease.id}`, { ...base, type: "recovery_reconciliation", severity: "warning",
          title: `${year} CAM reconciliation due · ${who}`,
          message: `No finalized CAM reconciliation for ${year}. Open the lease in Operations to calculate the true-up.` });
      }
    }
  }

  const plan: RecoveryAlertPlan = { insert: [], update: [], dismissIds: [] };
  const open = new Map<string, ExistingAlert>();
  for (const e of existing) {
    if (!(RECOVERY_ALERT_TYPES as readonly string[]).includes(e.type)) continue;
    const key = `${e.type}|${e.lease_id}`;
    if (open.has(key) || !wanted.has(key)) plan.dismissIds.push(e.id); // duplicate or cleared
    else open.set(key, e);
  }
  for (const [key, alert] of wanted) {
    const e = open.get(key);
    if (e) plan.update.push({ id: e.id, title: alert.title, message: alert.message });
    else plan.insert.push(alert);
  }
  return plan;
}

/** Set on the action payload when the monitor (not the owner) dismisses a notification because its condition cleared. */
export const AUTO_CLEARED_FLAG = "auto_cleared";

export const withAutoCleared = (payload: Record<string, unknown> | null | undefined): Record<string, unknown> => ({ ...(payload ?? {}), [AUTO_CLEARED_FLAG]: true });

/**
 * Alerts the owner dismissed within the quiet window (keyed `type|leaseId`); the monitor won't re-raise those. Notifications the
 * monitor itself cleared don't count, otherwise a fresh problem of the same kind would be hidden for a week.
 */
export function quietAlertKeys(
  notifs: Array<{ type: string; action_payload?: Record<string, unknown> | null; is_dismissed: boolean; updated_at: string }>,
  sinceIso: string,
): Set<string> {
  const keys = new Set<string>();
  for (const n of notifs) {
    if (!n.is_dismissed || n.updated_at < sinceIso || n.action_payload?.[AUTO_CLEARED_FLAG] === true) continue;
    keys.add(`${n.type}|${(n.action_payload?.lease_id as string | undefined) ?? null}`);
  }
  return keys;
}

/** One email per owner per run, listing every newly raised NNN alert with a link to Operations. Pure so the wording can be tested. */
export function buildRecoveryEmail(alerts: PlannedAlert[], operationsUrl: string): { subject: string; html: string } {
  const lateCount = alerts.filter((a) => a.type === "recovery_overdue" || a.type === "recovery_reconciliation").length;
  const subject = lateCount > 0
    ? `NNN charges need attention: ${plural(alerts.length, "tenant alert")}`
    : `NNN charges coming due: ${plural(alerts.length, "tenant alert")}`;
  const rows = alerts.map((a) => {
    const color = a.severity === "warning" ? "#f87171" : "#94a3b8";
    return `<div style="background:#020617;border:1px solid #1e293b;border-radius:12px;padding:14px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:700;color:${color};margin-bottom:4px;">${escapeHtml(a.title)}</div>
      <div style="font-size:12px;color:#cbd5e1;">${escapeHtml(a.message)}</div>
    </div>`;
  }).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#020617;color:#f8fafc;margin:0;padding:24px;">
  <div style="background:#0f172a;border:1px solid #334155;border-radius:16px;padding:28px;max-width:560px;margin:0 auto;">
    <div style="font-size:12px;font-weight:800;color:#fbbf24;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Tenant-paid costs</div>
    <div style="font-size:19px;font-weight:800;color:#ffffff;margin-bottom:16px;">${escapeHtml(subject)}</div>
    ${rows}
    <a href="${escapeHtml(operationsUrl)}" style="display:block;text-align:center;background:#1e293b;color:#e2e8f0;font-weight:700;font-size:13px;padding:12px 20px;border-radius:12px;text-decoration:none;margin-top:16px;">Open Operations</a>
    <div style="font-size:11px;color:#475569;text-align:center;margin-top:20px;">MathTree NNN tracking &bull; change lead times or turn these emails off in Alert email settings</div>
  </div>
</body></html>`;
  return { subject, html };
}
