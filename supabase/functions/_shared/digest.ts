// Digest emails: when several tenants of one property are due on the same day, send ONE email listing them with ONE link to the rent
// checklist (a page, no sign-in, where the owner ticks who has paid and presses Save), instead of one email per tenant. Pure (no Deno /
// network) so the grouping and the HTML can be tested.
//
// A tenant's own reminder is still built exactly as before (`single`); this module only decides whether it goes out alone or inside a
// digest, and renders the digest. The checklist link is created by the caller (a one-time token covering exactly these leases).

export const DEFAULT_DIGEST_MIN = 3;

/** The owner's setting: send a digest when at least this many tenants of one property are due. 0 = never combine. */
export function normalizeDigestMin(v: unknown): number {
  if (v === 0 || v === "0" || v === "off" || v === false) return 0;
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (isNaN(n)) return DEFAULT_DIGEST_MIN;
  return Math.min(100, Math.max(2, Math.round(n)));
}

export type ReminderKind = "advance" | "due" | "followup";

export interface ReminderItem {
  leaseId: string;
  userId: string;
  /** First day of the month the rent is for (YYYY-MM-01), used to scope the checklist link. */
  periodMonth: string;
  dealId: string;
  dealTitle: string;
  to: string;
  tenant: string;
  /** "Suite 120", "Unit 4B", "" when the tenant has no space recorded */
  space: string;
  rent: number;
  kind: ReminderKind;
  advanceDays?: number;
  followupNumber?: number;
  graceDays?: number;
  confirmUrl: string;
  snoozeUrl: string;
  /** The owner's digest threshold (see normalizeDigestMin). */
  digestMin: number;
  /** The tenant's own full email, used when this reminder is sent alone. */
  single: { subject: string; html: string };
}

export interface DigestGroup {
  key: string;
  to: string;
  dealTitle: string;
  isFollowup: boolean;
  items: ReminderItem[];
}

export interface DispatchPlan {
  digests: DigestGroup[];
  singles: ReminderItem[];
}

/**
 * Splits reminders into digests and singles. Reminders group by recipient, property and whether they are follow-ups (a past-due
 * chase is not mixed with a routine reminder). A group becomes a digest only when it has at least its owner's threshold.
 */
export function planDispatch(items: ReminderItem[]): DispatchPlan {
  const groups = new Map<string, DigestGroup>();
  for (const it of items) {
    const isFollowup = it.kind === "followup";
    const key = `${it.to.toLowerCase()}|${it.dealId}|${isFollowup ? "followup" : "reminder"}`;
    const g = groups.get(key) ?? { key, to: it.to, dealTitle: it.dealTitle, isFollowup, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const plan: DispatchPlan = { digests: [], singles: [] };
  for (const g of groups.values()) {
    const min = g.items[0].digestMin;
    if (min > 0 && g.items.length >= min) plan.digests.push(g);
    else plan.singles.push(...g.items);
  }
  return plan;
}

export const escapeHtml = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const money = (n: number): string => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

const sectionTitle = (kind: ReminderKind, advanceDays?: number): string => {
  if (kind === "due") return "Due today";
  if (kind === "advance") return `Due in ${advanceDays ?? 0} day${(advanceDays ?? 0) === 1 ? "" : "s"}`;
  return "Past due";
};

/**
 * The digest email for one property: who is due, and ONE button to the checklist. `manageUrl` is the one-time link covering exactly these
 * tenants. The email deliberately has no per-tenant buttons: the checklist is where the owner ticks who paid.
 */
export function buildDigestEmail(group: DigestGroup, manageUrl: string): { subject: string; html: string } {
  const items = [...group.items].sort((a, b) => (a.space || a.tenant).localeCompare(b.space || b.tenant, undefined, { numeric: true }));
  const total = items.reduce((s, i) => s + (Number(i.rent) || 0), 0);
  const n = items.length;

  const subject = group.isFollowup
    ? `⚠️ Past-due rent: ${n} tenants at ${group.dealTitle} (${money(total)})`
    : items.every((i) => i.kind === "advance")
      ? `Rent due in ${items[0].advanceDays ?? 0} day${(items[0].advanceDays ?? 0) === 1 ? "" : "s"}: ${n} tenants at ${group.dealTitle} (${money(total)})`
      : `Rent due: ${n} tenants at ${group.dealTitle} (${money(total)})`;

  // sections in a stable order: due today, advance notices, follow-ups
  const order: Array<{ kind: ReminderKind; advanceDays?: number }> = [];
  for (const i of items) {
    if (!order.some((o) => o.kind === i.kind && o.advanceDays === i.advanceDays)) order.push({ kind: i.kind, advanceDays: i.advanceDays });
  }
  order.sort((a, b) => ["due", "advance", "followup"].indexOf(a.kind) - ["due", "advance", "followup"].indexOf(b.kind));

  const rowsFor = (kind: ReminderKind, advanceDays?: number) =>
    items
      .filter((i) => i.kind === kind && i.advanceDays === advanceDays)
      .map(
        (i) => `
      <tr>
        <td style="padding:9px 8px;border-bottom:1px solid #1e293b;font-size:12px;color:#e2e8f0;">
          <strong>${escapeHtml(i.tenant)}</strong>${i.space ? ` <span style="color:#94a3b8;">&middot; ${escapeHtml(i.space)}</span>` : ""}${
            i.followupNumber && i.followupNumber > 1 ? ` <span style="color:#f87171;">&middot; Follow-up #${i.followupNumber}</span>` : ""
          }
        </td>
        <td style="padding:9px 8px;border-bottom:1px solid #1e293b;font-size:13px;font-weight:800;color:#34d399;white-space:nowrap;text-align:right;">${money(i.rent)}</td>
      </tr>`,
      )
      .join("");

  const sections = order
    .map(
      (o) => `
    <div style="font-size:11px;font-weight:800;color:${o.kind === "followup" ? "#f87171" : "#10b981"};text-transform:uppercase;letter-spacing:1px;margin:16px 0 4px;">${sectionTitle(o.kind, o.advanceDays)}</div>
    <table style="width:100%;border-collapse:collapse;">${rowsFor(o.kind, o.advanceDays)}</table>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#020617;color:#f8fafc;margin:0;padding:24px;">
  <div style="background:#0f172a;border:1px solid ${group.isFollowup ? "#dc2626" : "#1e293b"};border-radius:16px;padding:28px;max-width:600px;margin:0 auto;">
    <div style="font-size:12px;font-weight:800;color:#10b981;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">MathTree &bull; ${group.isFollowup ? "Past-due rent" : "Rent reminders"}</div>
    <div style="font-size:21px;font-weight:800;color:#ffffff;margin-bottom:4px;">${escapeHtml(group.dealTitle)}</div>
    <div style="font-size:13px;color:#94a3b8;line-height:1.55;">${n} tenants &middot; ${money(total)} in total.</div>
    ${sections}
    <a href="${escapeHtml(manageUrl)}" style="display:block;text-align:center;background:#10b981;color:#022c22;font-weight:800;font-size:15px;padding:15px 20px;border-radius:12px;text-decoration:none;margin:22px 0 12px;">Manage rent payments</a>
    <div style="font-size:12px;color:#94a3b8;line-height:1.55;">Open the checklist, tick everyone who has paid and press <strong>Save</strong>. Anyone you leave unticked is snoozed (using your notification setting) and followed up from there. No sign-in needed, and you can reopen the link to correct a mistake.</div>
  </div>
</body>
</html>`;

  return { subject, html };
}
