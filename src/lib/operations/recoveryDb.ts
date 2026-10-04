/** Supabase writes for NNN recovery tracking. The pure rules live in recoveries.ts; this file only talks to the database. */

import { supabase } from '../supabase/client';
import { missingItems, localTodayIso, isItemComplete, type RecoveryItem, type RecoveryTerm } from './recoveries';

type Row = Record<string, any>;

const todayIso = () => localTodayIso();
const shiftDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};

/** Items are scheduled this far ahead and never backfilled further back than this. */
export const SCHEDULE_AHEAD_DAYS = 14;
export const SCHEDULE_BACKFILL_DAYS = 60;

/**
 * Creates any scheduled items that don't exist yet for the given terms. Idempotent (unique on term + due date), so the
 * page and the daily monitor can both call it. Returns how many rows were created.
 */
export async function syncRecoveryItems(terms: Row[], items: Row[], aheadDays: number = SCHEDULE_AHEAD_DAYS): Promise<number> {
  const today = todayIso();
  const missing = missingItems(terms as RecoveryTerm[], items as RecoveryItem[], shiftDays(today, aheadDays), shiftDays(today, -SCHEDULE_BACKFILL_DAYS));
  if (missing.length === 0) return 0;
  const termById = new Map(terms.map((t) => [t.id, t]));
  const rows = missing.map((m) => {
    const t = termById.get(m.term_id)!;
    return { user_id: t.user_id, term_id: t.id, lease_id: t.lease_id, deal_id: t.deal_id, category: t.category, due_date: m.due_date, amount_expected: m.amount_expected ?? null };
  });
  const { data, error } = await supabase.from('lease_recovery_items')
    .upsert(rows, { onConflict: 'term_id,due_date', ignoreDuplicates: true }).select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Marks an item done (or undoes it). Reimbursements record a paid date; direct-pay items record the verification. */
export async function setItemDone(item: Row, mode: 'direct_pay' | 'reimburse', done: boolean, amountActual?: number | null): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (done) {
    patch.paid_date = todayIso();
    patch.verified = true;
    patch.verified_date = todayIso();
    if (amountActual != null) patch.amount_actual = amountActual;
  } else {
    patch.paid_date = null;
    patch.verified = false;
    patch.verified_date = null;
  }
  const { error } = await supabase.from('lease_recovery_items').update(patch as never).eq('id', item.id);
  if (error) throw new Error(error.message);
}

export { isItemComplete };
