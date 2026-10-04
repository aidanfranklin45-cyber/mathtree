import { buildOperations, formatPeriodMonth, type Row } from './rentRoll';
import { buildInboxItems, type InboxItem } from './attention';
import { buildRowView } from '../../components/operations/rowStatus';
import {
  summarizeLeaseRecoveries, RECOVERY_CATEGORY_LABELS, DEFAULT_RECOVERY_PREFS, type LeaseRecoverySummary, type RecoveryPrefs,
} from './recoveries';

/** The raw database facts the inbox is derived from. */
export interface InboxFacts {
  deals: Row[]; leases: Row[]; units: Row[]; payments: Row[]; increases: Row[]; recTerms: Row[]; recItems: Row[];
  recPrefs?: RecoveryPrefs;
}

/** NNN recovery roll-up per opted-in lease (empty for everyone else). */
export function leaseRecoverySummaries(f: Pick<InboxFacts, 'leases' | 'recTerms' | 'recItems' | 'recPrefs'>, now = new Date()): Map<string, LeaseRecoverySummary> {
  const today = now.toISOString().split('T')[0];
  const out = new Map<string, LeaseRecoverySummary>();
  for (const l of f.leases) {
    if (!l.track_recoveries) continue;
    out.set(l.id, summarizeLeaseRecoveries(l, f.recTerms.filter((t) => t.lease_id === l.id) as any, f.recItems.filter((i) => i.lease_id === l.id) as any, today, { leadDays: (f.recPrefs ?? DEFAULT_RECOVERY_PREFS).leadDays }));
  }
  return out;
}

/** One line for a lease's overdue NNN items. */
export const recoveryNoteFor = (summaries: Map<string, LeaseRecoverySummary>) => (leaseId: string): string => {
  const s = summaries.get(leaseId);
  if (!s || s.overdue === 0) return '';
  return `${s.overdue} NNN ${s.overdue === 1 ? 'item' : 'items'} overdue${s.next ? ` · ${RECOVERY_CATEGORY_LABELS[s.next.category]} due ${s.next.due_date}` : ''}`;
};

/**
 * The portfolio inbox as of now: the one list the bell and the Operations page both show. Same rules as `buildInboxItems`;
 * this only assembles its inputs from the raw facts for the current month.
 */
export function buildPortfolioInbox(f: InboxFacts, now = new Date()): InboxItem[] {
  const period = formatPeriodMonth(now);
  const ops = buildOperations({ deals: f.deals, leases: f.leases, units: f.units, payments: f.payments, increases: f.increases, scope: 'owned', entityId: 'all', dealId: 'all', activeDate: now, now });
  const summaries = leaseRecoverySummaries(f, now);
  const views = ops.rows.map((r) => {
    const pay = r.is_vacant ? undefined : f.payments.find((p) => p.lease_id === r.id && p.period_month === period);
    const view = buildRowView(r, pay, pay, f.increases, now, true);
    if (!view.vacant && (summaries.get(r.id)?.overdue ?? 0) > 0) view.attention.push('recovery');
    return view;
  });
  return buildInboxItems({
    deals: ops.scopedDeals, leaseRows: f.leases, units: f.units, payments: f.payments, views, rentRollLeases: ops.scopedLeases,
    currentPeriod: true, now, recoveryNote: recoveryNoteFor(summaries),
  });
}
