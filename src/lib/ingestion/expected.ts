import { resolveProfileAssumptions } from '../engine/compute';
import type { Expected, Proposal } from './apply';

/**
 * What the owner's investor profile would use for the property the documents describe, to compare the documents' figures with. A new project's
 * form starts on a default asset class, so when the documents point to a different one (an apartment building, say) the standards of THAT class
 * are the ones to compare with, not the form's.
 */
export function expectedFor(proposal: Proposal, deal: { asset_class?: string | null; purchase_price?: number | null; inputs?: Record<string, any> | null }): Expected {
  const p = proposal.patch.patch as Record<string, any>;
  const own = (deal.inputs ?? {}) as Record<string, any>;
  const pointedTo = proposal.changes.find((c) => c.key === 'assetClass')?.value;
  const assetClass = typeof pointedTo === 'string' ? pointedTo : deal.asset_class ?? undefined;
  return resolveProfileAssumptions({
    asset_class: assetClass,
    purchase_price: Number(p.purchasePrice ?? deal.purchase_price) || undefined,
    inputs: {
      purchasePrice: p.purchasePrice ?? own.purchasePrice, unitCount: p.unitCount ?? own.unitCount, leaseType: p.leaseType ?? own.leaseType,
      gla: p.squareFeet ?? own.gla ?? own.squareFeet, taxableValue: own.taxableValue, totalAssessedValue: own.totalAssessedValue,
    },
  } as any);
}
