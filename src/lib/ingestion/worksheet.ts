/**
 * The worksheet: one row per assumption, each saying what it is now, where it came from, and whether anything is still owed. This is the
 * single reading of the underwriting that replaces three lists (what the profile supplied, what the document gave, what is still needed): the
 * form's own fields carry the row.
 *
 * A row is in exactly one state:
 *   ready        a document figure traced to its line, or the owner's own entry, with nothing in question
 *   assumed      taken from the owner's investor profile; it stands for this deal unless the owner changes it
 *   decide       a contract failed and the owner has not yet answered
 *   unsupported  a figure that needs evidence (an expense ratio) resting on a convention alone
 *   needed       the engine cannot run without it and nothing supplies it
 *   optional     blank, and the engine does not require it
 *
 * Pure. It reads the form's inputs, the receipts of the record, and the contract results; it computes nothing.
 */

import type { MissingInput } from '@engine/inputRequirements';
import { LINE_CONTRACTS, type ContractResult, type Option, type Reason } from './contracts';
import { receiptText, type Receipt } from './receipts';

export type RowState = 'ready' | 'assumed' | 'decide' | 'unsupported' | 'needed' | 'optional';
export type RowSource = 'document' | 'profile' | 'owner' | 'missing';
export type RowGroup = 'Property' | 'Income' | 'Expenses' | 'Financing' | 'Exit and hold';

export interface RowSpec {
  /** The deal input the row is about. */
  key: string;
  /** The wizard form field that holds it (its `data-field`). */
  field: string;
  label: string;
  group: RowGroup;
  /**
   * A figure that cannot stand on a convention alone: from a document, or from the owner's own number with the reason for it. A blanket 35%
   * expense ratio is not evidence about this property; the costs that make it up are.
   */
  evidenceRequired?: boolean;
}

export const ROW_SPECS: RowSpec[] = [
  { key: 'address', field: 'location', label: 'Address', group: 'Property' },
  { key: 'unitCount', field: 'multiUnits', label: 'Units', group: 'Property' },
  { key: 'squareFeet', field: 'gla', label: 'Square feet', group: 'Property' },
  { key: 'purchasePrice', field: 'price', label: 'Purchase price', group: 'Financing' },
  { key: 'downPaymentPercent', field: 'down', label: 'Down payment (%)', group: 'Financing' },
  { key: 'interestRate', field: 'rate', label: 'Interest rate (%)', group: 'Financing' },
  { key: 'amortizationYears', field: 'amort', label: 'Amortization (years)', group: 'Financing' },
  { key: 'closingCosts', field: 'closing', label: 'Closing costs', group: 'Financing' },
  { key: 'closingDate', field: 'closingDate', label: 'Closing date', group: 'Financing' },
  { key: 'grossRentPerMonth', field: 'grossRent', label: 'Rent', group: 'Income' },
  { key: 'otherIncomeAnnual', field: 'other', label: 'Other income', group: 'Income' },
  { key: 'vacancyRate', field: 'vacancy', label: 'Vacancy', group: 'Income' },
  { key: 'rentGrowth', field: 'rentGrowth', label: 'Rent growth', group: 'Income' },
  { key: 'expenseRatio', field: 'opexRatio', label: 'Expense ratio', group: 'Expenses', evidenceRequired: true },
  { key: 'expenseGrowth', field: 'expenseGrowth', label: 'Expense growth', group: 'Expenses' },
  { key: 'capexReserveAnnual', field: 'capexValue', label: 'Replacement reserve', group: 'Expenses' },
  { key: 'manageProperty', field: 'manageProperty', label: 'Property manager', group: 'Expenses' },
  { key: 'targetCapRate', field: 'exitCap', label: 'Exit cap rate', group: 'Exit and hold' },
  { key: 'sellingCostPercent', field: 'sellingCost', label: 'Selling costs', group: 'Exit and hold' },
  { key: 'exitYear', field: 'exitYear', label: 'Hold period', group: 'Exit and hold' },
  { key: 'discountRate', field: 'discountRate', label: 'Discount rate', group: 'Exit and hold' },
];

export interface WorksheetRow {
  key: string;
  field: string;
  label: string;
  group: RowGroup;
  state: RowState;
  source: RowSource;
  /** The value as it stands now, or null when blank. */
  value: number | string | boolean | null;
  /** Where it came from, in words: the page and line, the profile standard and the owner's reason, or "your own entry". */
  basis: string;
  /** What is wrong, when the row is not ready: the failed contract checks, or why a convention is not evidence. */
  reasons: Reason[];
  /** The decisions attached to this row that the owner has not yet answered: each has no number of its own, and is settled by choosing. */
  decisions: Decision[];
  /** What the owner said when they settled one. */
  decided?: string;
}

export interface Decision {
  key: string;
  label: string;
  reasons: Reason[];
  options: Option[];
}

/** The row each decision with no figure of its own belongs to: the figure it changes the meaning of. */
export const DECISION_ROW: Record<string, string> = {
  managementFee: 'manageProperty',
  utilityReimbursements: 'expenseRatio',
  rentAgreesWithStatedAverage: 'grossRentPerMonth',
  unclassifiedIncome: 'otherIncomeAnnual',
};

/** The sentence shown when an expense ratio rests on a convention alone. */
export const UNSUPPORTED_EXPENSE_RATIO = 'This is the convention in your investor profile, not evidence about this property. Many costs go into an expense ratio (taxes, insurance, upkeep, utilities, payroll). Read an operating statement or the memorandum\'s expense table, or enter your own figure and say why.';

const present = (v: unknown): v is number | string | boolean => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '') && !(typeof v === 'number' && !Number.isFinite(v));

export function buildWorksheet(args: {
  /** The form as deal inputs (`formAsInputs`, plus anything read from a document with no field). */
  inputs: Record<string, unknown>;
  receipts: Receipt[];
  contracts: ContractResult[];
  /** What the owner answered, by the key of the question. */
  resolved: Record<string, string>;
  /** The inputs the engine cannot run without (`openQuestions`). */
  needed: MissingInput[];
  /** The reason the owner gave for a figure of their own, by key. */
  ownerReasons?: Record<string, string>;
}): WorksheetRow[] {
  const { inputs, receipts, contracts, resolved, needed } = args;
  const ownerReasons = args.ownerReasons ?? {};
  const neededKeys = new Set(needed.map((m) => m.key));
  const ask = (key: string) => contracts.find((c) => c.key === key && c.outcome === 'ask');
  /** The decisions for a row still waiting for an answer, and the answers already given. */
  const decisionsFor = (rowKey: string): { open: Decision[]; said: string[] } => {
    const keys = Object.entries(DECISION_ROW).filter(([, row]) => row === rowKey).map(([k]) => k);
    const asked = keys.map((k) => ask(k)).filter((c): c is ContractResult => !!c && !!c.options);
    return {
      open: asked.filter((c) => resolved[c.key] === undefined).map((c) => ({ key: c.key, label: c.label, reasons: c.reasons, options: c.options ?? [] })),
      said: asked.filter((c) => resolved[c.key] !== undefined).map((c) => resolved[c.key]),
    };
  };

  return ROW_SPECS.map((spec): WorksheetRow => {
    const value = present(inputs[spec.key]) ? (inputs[spec.key] as number | string | boolean) : null;
    const receipt = receipts.find((r) => r.key === spec.key);
    const base = { key: spec.key, field: spec.field, label: spec.label, group: spec.group, value };
    const { open, said } = decisionsFor(spec.key);
    const decided = said.length ? said.join(' ') : undefined;

    // The property manager is a decision, not a figure: the profile's choice stands unless the document makes the owner say
    if (spec.key === 'manageProperty') {
      if (open.length) return { ...base, state: 'decide', source: 'profile', basis: 'Your investor profile decides this, but the document charges for management.', reasons: [], decisions: open };
      const manages = value === true;
      return {
        ...base, state: decided !== undefined ? 'ready' : 'assumed', source: decided !== undefined ? 'owner' : 'profile', reasons: [], decisions: [], decided,
        basis: decided !== undefined ? decided : manages ? 'Your investor profile: you hire a manager, so their fee is charged on top of the expense ratio.' : 'Your investor profile: you manage it yourself, so no management fee is charged (a lender will usually add one).',
      };
    }

    if (value === null) {
      // Blank because a question is open (the rent the documents disagree on, a ratio waiting on it): the question belongs here, not nowhere
      const pending = ask(spec.key);
      if ((pending && resolved[spec.key] === undefined) || open.length) return { ...base, state: 'decide', source: 'missing', basis: 'Waiting for your answer below.', reasons: pending ? pending.reasons : [], decisions: open };
      return { ...base, state: neededKeys.has(spec.key) ? 'needed' : 'optional', source: 'missing', basis: neededKeys.has(spec.key) ? 'Nothing supplies this yet.' : 'Not required.', reasons: [], decisions: open };
    }

    const source: RowSource = receipt ? (receipt.source as RowSource) : 'owner';
    const basis = receipt ? receiptText(receipt) : 'Your own entry.';
    const c = ask(spec.key);
    const own = resolved[spec.key];

    // A figure that needs evidence is judged on that first: an open question beside it does not make a convention evidence
    if (spec.evidenceRequired) {
      const ownersReason = (ownerReasons[spec.key] ?? '').trim();
      const owed = c && own === undefined ? c.reasons : [];
      if (source === 'profile') return { ...base, state: 'unsupported', source, basis, reasons: [{ check: 'It rests on evidence', because: 'it is a convention, not evidence about this property', detail: UNSUPPORTED_EXPENSE_RATIO }, ...owed], decisions: open };
      if (source === 'owner' && ownersReason === '') return { ...base, state: 'unsupported', source, basis, reasons: [{ check: 'It rests on evidence', because: 'your own figure needs the reason for it', detail: 'You entered this figure. Say why: which costs it is built from, or what the statements for this property show.' }, ...owed], decisions: open };
      if (owed.length === 0 && source === 'owner') return { ...base, state: 'ready', source, basis: `Your own entry: ${ownersReason}`, reasons: [], decisions: [] };
    }
    if ((c && own === undefined) || open.length) return { ...base, state: 'decide', source, basis, reasons: c && own === undefined ? c.reasons : [], decisions: open };
    if (source === 'document' && receipt && !receipt.traced) return { ...base, state: 'decide', source, basis, reasons: [{ check: 'It is found in the document', because: 'the line it was read from could not be found in the text of the document', detail: 'The reader returned a figure that does not appear as printed. Check the document, or enter your own.' }], decisions: [] };
    return { ...base, state: source === 'profile' ? 'assumed' : 'ready', source, basis, reasons: [], decisions: [], decided: own ?? decided };
  });
}

/** Every decision with no figure of its own has a row to sit on: a contract added without one would be asked nowhere. */
export function unattachedDecisions(): string[] {
  return LINE_CONTRACTS.map((c) => c.key).filter((k) => !DECISION_ROW[k]);
}
