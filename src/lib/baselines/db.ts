import { supabase } from '../supabase/client';
import type { DealRecord } from '../math/types';
import { BASELINE_TYPE, buildBaselineDraft, type BaselineRow, type LeaseLite, type PaymentLite } from './core';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getInitialBaseline(dealId: string): Promise<BaselineRow | null> {
  const { data, error } = await supabase
    .from('deal_baselines')
    .select('*')
    .eq('deal_id', dealId)
    .eq('baseline_type', BASELINE_TYPE)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as BaselineRow;
}

export type EnsureResult = 'created' | 'exists' | 'skipped' | 'error';

/**
 * Freeze the pro-forma of an owned deal the first time it is needed (when it becomes Owned, or on first open of an
 * owned deal that has none). Only the deal's owner captures one; demo, shared and prospect deals are skipped.
 * Never overwrites: an existing baseline is left exactly as it was.
 */
export async function ensureBaseline(
  deal: Pick<DealRecord, 'id' | 'status' | 'asset_class' | 'purchase_price' | 'inputs' | 'user_id' | 'is_demo' | 'is_shared'>,
): Promise<EnsureResult> {
  try {
    if (deal.status !== 'owned' || deal.is_demo || deal.is_shared || !UUID.test(deal.id)) return 'skipped';
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid || (deal.user_id && deal.user_id !== uid)) return 'skipped';

    if (await getInitialBaseline(deal.id)) return 'exists';

    const draft = buildBaselineDraft(deal, uid);
    const { error } = await supabase.from('deal_baselines').insert(draft as any);
    if (error) throw error;
    return 'created';
  } catch (err) {
    console.warn('[baselines] could not capture baseline:', err);
    return 'error';
  }
}

/** Marks an archived baseline. The table keeps one live baseline per deal; older ones are relabelled, never edited or deleted. */
export const SUPERSEDED_PREFIX = 'superseded_';

/**
 * Deliberate owner action: make `deal`'s current assumptions the baseline (today's model, or a scenario the owner adopts by
 * passing the deal with that scenario's inputs applied) WITHOUT losing the old baseline.
 *
 * A baseline's content is frozen by a database trigger (inputs, projections, price and capture date cannot be edited), but its
 * type label can change, so the previous baseline is relabelled `superseded_<time>` and kept as history, then the new one is
 * inserted. If the insert fails the previous baseline is put back, so a failure never leaves the deal with none.
 */
export async function replaceBaseline(
  deal: Pick<DealRecord, 'id' | 'status' | 'asset_class' | 'purchase_price' | 'inputs' | 'user_id' | 'is_demo' | 'is_shared'>,
): Promise<EnsureResult> {
  try {
    if (deal.status !== 'owned' || deal.is_demo || deal.is_shared || !UUID.test(deal.id)) return 'skipped';
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid || (deal.user_id && deal.user_id !== uid)) return 'skipped';

    const previous = await getInitialBaseline(deal.id);
    if (previous) {
      const { error: archiveErr } = await supabase
        .from('deal_baselines')
        .update({ baseline_type: `${SUPERSEDED_PREFIX}${Date.now()}` } as any)
        .eq('id', previous.id);
      if (archiveErr) throw archiveErr;
    }

    const draft = buildBaselineDraft(deal, uid);
    const { error: insertErr } = await supabase.from('deal_baselines').insert(draft as any);
    if (insertErr) {
      if (previous) await supabase.from('deal_baselines').update({ baseline_type: BASELINE_TYPE } as any).eq('id', previous.id);
      throw insertErr;
    }
    return 'created';
  } catch (err) {
    console.warn('[baselines] could not replace the baseline:', err);
    return 'error';
  }
}

/** The Deal Studio's Re-baseline: capture today's pro-forma as the baseline (the previous one is kept in history). */
export async function rebaseline(
  deal: Pick<DealRecord, 'id' | 'status' | 'asset_class' | 'purchase_price' | 'inputs' | 'user_id' | 'is_demo' | 'is_shared'>,
): Promise<EnsureResult> {
  return replaceBaseline(deal);
}

/** Actuals for the comparison: contractual rent from the rent roll and what was collected. Facts only. */
export async function loadActuals(dealId: string, sinceYear: number): Promise<{ leases: LeaseLite[]; payments: PaymentLite[] }> {
  const [leases, payments] = await Promise.all([
    supabase.from('leases').select('monthly_rent,is_active').eq('deal_id', dealId),
    supabase
      .from('rent_payments')
      .select('period_month,amount_due,amount_paid,status')
      .eq('deal_id', dealId)
      .gte('period_month', `${sinceYear}-01-01`),
  ]);
  return {
    leases: (leases.data as LeaseLite[] | null) ?? [],
    payments: (payments.data as PaymentLite[] | null) ?? [],
  };
}
