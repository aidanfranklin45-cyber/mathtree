import type { DealInputs, DealRecord } from '../math/types';
import type { BaselineRow } from '../baselines/core';

/**
 * The real acquisition baseline for the compare studio (owned deals only).
 *
 * When a property becomes Owned, its underwriting inputs are frozen in `deal_baselines.inputs_snapshot`. The compare studio
 * re-runs those frozen inputs through the same engine as the live model, so the two columns differ only by what the owner
 * changed since buying. (The stored record also keeps headline figures from the engine of the day; they are never rewritten.)
 */
export type BaselineSnapshot = Pick<BaselineRow, 'purchase_price' | 'inputs_snapshot' | 'captured_at' | 'projected_irr'>;

/** The deal as it was underwritten at acquisition: same identity, frozen inputs. */
export function dealFromBaseline(deal: DealRecord, row: BaselineSnapshot): DealRecord {
  const snap = (row.inputs_snapshot ?? {}) as Record<string, any>;
  const price = Number(row.purchase_price) || Number(snap.purchasePrice) || Number(deal.purchase_price) || 0;
  const inputs = {
    ...snap,
    purchasePrice: price,
    leases: Array.isArray(snap.leases) ? snap.leases : [],
    parcels: [],
    assessorData: {},
  } as unknown as DealInputs;
  return { ...deal, purchase_price: price, inputs };
}

/** Column heading, with the capture date. */
export function baselineHeading(row: Pick<BaselineRow, 'captured_at'>): string {
  const t = Date.parse(row.captured_at);
  if (Number.isNaN(t)) return 'Acquisition Baseline';
  const d = new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return `Acquisition Baseline (${d})`;
}

/**
 * A baseline keeps the IRR the engine of the day produced. If today's engine gives a different IRR for the same frozen inputs,
 * say so rather than let the two figures disagree silently.
 */
export function baselineEngineDriftNote(row: Pick<BaselineRow, 'projected_irr'>, recomputedIrr: number): string | null {
  if (row.projected_irr === null || row.projected_irr === undefined) return null;
  const frozen = Number(row.projected_irr);
  if (Number.isNaN(frozen) || Math.abs(frozen - recomputedIrr) < 0.1) return null;
  return `The Acquisition Baseline re-runs the inputs frozen at acquisition through today's engine (${recomputedIrr.toFixed(1)}% IRR). The record kept at the time showed ${frozen.toFixed(1)}%, so the engine has changed since.`;
}
