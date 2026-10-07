/**
 * Micro-contracts: for each assumption, the candidates we hold (the document's figure, the owner's standard), objective checks that pass or
 * fail on their own, and the outcome they decide: `auto` (goes in without a question), `ask` (the owner decides) or `missing` (nothing to go on).
 * Whatever failed is named, so "why was I asked?" always has an answer. The owner's own entry is not judged here: it beats a document.
 *
 * This reads what `proposeChanges` produced (figure by figure) and the document's own lines (for the decisions that never become a figure: a
 * management fee the engine charges separately, reimbursements the engine nets off the costs). Nothing here changes a number.
 */

import { val, type IntakeDocument } from './intake';
import type { ProposedChange, Proposal } from './apply';
import { LOW_CONFIDENCE } from './apply';

export type Outcome = 'auto' | 'ask';

export interface Reason {
  /** The check that failed, in a few words. */
  check: string;
  /** Why this check failing means the owner is asked, in a few plain words. */
  because: string;
  detail: string;
}

/** A way the owner can settle a question that has no number of its own. `set` writes one answer into the form. */
export interface Option {
  id: string;
  label: string;
  set?: { key: string; value: string };
}

export interface ContractResult {
  key: string;
  label: string;
  outcome: Outcome;
  /** Every failed check. Empty when the outcome is auto. */
  reasons: Reason[];
  /** The checks that were run, whether they passed or not, so the record shows what was tested. */
  checksRun: string[];
  /** For a decision with no figure of its own: the ways to settle it. */
  options?: Option[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Checks on a figure `proposeChanges` produced. Each returns a reason when it fails. */
const FIGURE_CHECKS: Array<{ name: string; because: string; run: (c: ProposedChange) => string | null }> = [
  { name: 'The sources agree', because: 'the documents give more than one figure', run: (c) => (c.alternatives && c.alternatives.length > 0 ? `The documents give more than one figure: ${[c.proposed, ...c.alternatives.map((a) => a.text)].join(' or ')}` : null) },
  { name: 'The reader was sure', because: 'the reader was not sure of it', run: (c) => (c.confidence !== undefined && c.confidence < LOW_CONFIDENCE && !c.chosen ? `The reader was ${Math.round(c.confidence * 100)}% sure` : null) },
  { name: 'It is near your own standard', because: 'it is more than 5% from your own standard', run: (c) => (c.variance ? `${c.variance.percent}% ${c.variance.higher ? 'above' : 'below'} your standard of ${c.variance.expectedText}` : null) },
  { name: 'The figures it depends on are settled', because: 'it depends on a figure you have not decided yet', run: (c) => (c.waitingOn ? `It depends on ${c.waitingOn === 'grossRentPerMonth' ? 'the rent' : c.waitingOn}, which is still a question` : null) },
];

/** A decision that is the owner's even when the document states a figure. `when` finds it in the document; it returns what to tell the owner. */
interface LineContract {
  key: string;
  label: string;
  check: string;
  because: string;
  when: (docs: IntakeDocument[], proposal: Proposal) => string | null;
  options: Option[];
}

const lines = (docs: IntakeDocument[], side: 'income' | 'expenses') =>
  docs.flatMap((d) => (side in d ? ((d as unknown as Record<string, any[]>)[side] ?? []) : []))
    .map((l) => ({ label: String(val(l.label) ?? ''), category: String(val(l.category) ?? ''), amount: Number(val(l.amount)) }))
    .filter((l) => Number.isFinite(l.amount));

const sum = (ls: Array<{ amount: number }>) => ls.reduce((s, l) => s + l.amount, 0);

/** The reader sorts lines by what it thinks they are; a slip must not hide a decision, so the line's own name counts as well. */
/** A document's own average rent is rounded to the dollar, so the rent it implies is compared to within this share. */
const RENT_AVERAGE_TOLERANCE = 0.01;
/** Physical occupancy and the vacancy line differ by more than this many points before the owner is asked (credit loss and concessions explain a little). */
const OCCUPANCY_TOLERANCE_POINTS = 3;
const MANAGEMENT_LABEL = /manage|mgmt|mgt/i;
const REIMBURSEMENT_LABEL = /rubs|reimburs|utility billing|recover/i;

export const LINE_CONTRACTS: LineContract[] = [
  {
    key: 'managementFee',
    label: 'Management fee',
    check: 'A management charge in the document is your decision',
    because: 'the document charges for management, which is your decision',
    options: [
      { id: 'self', label: 'I manage it', set: { key: 'manageProperty', value: 'false' } },
      { id: 'manager', label: 'I hire a manager', set: { key: 'manageProperty', value: 'true' } },
    ],
    when: (docs) => {
      const m = lines(docs, 'expenses').filter((l) => (l.category === 'management' || MANAGEMENT_LABEL.test(l.label)) && l.amount > 0);
      return m.length ? `The document charges ${money(sum(m))} a year for management.` : null;
    },
  },
  {
    key: 'utilityReimbursements',
    label: 'Utility reimbursements',
    check: 'Reimbursements need a stated treatment',
    because: 'the document shows tenant reimbursements, and how they are treated is your decision',
    options: [
      { id: 'netted', label: 'Net them off' },
      { id: 'own', label: "I'll set the ratio" },
    ],
    when: (docs) => {
      const r = lines(docs, 'income').filter((l) => (l.category === 'recoveries' || REIMBURSEMENT_LABEL.test(l.label)) && l.amount > 0);
      return r.length ? `The document shows ${money(sum(r))} a year of tenant reimbursements (${r.map((l) => l.label).join(', ')}).` : null;
    },
  },
  {
    key: 'rentAgreesWithStatedAverage',
    label: 'Stated average rent',
    check: 'The rent read agrees with the average rent the document states',
    because: 'the rent read does not match the average rent the document states',
    options: [
      { id: 'checked', label: 'Keep my rent' },
      { id: 'own', label: "I'll enter the rent" },
    ],
    when: (docs, proposal) => {
      // What is held to the average is the rent that will be underwritten: what the owner settled on, or the figure on offer while it is still a question
      const rentRow = proposal.changes.find((c) => c.key === 'grossRentPerMonth');
      // While the rent is still a question there is no rent being underwritten yet: the document's own figures are all there is to compare
      const underwritten = rentRow?.unsure ? NaN : Number(rentRow?.value) * 12;
      for (const d of docs) {
        if (d.documentType !== 'offering_memorandum') continue;
        const units = Number(val(d.unitCount));
        const avg = Number(val(d.averageCurrentRent));
        if (!(units > 0) || !(avg > 0)) continue;
        const stated = avg * units * 12;
        const reads: Array<{ from: string; annual: number }> = [];
        const table = sum(lines([d], 'income').filter((l) => l.category === 'rent'));
        if (table > 0) reads.push({ from: 'the income table', annual: table });
        const mix = d.unitMix.reduce((s, r) => s + (Number(val(r.unitCount)) || 0) * (Number(val(r.currentMonthlyRent)) || 0) * 12, 0);
        if (mix > 0) reads.push({ from: 'the unit mix', annual: mix });
        if (Number.isFinite(underwritten) && underwritten > 0) {
          return Math.abs(underwritten - stated) / stated > RENT_AVERAGE_TOLERANCE
            ? `The document's average rent is ${money(avg)} a unit, ${money(stated / 12)} a month over ${units} units. You are underwriting ${money(underwritten / 12)} a month.`
            : null;
        }
        const off = reads.filter((r) => Math.abs(r.annual - stated) / stated > RENT_AVERAGE_TOLERANCE);
        if (off.length) return `The document's average rent is ${money(avg)} a unit, ${money(stated / 12)} a month over ${units} units.`;
      }
      return null;
    },
  },
  {
    key: 'vacancyAgreesWithOccupancy',
    label: 'Stated occupancy',
    check: 'The vacancy line agrees with the occupancy the document states',
    because: 'the stated occupancy and the vacancy line disagree',
    options: [
      { id: 'line', label: 'Keep the vacancy line' },
      { id: 'own', label: "I'll enter vacancy" },
    ],
    when: (docs) => {
      for (const d of docs) {
        if (d.documentType !== 'offering_memorandum') continue;
        const occupancy = Number(val(d.occupancyPercent));
        const rent = sum(lines([d], 'income').filter((l) => l.category === 'rent'));
        const loss = sum(lines([d], 'income').filter((l) => l.category === 'vacancy_credit_loss').map((l) => ({ amount: Math.abs(l.amount) })));
        if (!(occupancy > 0 && occupancy <= 100) || !(rent > 0) || loss === 0) continue;
        const lineShare = (loss / rent) * 100;
        if (Math.abs(100 - occupancy - lineShare) > OCCUPANCY_TOLERANCE_POINTS) return `The document states ${occupancy}% occupancy, but its vacancy line is ${lineShare.toFixed(1)}% of rent.`;
      }
      return null;
    },
  },
  {
    key: 'unclassifiedIncome',
    label: 'Income the reader could not classify',
    check: 'Every income line has a known kind',
    because: 'the reader could not tell what kind of income a line is',
    options: [
      { id: 'left', label: 'Leave it out' },
      { id: 'own', label: "I'll enter it" },
    ],
    when: (docs) => {
      const o = lines(docs, 'income').filter((l) => l.category === 'other' && l.amount !== 0);
      return o.length ? `${o.map((l) => `${l.label} (${money(l.amount)})`).join(', ')}: income the reader could not classify. It is left out unless you say otherwise.` : null;
    },
  },
];

export function evaluateContracts(proposal: Proposal, docs: IntakeDocument[]): ContractResult[] {
  const results: ContractResult[] = [];
  for (const c of proposal.changes) {
    const reasons: Reason[] = [];
    for (const check of FIGURE_CHECKS) {
      const detail = check.run(c);
      if (detail) reasons.push({ check: check.name, because: check.because, detail });
    }
    results.push({ key: c.key, label: c.label, outcome: reasons.length ? 'ask' : 'auto', reasons, checksRun: FIGURE_CHECKS.map((k) => k.name) });
  }
  for (const lc of LINE_CONTRACTS) {
    const detail = lc.when(docs, proposal);
    results.push({ key: lc.key, label: lc.label, outcome: detail ? 'ask' : 'auto', reasons: detail ? [{ check: lc.check, because: lc.because, detail }] : [], checksRun: [lc.check], ...(detail ? { options: lc.options } : {}) });
  }
  return results;
}
