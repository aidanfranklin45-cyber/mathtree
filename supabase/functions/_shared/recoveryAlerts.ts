// Recovery alerts: turns each opted-in lease's overdue / upcoming NNN items (and a missing annual CAM reconciliation) into in-app
// notifications. Pure (no Deno / network): the daily monitor loads the rows, calls planRecoveryAlerts, and applies the result.
// One notification per lease per kind, so a tenant with three late items is one line, not three.

import { RECOVERY_CATEGORY_LABELS, itemStatus, type RecoveryItem, type RecoveryTerm } from "./recoveries.ts";

export const RECOVERY_ALERT_TYPES = ["recovery_overdue", "recovery_due_soon", "recovery_reconciliation"] as const;
export type RecoveryAlertType = (typeof RECOVERY_ALERT_TYPES)[number];

/** Items due within this many days raise a heads-up. */
export const ALERT_DUE_SOON_DAYS = 14;
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
  today: string; // YYYY-MM-DD
}): RecoveryAlertPlan {
  const { leases, deals, terms, items, reconciliations, existing, today } = args;
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
      const status = itemStatus(item, term.mode, today, { dueSoonDays: ALERT_DUE_SOON_DAYS });
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
        message: `${plural(soon.length, "item")} due within ${ALERT_DUE_SOON_DAYS} days (${names(soon)}).` });
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
