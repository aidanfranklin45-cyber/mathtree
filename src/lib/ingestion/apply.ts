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

/** Below this the reader's own confidence in a figure is too low to apply it without the owner checking the document. */
export const LOW_CONFIDENCE = 0.75;

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
  /** Other inputs that are the same figure in another form (rent per year, per unit), applied together with this one. */
  also?: Array<{ key: string; value: unknown }>;
  /** The deal already states a different value for this: ticking it replaces the owner's figure. */
  replaces: boolean;
  /** How sure the reader was (0 to 1), and the quote it read the figure from. */
  confidence?: number;
  evidence?: string;
  /** The reader was not sure of this figure: it is not applied until the owner has checked the document. */
  unsure?: boolean;
  /** The document's figure is far from what the owner's own assumption would be: the owner is asked which to use. */
  variance?: Variance;
}

export interface Variance {
  /** The owner's assumption for this figure, as the deal would store it, and formatted. */
  expected: number;
  expectedText: string;
  /** The owner's reason for it, when they gave one. */
  why: string;
  /** How far the document's figure is from the assumption, in percent of the assumption. */
  percent: number;
  higher: boolean;
}

const LABELS: Record<string, string> = {
  purchasePrice: 'Purchase price', closingDate: 'Closing date', closingCosts: 'Closing costs', address: 'Address', city: 'City', state: 'State',
  otherIncomeAnnual: 'Other income (a year)', zip: 'Zip', primaryApn: 'Parcel number (APN)', squareFeet: 'Square feet', unitCount: 'Unit count', leases: 'Tenants and leases',
  leaseType: 'Lease structure', loanAmount: 'Loan amount', downPaymentPercent: 'Down payment (%)', interestRate: 'Interest rate (%)',
  loanTermYears: 'Loan maturity (years)', amortizationYears: 'Amortization (years)', financingType: 'Rate type', interestOnlyYears: 'Interest-only (years)',
  ...TRACKED_INPUTS,
};

const humanize = (key: string): string => LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** Figures the form derives from each other: listing them as "already filled" would only repeat the rent. */
const DERIVED_QUIET = new Set(['monthlyRent', 'grossRentAnnual']);

/**
 * The 5% rule. A figure a document gives that the owner's investor profile also has a standard for (vacancy, expense ratio, taxes, insurance,
 * reserves, closing costs, and so on) is compared with that standard. Within 5% of the standard, the document's figure is underwritten as the
 * document states it, without asking. More than 5% away, the owner is asked which to use: the document's figure, their own assumption, or a number
 * for this property. The 5% is of the owner's standard, so a 4% vacancy standard accepts a document's 4.2% and asks about a 5%.
 */
export const VARIANCE_TOLERANCE = 0.05;

/** The rule in words, for the owner to read and for the record saved with the project. */
export const VARIANCE_DISCLOSURE = "Where a document's figure differs from one of your own standards by 5% or less, the document's figure is underwritten as the document states it. A difference of more than 5% is put to you to decide, so you choose which figure is used.";
/** What the owner's profile would use for each figure, for a property of the documents' size, price and lease structure. */
export interface Expected {
  filled: Record<string, number>;
  basis: Record<string, InputBasis>;
}

/** Marks the rows whose figure is more than 5% away from the owner's own assumption. Changes the rows in place. */
export function attachVariances(proposal: Proposal, expected: Expected): void {
  for (const c of proposal.changes) {
    const mine = expected.filled[c.key];
    const doc = Number(c.value);
    if (mine === undefined || !(mine >= 0) || !Number.isFinite(doc)) continue; // the owner has no standard for this figure, or the document gave no number
    const gap = doc - mine;
    // A standard of zero has no percentage to measure against: any figure other than zero is a difference worth asking about
    if (mine > 0 ? Math.abs(gap) / mine <= VARIANCE_TOLERANCE : Math.abs(gap) < 1e-9) continue;
    c.variance = {
      expected: mine, expectedText: formatValue(c.key, mine), why: expected.basis[c.key]?.rationale ?? '',
      percent: mine > 0 ? Math.round((Math.abs(gap) / mine) * 100) : 100, higher: gap > 0,
    };
  }
}

/** What the owner chose for a flagged figure, when not the document's: their own assumption, or a number typed for this property. */
export type Choice = { use: 'mine' } | { use: 'custom'; value: number };

/** The proposal with the owner's choices carried out. A choice only applies to a row that was flagged. */
export function applyChoices(proposal: Proposal, choices: Record<string, Choice>, expected: Expected): Proposal {
  if (Object.keys(choices).length === 0) return proposal;
  const basis = { ...proposal.patch.basis };
  const changes = proposal.changes.map((c) => {
    const choice = choices[c.key];
    if (!choice || !c.variance) return c;
    if (choice.use === 'mine') {
      if (expected.basis[c.key]) basis[c.key] = expected.basis[c.key];
      return { ...c, value: c.variance.expected, proposed: c.variance.expectedText, how: `Your own assumption${c.variance.why ? `: ${c.variance.why}` : ''}`, reliability: 'executed' as const };
    }
    if (!Number.isFinite(choice.value) || choice.value < 0) return c;
    basis[c.key] = { source: 'owner', label: TRACKED_INPUTS[c.key] ?? humanize(c.key), value: choice.value, rationale: 'Entered by you for this property' };
    return { ...c, value: choice.value, proposed: formatValue(c.key, choice.value), how: 'The number you entered for this property', reliability: 'executed' as const };
  });
  return { ...proposal, changes, patch: { ...proposal.patch, basis } };
}

/** Rent figures that are the same number in another form: shown as one row. */
const RENT_FORMS = new Set(['monthlyRent', 'grossRentAnnual', 'monthlyRentPerUnit']);

const PLAIN_NUMBER = new Set(['yearBuilt', 'taxYear']);

/** An assumption of the owner's, with its unit: a percent, years, or dollars a year. */
const PERCENT_KEYS = new Set(['vacancyRate', 'expenseRatio', 'rentGrowth', 'expenseGrowth', 'targetCapRate', 'appreciationRate', 'sellingCostPercent', 'discountRate', 'capexReservePercent', 'payrollMarketingPercent', 'managementFeePercent']);
export function assumptionText(key: string, value: number): string {
  if (PERCENT_KEYS.has(key)) return `${value}%`;
  if (key === 'exitYear') return `${value} years`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${key === 'closingCosts' ? '' : ' a year'}`;
}

export function formatValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (key === 'leases' && Array.isArray(v)) return `${v.length} tenant${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'number' && PLAIN_NUMBER.has(key)) return String(v); // a year is not a quantity: no thousands separator
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface Proposal {
  patch: DealPatch;
  changes: ProposedChange[];
  /** Figures the documents state that the property (or form) already holds, so there is nothing to change. Shown so a repeat read is not a mystery. */
  unchanged: Array<{ key: string; label: string; value: string }>;
}

export function proposeChanges(
  docs: IntakeDocument[],
  deal: { asset_class?: string | null; purchase_price?: number | null; inputs?: Record<string, any> | null },
  opts: { assetClass?: boolean; manager?: { uses: boolean | null; fee?: number } } = {},
): Proposal {
  const existing = (deal.inputs ?? {}) as Record<string, any>;
  const price = Number(deal.purchase_price) > 0 ? Number(deal.purchase_price) : Number(existing.purchasePrice) > 0 ? Number(existing.purchasePrice) : null;
  const patch = buildDealPatch(docs, { purchasePrice: price, assetClass: deal.asset_class ?? undefined, existingInputs: existing, manager: opts.manager });

  const changes: ProposedChange[] = [];
  const unchanged: Proposal['unchanged'] = [];
  for (const [key, value] of Object.entries(patch.patch)) {
    const prov = patch.provenance[key];
    const had = key === 'purchasePrice' ? (price ?? undefined) : existing[key];
    if (sameValue(had, value)) { unchanged.push({ key, label: humanize(key), value: formatValue(key, value) }); continue; } // nothing to change
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
      ...(prov?.confidence !== undefined ? { confidence: prov.confidence } : {}),
      ...(prov?.evidence ? { evidence: prov.evidence } : {}),
      ...(prov?.confidence !== undefined && prov.confidence < LOW_CONFIDENCE && !stated ? { unsure: true } : {}),
    });
  }
  // One address, shown once: street, city, state and zip are one line. A form that already holds this address is not asked about it again.
  const addr = changes.find((c) => c.key === 'address');
  if (addr) {
    const parts = changes.filter((c) => ['city', 'state', 'zip'].includes(c.key));
    const pick = (k: string) => String(parts.find((c) => c.key === k)?.value ?? '');
    const tail = [pick('city'), [pick('state'), pick('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const composed = tail ? `${addr.value}, ${tail}` : String(addr.value);
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const held = typeof existing.address === 'string' ? existing.address : '';
    const drop = (cs: ProposedChange[]) => cs.forEach((c) => changes.splice(changes.indexOf(c), 1));
    if (held && norm(held).startsWith(norm(String(addr.value)))) {
      unchanged.push({ key: 'address', label: 'Address', value: held });
      drop([addr, ...parts]);
    } else {
      addr.also = parts.map((c) => ({ key: c.key, value: c.value }));
      addr.proposed = composed;
      drop(parts);
    }
  }
  // One rent, shown once: the monthly, yearly and per-unit forms are the same figure and are applied together
  const rent = changes.find((c) => c.key === 'grossRentPerMonth');
  if (rent) {
    const parts = changes.filter((c) => RENT_FORMS.has(c.key));
    const annual = parts.find((c) => c.key === 'grossRentAnnual');
    const perUnit = parts.find((c) => c.key === 'monthlyRentPerUnit');
    rent.also = parts.map((c) => ({ key: c.key, value: c.value }));
    rent.label = 'Rent';
    rent.proposed = `${formatValue('grossRentPerMonth', rent.value)} a month` + (annual ? ` (${formatValue('grossRentAnnual', annual.value)} a year` : '') + (perUnit ? `${annual ? ', ' : ' ('}${formatValue('monthlyRentPerUnit', perUnit.value)} a unit` : '') + (annual || perUnit ? ')' : '');
    for (const c of parts) changes.splice(changes.indexOf(c), 1);
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
  return { patch, changes, unchanged: unchanged.filter((u) => !DERIVED_QUIET.has(u.key)) };
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
    for (const a of c.also ?? []) inputsPatch[a.key] = a.value;
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
