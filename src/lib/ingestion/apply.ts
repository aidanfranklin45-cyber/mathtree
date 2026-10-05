/**
 * From parsed documents to a change the owner can accept. `proposeChanges` lines up what the documents say against what the deal already
 * states, one row per figure, with where it came from. `buildApplication` turns the rows the owner ticked into exactly what the deal save
 * takes: inputs to merge, top-level fields, and the record of which figures came from a document (`assumptionBasis`).
 *
 * Nothing here saves anything. The owner's tick is the only thing that lets a value through.
 */

import type { IntakeDocument } from './intake';
import { buildDealPatch, type DealPatch } from './toDealInputs';
import { reconcileBasis, TRACKED_INPUTS, type InputBasis } from '@engine/underwritingAssumptions';
import { ASSET_LABEL, deduceAsset, type WizardAsset } from './wizardMap';

export interface ProposedChange {
  key: string;
  label: string;
  /** What the deal states now, formatted for display; null when it states nothing. */
  current: string | null;
  proposed: string;
  how: string;
  reliability: 'executed' | 'reported' | 'projected';
  /** The same value, as the deal will store it. */
  value: unknown;
  /** The deal already states a different value for this: ticking it replaces the owner's figure. */
  replaces: boolean;
}

const LABELS: Record<string, string> = {
  purchasePrice: 'Purchase price', closingDate: 'Closing date', closingCosts: 'Closing costs', address: 'Address', city: 'City', state: 'State',
  zip: 'Zip', primaryApn: 'Parcel number (APN)', squareFeet: 'Square feet', unitCount: 'Unit count', leases: 'Tenants and leases',
  leaseType: 'Lease structure', loanAmount: 'Loan amount', downPaymentPercent: 'Down payment (%)', interestRate: 'Interest rate (%)',
  loanTermYears: 'Loan maturity (years)', amortizationYears: 'Amortization (years)', financingType: 'Rate type', interestOnlyYears: 'Interest-only (years)',
  ...TRACKED_INPUTS,
};

const humanize = (key: string): string => LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function formatValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (key === 'leases' && Array.isArray(v)) return `${v.length} tenant${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface Proposal {
  patch: DealPatch;
  changes: ProposedChange[];
}

export function proposeChanges(
  docs: IntakeDocument[],
  deal: { asset_class?: string | null; purchase_price?: number | null; inputs?: Record<string, any> | null },
  opts: { assetClass?: boolean } = {},
): Proposal {
  const existing = (deal.inputs ?? {}) as Record<string, any>;
  const price = Number(deal.purchase_price) > 0 ? Number(deal.purchase_price) : Number(existing.purchasePrice) > 0 ? Number(existing.purchasePrice) : null;
  const patch = buildDealPatch(docs, { purchasePrice: price, assetClass: deal.asset_class ?? undefined, existingInputs: existing });

  const changes: ProposedChange[] = [];
  for (const [key, value] of Object.entries(patch.patch)) {
    const prov = patch.provenance[key];
    const had = key === 'purchasePrice' ? (price ?? undefined) : existing[key];
    if (sameValue(had, value)) continue; // nothing to change
    const stated = had !== undefined && had !== null && had !== '' && !(Array.isArray(had) && had.length === 0);
    changes.push({
      key,
      label: humanize(key),
      current: stated ? formatValue(key, had) : null,
      proposed: formatValue(key, value),
      how: prov?.how ?? 'Read from the document',
      reliability: prov?.reliability ?? 'reported',
      value,
      replaces: stated,
    });
  }
  // A new project has to choose an asset class: when the documents point to one, say so first (the wizard switches to it when ticked)
  if (opts.assetClass) {
    const found = deduceAsset(docs);
    if (found && found.asset !== deal.asset_class) {
      changes.unshift({
        key: 'assetClass', label: 'Asset class', current: deal.asset_class ? ASSET_LABEL[deal.asset_class as WizardAsset] ?? null : null,
        proposed: ASSET_LABEL[found.asset], how: found.why, reliability: 'projected', value: found.asset, replaces: false,
      });
    }
  }
  return { patch, changes };
}

export interface Application {
  inputsPatch: Record<string, unknown>;
  top: { purchase_price?: number };
}

/** What to save for the ticked rows. A figure read from a document is recorded as such; the rest of the deal is untouched. */
export function buildApplication(
  deal: { inputs?: Record<string, any> | null },
  proposal: Proposal,
  ticked: Set<string>,
): Application {
  const inputsPatch: Record<string, unknown> = {};
  const basis: Record<string, InputBasis> = {};
  for (const c of proposal.changes) {
    if (!ticked.has(c.key)) continue;
    inputsPatch[c.key] = c.value;
    if (proposal.patch.basis[c.key]) basis[c.key] = proposal.patch.basis[c.key];
  }
  const existing = (deal.inputs ?? {}) as Record<string, any>;
  if (Object.keys(inputsPatch).length > 0) {
    inputsPatch.assumptionBasis = reconcileBasis({ ...(existing.assumptionBasis ?? {}), ...basis }, { ...existing, ...inputsPatch });
  }
  const top: Application['top'] = {};
  if (ticked.has('purchasePrice') && typeof inputsPatch.purchasePrice === 'number') top.purchase_price = inputsPatch.purchasePrice;
  return { inputsPatch, top };
}

/** Names the deal already knows (tenants and units), so the parser can hide them wherever they appear in a document. */
export function knownTenantNames(deal: { inputs?: Record<string, any> | null }): string[] {
  const leases = (deal.inputs?.leases ?? []) as Array<Record<string, any>>;
  const names = new Set<string>();
  for (const l of leases) {
    const n = String(l?.tenantName ?? l?.tenant ?? '').trim();
    if (n) names.add(n);
  }
  return [...names];
}
