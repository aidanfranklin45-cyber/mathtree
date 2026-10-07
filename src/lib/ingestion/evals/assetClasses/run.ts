/**
 * Runs a set of documents through the wizard's own pure steps (the reader's answer, the checks, the proposed figures, the contracts, the lines of
 * the expense ratio) and then through the engine, as the owner would after answering every question with the document's figure and entering a
 * loan. What comes out is what the bench's answer keys are written against.
 */

import { coerceIntake } from '@engine/intakeParse';
import { suggestedStartingPoints } from '@engine/underwritingAssumptions';
import { setAssumptionDefaults } from '../../../engine/assumptionDefaults';
import { computeDealMetrics, missingInputsFor } from '../../../engine/compute';
import { attachVariances, proposeChanges, type ProposedChange } from '../../apply';
import { evaluateContracts } from '../../contracts';
import { expectedFor } from '../../expected';
import { groundIntake, traceDocument, type TraceRow } from '../../lineage';
import { expectedCosts, ratioBreakdown, ratioChecks } from '../../ratioBreakdown';
import { documentChecks, validateIntake } from '../../validate';
import { assetFromDocs } from '../../wizardMap';
import type { BenchDocument } from './documents';

/** The owner's investor profile for the bench: the conventions a new profile starts with, self-managed. */
export function benchProfile() {
  const p = suggestedStartingPoints(null);
  for (const key of Object.keys(p.assets) as Array<keyof typeof p.assets>) p.assets[key] = { ...p.assets[key], usesPropertyManager: false };
  return p;
}

/** A loan the owner would enter: the documents give none, and the engine will not invent one. */
export const BENCH_LOAN = { downPaymentPercent: 30, interestRate: 6.5, amortizationYears: 30 };

export function runBench(docs: BenchDocument[]) {
  setAssumptionDefaults({ assumptions: benchProfile(), discountRate: 8, exitYear: 10 });
  const intakes = docs.map((d) => groundIntake(coerceIntake(d.type, d.answer), d.text));
  const asset = assetFromDocs(intakes);
  // As in the wizard: the form starts on its default class (commercial), and the documents point to another
  const deal = { asset_class: 'commercial', purchase_price: null as number | null, inputs: {} as Record<string, unknown> };
  const proposal = proposeChanges(intakes, deal, { assetClass: true, manager: { uses: false } });
  attachVariances(proposal, expectedFor(proposal, deal));
  const contracts = evaluateContracts(proposal, intakes);
  const lineage: TraceRow[] = intakes.flatMap((d, i) => traceDocument(d, docs[i].text, docs[i].name));
  const checks = intakes.flatMap((d) => documentChecks(d));
  const issues = intakes.flatMap((d) => validateIntake(d));

  // What the owner has after answering every question with the document's figure (the first, where several are offered) and entering a loan
  const patch: Record<string, unknown> = { ...proposal.patch.patch };
  const rent = proposal.changes.find((c) => c.key === 'grossRentPerMonth');
  const inputs: Record<string, unknown> = { ...patch, ...BENCH_LOAN, closingDate: '2026-12-01', purchasePrice: patch.purchasePrice };
  const price = Number(inputs.purchasePrice) || null;
  const engineDeal = { asset_class: asset ?? 'commercial', purchase_price: price, inputs };
  const missing = missingInputsFor(engineDeal as never).map((m) => m.key);
  let metrics: { noi: number; capRate: number; dscr: number | string } | null = null;
  let engineError: string | null = null;
  if (missing.length === 0) {
    try {
      const m = computeDealMetrics(engineDeal as never);
      metrics = { noi: m.noi, capRate: m.capRate, dscr: m.dscr };
    } catch (e) { engineError = e instanceof Error ? e.message : String(e); }
  }

  // The lines of the expense ratio, as the card shows them
  const ratioType = (proposal.patch.provenance as Record<string, { documentType?: string }>).expenseRatio?.documentType;
  const usedDocs = docs.filter((d) => d.type === ratioType).map((d) => d.name);
  // The rent the ratio is over: the figure itself, or what the leases pay when the rent came from a rent roll
  const leaseRent = Array.isArray(patch.leases) ? (patch.leases as Array<{ monthlyRent?: number }>).reduce((s, l) => s + (Number(l.monthlyRent) || 0), 0) : 0;
  const monthlyRent = Number(patch.grossRentPerMonth) || leaseRent;
  const breakdown = ratioBreakdown(lineage.filter((r) => usedDocs.length === 0 || usedDocs.includes(r.document)), monthlyRent > 0 ? monthlyRent * 12 : null);
  const lineChecks = ratioChecks({ rows: lineage, usedDocuments: usedDocs, checks, expected: expectedCosts(asset, inputs.leaseType as string | undefined), usedType: ratioType });

  const asks = proposal.changes.filter((c: ProposedChange) => c.unsure && !c.waitingOn).map((c) => c.key).sort();
  return { intakes, asset, proposal, contracts, lineage, checks, issues, inputs, missing, metrics, engineError, breakdown, lineChecks, asks, rent, patch };
}
