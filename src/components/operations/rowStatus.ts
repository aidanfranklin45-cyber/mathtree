import { escalationInfo, getDueInfo, type DueInfo, type EscalationInfo, type Row, type RentRollRow } from '../../lib/operations/rentRoll';

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';
export type AttentionKind = 'overdue' | 'escalation' | 'due_soon' | 'recovery';
export type StatusKey = 'paid' | 'overdue' | 'late' | 'snoozed' | 'due_today' | 'upcoming' | 'vacant';

/** Everything a rent-roll row needs to render, computed once so the table, action list and drawer agree. */
export interface RowView {
  row: RentRollRow;
  vacant: boolean;
  derived: boolean;
  payment?: Row;
  due: DueInfo | null;
  esc: EscalationInfo | null;
  isPaid: boolean;
  statusKey: StatusKey;
  statusLabel: string;
  tone: StatusTone;
  attention: AttentionKind[];
}

/** Every action a row can trigger; the page owns the implementations. */
export interface RowHandlers {
  pay: (row: RentRollRow) => void;
  snooze: (row: RentRollRow) => void;
  remind: (row: RentRollRow) => void;
  log: (row: RentRollRow) => void;
  escalate: (row: RentRollRow) => void;
  edit: (row: RentRollRow) => void;
  history: (row: RentRollRow) => void;
  addTenant: (dealId: string) => void;
}

const DUE_SOON_DAYS = 5;

/**
 * `payment` is the selected billing month's payment (drives paid/overdue/snoozed); `duePayment` is the current
 * calendar month's payment (drives the due-date countdown, which is always relative to today).
 */
export function buildRowView(
  row: RentRollRow,
  payment: Row | undefined,
  duePayment: Row | undefined,
  increases: Row[],
  now: Date,
  isCurrentPeriod: boolean,
): RowView {
  const derived = Boolean(row.is_derived);
  if (row.is_vacant) {
    return { row, vacant: true, derived, due: null, esc: null, isPaid: false, statusKey: 'vacant', statusLabel: 'Vacant', tone: 'muted', attention: [] };
  }

  const due = getDueInfo(row, duePayment, now);
  const esc = escalationInfo(row, increases, now);
  const isPaid = payment?.status === 'paid';
  const isSnoozed = Boolean(payment?.snooze_until && new Date(payment.snooze_until) >= now);

  let statusKey: StatusKey;
  let statusLabel: string;
  let tone: StatusTone;
  if (isPaid) { statusKey = 'paid'; statusLabel = 'Paid'; tone = 'ok'; }
  else if (payment?.status === 'overdue') { statusKey = 'overdue'; statusLabel = 'Overdue'; tone = 'bad'; }
  else if (isSnoozed) { statusKey = 'snoozed'; statusLabel = 'Snoozed'; tone = 'warn'; }
  else if (!isCurrentPeriod) { statusKey = 'upcoming'; statusLabel = 'Unpaid'; tone = 'warn'; }
  else if (due.state === 'overdue') { statusKey = 'overdue'; statusLabel = 'Overdue'; tone = 'bad'; }
  else if (due.state === 'late') { statusKey = 'late'; statusLabel = `${due.daysLate}d late`; tone = 'bad'; }
  else if (due.state === 'snoozed') { statusKey = 'snoozed'; statusLabel = 'Snoozed'; tone = 'warn'; }
  else if (due.state === 'due_today') { statusKey = 'due_today'; statusLabel = 'Due today'; tone = 'warn'; }
  else { statusKey = 'upcoming'; statusLabel = `Due in ${due.daysUntilNext}d`; tone = due.daysUntilNext <= DUE_SOON_DAYS ? 'warn' : 'info'; }

  const attention: AttentionKind[] = [];
  if (isCurrentPeriod) {
    if (statusKey === 'overdue' || statusKey === 'late') attention.push('overdue');
    if (esc.isScheduledDue) attention.push('escalation');
    if (statusKey === 'due_today' || (statusKey === 'upcoming' && due.daysUntilNext <= DUE_SOON_DAYS)) attention.push('due_soon');
  }

  return { row, vacant: false, derived, payment, due, esc, isPaid, statusKey, statusLabel, tone, attention };
}

/** One-line escalation note for the "Next" column, or null when there is nothing worth showing. */
export function escalationNote(v: RowView): { text: string; tone: StatusTone } | null {
  const esc = v.esc;
  if (!esc) return null;
  if (esc.isScheduledDue) return { text: 'Escalation due', tone: 'warn' };
  if (esc.nearestScheduled) return { text: `Escalation ${esc.nearestScheduled.effective_date} (${esc.scheduledValStr})`, tone: 'info' };
  if (esc.isUnscheduledReviewDue) return { text: 'Rent review due', tone: 'warn' };
  return null;
}

export const toneBadge: Record<StatusTone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  info: 'bg-slate-800 text-slate-300 border-slate-700',
  muted: 'bg-slate-800 text-slate-400 border-slate-700',
};

export const toneText: Record<StatusTone, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-300',
  bad: 'text-rose-400',
  info: 'text-cyan-300',
  muted: 'text-slate-500',
};
