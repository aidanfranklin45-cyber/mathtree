/**
 * A figure the form leaves blank is not necessarily one the engine goes without: the owner's profile (or, before they have set one, the labelled
 * starting points) fills it live when the property does not state its own. The owner should see that, with where it comes from, instead of a
 * blank field that quietly has a number behind it. Read from the same function the engine uses, so what is shown is what is applied.
 */

import { isStartingPointReason } from '@engine/underwritingAssumptions';
import { resolveProfileAssumptions } from '../engine/compute';

/** The percentage assumptions the engine can fill from the profile, by the worksheet row they belong to. */
const LIVE_PERCENT = new Set(['vacancyRate', 'rentGrowth', 'expenseGrowth', 'appreciationRate', 'targetCapRate', 'sellingCostPercent']);

export interface LiveAssumption { value: number; text: string }

type Deal = { asset_class?: string | null; purchase_price?: number | null; inputs?: Record<string, any> | null };

export function liveAssumption(deal: Deal, key: string): LiveAssumption | null {
  if (!LIVE_PERCENT.has(key)) return null;
  let resolved: ReturnType<typeof resolveProfileAssumptions>;
  try { resolved = resolveProfileAssumptions({ asset_class: deal.asset_class ?? undefined, purchase_price: deal.purchase_price ?? undefined, inputs: deal.inputs ?? {} } as any); } catch { return null; }
  const value = resolved.filled[key];
  if (value === undefined) return null;
  const why = resolved.basis[key]?.rationale;
  return { value, text: `Not entered here, so ${value}% applies. Source: ${why ? `${isStartingPointReason(why) ? 'starting point, ' : ''}${why.replace(/\.$/, '')}` : 'your investor profile'}. Enter a figure to use your own for this property.` };
}
