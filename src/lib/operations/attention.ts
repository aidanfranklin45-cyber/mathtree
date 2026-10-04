import { isLeaseInForce, leaseMonthlyRent, leaseStatusOn } from '../leases';
import { isoDay } from '@engine/leaseInForce';
import { resolvePropertyState } from '../property/state';
import { MIN_COLLECTED_MONTHS } from '../property/types';
import type { RowView } from '../../components/operations/rowStatus';
import type { Row } from './rentRoll';

/**
 * The Operations attention inbox: one portfolio-wide list of things that need action. Pure, and it owns no rules of its own.
 * Rent status, escalations and NNN items come from the row views the rent roll already builds; "which leases are in force" and
 * "what does a lease pay" are the shared lease rule and rent accessor; what is missing for an owned deal comes from
 * `resolvePropertyState`. The portfolio page and a property's Operate tab show the same items, the latter filtered to one deal.
 *
 * Anything that is not known stays blank (`amount: null`, `basis: null`), never a default.
 */

export type InboxKind =
  | 'overdue'
  | 'recovery'
  | 'escalation'
  | 'lease_expiring'
  | 'missing_data'
  | 'needs_review'
  | 'due_soon';

/** Where an item's figure comes from: payments on record, the lease on file, or an underwriting assumption. Null when no figure. */
export type InboxBasis = 'collected' | 'contracted' | 'estimated' | null;

export interface InboxItem {
  id: string;
  kind: InboxKind;
  dealId: string;
  dealTitle: string;
  /** The lease the item is about, when it has one (opens that lease's drawer on the property's own tab). */
  leaseId: string | null;
  headline: string;
  detail: string;
  amount: number | null;
  basis: InboxBasis;
  /** The property's Operate tab. */
  link: string;
}

/** Display order: money already late first, then what is coming, then gaps in the data. */
export const INBOX_ORDER: Record<InboxKind, number> = {
  overdue: 0, recovery: 1, escalation: 2, lease_expiring: 3, missing_data: 4, needs_review: 5, due_soon: 6,
};

export const INBOX_LABEL: Record<InboxKind, string> = {
  overdue: 'Overdue rent', recovery: 'NNN charges', escalation: 'Rent increase', lease_expiring: 'Lease expiring',
  missing_data: 'Missing data', needs_review: 'Needs review', due_soon: 'Rent due soon',
};

/** Fixed names for the "missing data" types, so a muted entry reads the same whatever the count in the headline. */
export const MISSING_LABEL: Record<string, string> = {
  leases: 'No lease records', rent: 'Lease with no rent stated', end: 'Lease with no end date',
  start: 'Lease with no start date', payments: 'Rent payments not recorded',
};

/** What a mute applies to: one property and one type of item (all of a property's overdue rent, or one kind of missing data). */
export const inboxMuteKey = (i: Pick<InboxItem, 'id' | 'kind' | 'dealId'>): string =>
  `${i.dealId}|${i.kind === 'missing_data' ? `missing:${i.id.split(':missing:')[1] ?? ''}` : i.kind}`;

export const inboxMuteLabel = (i: Pick<InboxItem, 'id' | 'kind' | 'headline'>): string =>
  i.kind === 'missing_data' ? MISSING_LABEL[i.id.split(':missing:')[1] ?? ''] ?? i.headline : INBOX_LABEL[i.kind];

/** Drop the items the owner has muted. */
export const applyMutes = (items: InboxItem[], mutedKeys: ReadonlySet<string>): InboxItem[] =>
  mutedKeys.size === 0 ? items : items.filter((i) => !mutedKeys.has(inboxMuteKey(i)));

export const operateLink = (dealId: string): string => `/project?id=${encodeURIComponent(dealId)}&tab=operate`;

/** A lease ending within this many days is "expiring soon". */
export const EXPIRY_WARNING_DAYS = 180;

const DAY_MS = 86400000;
const toUtcDay = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const longDate = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export interface InboxInput {
  /** Every deal in view; only owned, non-prospect deals produce items. */
  deals: Row[];
  /** Rows of the `leases` table (not the lease rows derived from underwriting inputs). */
  leaseRows: Row[];
  units: Row[];
  payments: Row[];
  /** Rent-roll row views (already scoped to the screen). Their `attention` flags drive the rent items. */
  views: RowView[];
  /** Leases shown on the rent roll, including ones derived from underwriting inputs. Drives expiries. */
  rentRollLeases: Row[];
  /** True when the viewed month is the current one; rent items are about now, so they are skipped for other months. */
  currentPeriod: boolean;
  now: Date;
  /** One line for a lease's overdue NNN items. */
  recoveryNote?: (leaseId: string) => string;
  /** Items from other sources (a CSV or offering-memorandum import), appended before sorting. */
  extra?: InboxItem[];
}

/** Unpaid rent for the current month: the payment record when there is one, otherwise the lease's stated rent. */
function rentAtStake(view: RowView): { amount: number | null; basis: InboxBasis } {
  if (view.derived) return { amount: leaseMonthlyRent(view.row), basis: 'estimated' };
  const p = view.payment;
  const due = p ? parseFloat(String(p.amount_due ?? '')) : NaN;
  if (p && due > 0) return { amount: Math.max(0, due - (parseFloat(String(p.amount_paid ?? '')) || 0)), basis: 'collected' };
  return { amount: leaseMonthlyRent(view.row), basis: leaseMonthlyRent(view.row) === null ? null : 'contracted' };
}

export function buildInboxItems(input: InboxInput): InboxItem[] {
  const { deals, leaseRows, units, payments, views, rentRollLeases, currentPeriod, now, recoveryNote, extra } = input;
  const owned = new Map(deals.filter((d) => d && d.status === 'owned').map((d) => [d.id as string, d]));
  const titleOf = (id: string) => owned.get(id)?.title || owned.get(id)?.name || 'Unknown Asset';
  const items: InboxItem[] = [];
  const add = (i: Omit<InboxItem, 'link' | 'dealTitle'>) => items.push({ ...i, dealTitle: titleOf(i.dealId), link: operateLink(i.dealId) });

  // ---- Rent: overdue, NNN, escalations, due soon (the row views carry the rules) ----
  for (const v of views) {
    if (v.vacant || !owned.has(v.row.deal_id)) continue;
    const base = { dealId: v.row.deal_id as string, leaseId: v.row.id as string };
    const who = v.row.tenant_name || 'Tenant';
    const { amount, basis } = rentAtStake(v);
    for (const kind of v.attention) {
      if (kind === 'overdue') add({ ...base, id: `${v.row.id}:overdue`, kind, headline: `${who}: rent overdue`, detail: v.due?.summary || 'Rent overdue', amount, basis });
      else if (kind === 'recovery') add({ ...base, id: `${v.row.id}:recovery`, kind, headline: `${who}: NNN charges overdue`, detail: recoveryNote?.(v.row.id) || 'NNN charges overdue', amount: null, basis: null });
      else if (kind === 'escalation') {
        if (v.derived) continue; // a lease derived from underwriting inputs carries a default schedule, not a real one
        const step = v.esc?.nearestScheduled;
        add({ ...base, id: `${v.row.id}:escalation`, kind, headline: `${who}: rent increase due`, detail: step ? `Effective ${step.effective_date} (${v.esc?.scheduledValStr})` : 'Scheduled increase has come due', amount: null, basis: null });
      } else add({ ...base, id: `${v.row.id}:due_soon`, kind, headline: `${who}: rent due soon`, detail: v.due?.summary || 'Rent due soon', amount, basis });
    }
    if (currentPeriod && !v.derived && v.esc?.isUnscheduledReviewDue && !v.attention.includes('escalation')) {
      add({ ...base, id: `${v.row.id}:escalation`, kind: 'escalation', headline: `${who}: rent review due`, detail: 'No increase scheduled and the last change was over a year ago', amount: null, basis: null });
    }
  }

  // ---- Leases expiring (or holding over), by the shared in-force rule ----
  for (const l of rentRollLeases) {
    if (!owned.has(l.deal_id)) continue;
    const status = leaseStatusOn(l, now);
    const end = isoDay(String(l.lease_end_date ?? '')) || null;
    if (!end || String(l.term_type ?? '').toLowerCase() === 'month_to_month') continue;
    const days = Math.round((toUtcDay(end) - toUtcDay(isoDay(now))) / DAY_MS);
    if (status !== 'in_force' && !(status === 'ended' && l.is_active !== false)) continue;
    if (days > EXPIRY_WARNING_DAYS) continue;
    const who = l.tenant_name || 'Tenant';
    const rent = leaseMonthlyRent(l);
    add({
      id: `${l.id}:lease_expiring`, kind: 'lease_expiring', dealId: l.deal_id, leaseId: l.is_derived ? null : l.id,
      headline: days < 0 ? `${who}: lease ended, still active` : `${who}: lease ends ${longDate(end)}`,
      detail: days < 0 ? `Ended ${longDate(end)}; renew it, mark month-to-month, or end it` : days === 0 ? 'Ends today' : `Ends in ${plural(days, 'day')}`,
      amount: rent === null ? null : rent * 12, basis: rent === null ? null : l.is_derived ? 'estimated' : 'contracted',
    });
  }

  // ---- Missing data that blocks a figure, per owned (non-demo) deal ----
  for (const deal of owned.values()) {
    if (deal.is_demo) continue;
    const facts = {
      leases: leaseRows.filter((l) => l.deal_id === deal.id && l.is_active !== false),
      units: units.filter((u) => u.deal_id === deal.id),
      payments: payments.filter((p) => p.deal_id === deal.id),
    };
    // Only the rent roll and collected rent are read here; the forecast figures are not.
    const state = resolvePropertyState({ deal, facts, asOf: now, estimate: { value: 0, noi: 0, operatingExpenses: null, debtService: 0, cashFlow: 0 } });
    const gap = (key: string, headline: string, detail: string) =>
      add({ id: `${deal.id}:missing:${key}`, kind: 'missing_data', dealId: deal.id, leaseId: null, headline, detail, amount: null, basis: null });

    if (state.rentRoll.source === 'none') {
      gap('leases', 'No lease records', 'Add the rent roll so rent, occupancy and expiries can be shown. Until then the property runs on its underwriting estimate.');
      continue;
    }
    const inForce = facts.leases.filter((l) => isLeaseInForce(l, now));
    const noRent = inForce.filter((l) => leaseMonthlyRent(l) === null).length;
    if (noRent > 0) gap('rent', `${plural(noRent, 'lease')} with no rent stated`, 'Rent for these leases is blank, so monthly rent and collections cannot be computed.');
    const noEnd = inForce.filter((l) => !isoDay(String(l.lease_end_date ?? '')) && String(l.term_type ?? '').toLowerCase() !== 'month_to_month').length;
    if (noEnd > 0) gap('end', `${plural(noEnd, 'lease')} with no end date`, 'Without an end date a lease cannot appear on the expiry ladder. Set one, or mark it month-to-month.');
    const noStart = inForce.filter((l) => !isoDay(String(l.lease_start_date ?? ''))).length;
    if (noStart > 0) gap('start', `${plural(noStart, 'lease')} with no start date`, 'Without a start date, rent escalations and rent-due dates cannot be scheduled.');
    if (state.collected === null) gap('payments', 'No rent payments recorded', 'Collected rent and actual NOI stay blank until payments are logged.');
    else if (state.collected.annualised === null) gap('payments', `Only ${plural(state.collected.months, 'month')} of rent recorded`, `Collected-rent figures need ${MIN_COLLECTED_MONTHS} months of payments.`);
  }

  items.push(...(extra ?? []).filter((i) => owned.has(i.dealId) || i.kind === 'needs_review'));
  return items.sort((a, b) => INBOX_ORDER[a.kind] - INBOX_ORDER[b.kind] || a.dealTitle.localeCompare(b.dealTitle));
}
