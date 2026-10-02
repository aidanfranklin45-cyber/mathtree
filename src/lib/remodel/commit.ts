import type { DealInputs, DealRecord } from '../math/types';
import { applyRemodel, getRemodelPlans, type RemodelPlan } from './plan';

type CommitDeal = Pick<DealRecord, 'asset_class' | 'inputs' | 'purchase_price' | 'assetType'>;

/** The remodel that is actually happening (or happened) on a deal, as recorded in its inputs. */
export interface CommittedRemodel {
  committedAt: string; // ISO timestamp
  plan: RemodelPlan; // kept so it can be moved back to the plans
}

export const getCommittedRemodel = (deal: Pick<DealRecord, 'inputs'>): CommittedRemodel | null => {
  const c = (deal.inputs as Record<string, any> | undefined)?.remodelCommitted;
  return c && typeof c === 'object' && c.plan ? (c as CommittedRemodel) : null;
};

export type CommitResult = { ok: true; patch: Partial<DealInputs> } | { ok: false; reason: string };

/**
 * Make a plan real: the live deal's `remodel` is set, so every page now includes the remodel's cost, downtime and rent. The
 * engine places it by its own dates, so a remodel that already happened is modelled in the right years. The plan leaves the
 * plan list. The Acquisition Baseline is untouched, so Compare shows exactly what the remodel changed.
 * One remodel can be committed at a time.
 */
export function commitRemodelPatch(deal: CommitDeal, plan: RemodelPlan, now: Date = new Date()): CommitResult {
  const inputs = (deal.inputs ?? {}) as Record<string, any>;
  if (inputs.remodel) return { ok: false, reason: 'A remodel is already committed on this property. Move it back to the plans first.' };
  const applied = applyRemodel(deal, plan).remodel;
  if (!applied || !(Number(applied.cost) > 0)) return { ok: false, reason: 'The plan needs a cost before it can be committed.' };
  return {
    ok: true,
    patch: {
      remodel: applied,
      remodelCommitted: { committedAt: now.toISOString(), plan } satisfies CommittedRemodel,
      remodelPlans: getRemodelPlans(deal).filter((p) => p.id !== plan.id),
    },
  };
}

/** Undo a commit: the live numbers lose the remodel and the plan returns to the list. */
export function uncommitRemodelPatch(deal: CommitDeal): CommitResult {
  const committed = getCommittedRemodel(deal);
  if (!committed) return { ok: false, reason: 'No remodel is committed on this property.' };
  return {
    ok: true,
    patch: {
      remodel: undefined,
      remodelCommitted: undefined,
      remodelPlans: [...getRemodelPlans(deal).filter((p) => p.id !== committed.plan.id), committed.plan],
    },
  };
}
