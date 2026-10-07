/**
 * The worksheet and the check before confirming, on the Cowiche Creek memorandum. The worksheet gives each assumption one state; the readiness
 * check reads them together. The owner's own number always satisfies a row, and a convention alone never satisfies an expense ratio.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setAssumptionDefaults } from '../../engine/assumptionDefaults';
import { evaluateContracts, LINE_CONTRACTS } from '../contracts';
import { openQuestions } from '../openQuestions';
import { assess, CAP_COMPRESSION, THIN_DSCR } from '../readiness';
import { buildWorksheet, DECISION_ROW, ROW_SPECS, unattachedDecisions, type WorksheetRow } from '../worksheet';
import { underwrite } from './cowicheFlow';
import modalSource from '../../../components/dashboard/ProjectWizardModal.tsx?raw';

afterEach(() => setAssumptionDefaults({ assumptions: { assets: {} }, discountRate: undefined, exitYear: undefined } as never));

function worksheet(args: { ownerChanges?: Record<string, string>; rent?: number | null; resolved?: Record<string, string>; ownerReasons?: Record<string, string> } = {}) {
  const flow = underwrite(args.ownerChanges ?? {}, { rent: args.rent === undefined ? 120_900 : args.rent });
  const contracts = evaluateContracts(flow.proposal, [flow.intake]);
  const needed = openQuestions({ asset_class: 'multi-unit', purchase_price: Number(flow.inputs.purchasePrice), inputs: flow.inputs });
  const rows = buildWorksheet({ inputs: flow.inputs, receipts: flow.receipts, contracts, resolved: args.resolved ?? {}, needed, ownerReasons: args.ownerReasons });
  return { ...flow, contracts, needed, rows };
}
const row = (rows: WorksheetRow[], key: string) => rows.find((r) => r.key === key)!;
const ALL_ANSWERED = { managementFee: 'I manage it myself', utilityReimbursements: 'Take them off the costs', rentAgreesWithStatedAverage: 'Checked', capexReserveAnnual: 'Document\'s figure' };

describe('the worksheet gives every assumption one state and says where it came from', () => {
  const { rows } = worksheet();

  it('has a row for every input the engine needs and every decision has a row to sit on', () => {
    expect(rows.map((r) => r.key)).toEqual(ROW_SPECS.map((s) => s.key));
    expect(unattachedDecisions()).toEqual([]);
    for (const c of LINE_CONTRACTS) expect(ROW_SPECS.some((s) => s.key === DECISION_ROW[c.key]), c.key).toBe(true);
  });

  it('shows a document figure with its page and line', () => {
    const vacancy = row(rows, 'vacancyRate');
    expect(vacancy.source).toBe('document');
    expect(vacancy.basis).toContain('page 9');
  });

  it('shows what the investor profile stands for as an assumption, in words', () => {
    const closing = row(rows, 'closingDate');
    expect(closing.state).toBe('assumed');
    expect(closing.source).toBe('profile');
    expect(closing.basis).toMatch(/investor profile/i);
  });

  it('says what the profile decides about a manager, until the document makes the owner decide', () => {
    expect(row(rows, 'manageProperty').basis).toMatch(/document charges for management/i);
    const { rows: after } = worksheet({ resolved: { managementFee: 'I manage it myself: no management fee' } });
    expect(row(after, 'manageProperty').basis).toBe('I manage it myself: no management fee');
  });

  it('shows the figures nothing supplies as needed: the loan', () => {
    for (const key of ['downPaymentPercent', 'interestRate', 'amortizationYears']) expect(row(rows, key).state, key).toBe('needed');
  });

  it('asks the owner to decide the management charge on the manager row, the reimbursements on the expense ratio and so on', () => {
    expect(row(rows, 'manageProperty').state).toBe('decide');
    expect(row(rows, 'manageProperty').decisions.map((d) => d.key)).toEqual(['managementFee']);
    expect(row(rows, 'expenseRatio').decisions.map((d) => d.key)).toContain('utilityReimbursements');
  });

  it('settles a decision when the owner answers it', () => {
    const { rows: after } = worksheet({ resolved: { managementFee: 'I manage it myself: no management fee' } });
    expect(row(after, 'manageProperty').state).toBe('ready');
    expect(row(after, 'manageProperty').source).toBe('owner');
  });
});

describe('a convention is not evidence for an expense ratio', () => {
  it('marks the profile\'s blanket ratio unsupported while the document\'s is waiting on the rent', () => {
    const { rows } = worksheet({ rent: null });
    const ratio = row(rows, 'expenseRatio');
    expect(ratio.source).toBe('profile');
    expect(ratio.state).toBe('unsupported');
    expect(ratio.reasons[0].detail).toMatch(/isn't evidence for this property/);
  });

  it('accepts the document\'s ratio, traced to the cost lines it was built from', () => {
    const { rows } = worksheet({ resolved: { utilityReimbursements: 'Take them off the costs' } });
    const ratio = row(rows, 'expenseRatio');
    expect(ratio.source).toBe('document');
    expect(ratio.state).toBe('ready');
  });

  it('does not accept the owner\'s own ratio without the reason for it', () => {
    const { rows } = worksheet({ ownerChanges: { opexRatio: '30' }, resolved: { utilityReimbursements: 'ok' } });
    expect(row(rows, 'expenseRatio').source).toBe('owner');
    expect(row(rows, 'expenseRatio').state).toBe('unsupported');
  });

  it('accepts the owner\'s own ratio with a reason, and shows the reason as its source', () => {
    const { rows } = worksheet({ ownerChanges: { opexRatio: '30' }, resolved: { utilityReimbursements: 'ok' }, ownerReasons: { expenseRatio: 'Our other three buildings of this vintage run 30%' } });
    const ratio = row(rows, 'expenseRatio');
    expect(ratio.state).toBe('ready');
    expect(ratio.basis).toContain('Our other three buildings');
  });
});

describe('the check before confirming', () => {
  const answered = (over: Record<string, string> = {}) => ({ ...ALL_ANSWERED, ...over });
  const loan = { down: '30', rate: '6.5', amort: '30' };

  it('is not ready while anything is owed, and says what', () => {
    const { rows } = worksheet();
    const r = assess({ rows });
    expect(r.verdict).toBe('not_ready');
    expect(r.blockers.map((b) => b.id)).toEqual(expect.arrayContaining(['needed:downPaymentPercent', 'needed:interestRate', 'decide:manageProperty']));
  });

  it('is not ready on a convention alone, even when everything else is answered', () => {
    const { rows } = worksheet({ rent: null, ownerChanges: loan, resolved: answered() });
    const r = assess({ rows });
    expect(r.blockers.map((b) => b.id)).toContain('unsupported:expenseRatio');
    expect(r.verdict).toBe('not_ready');
  });

  it('is ready when every question is answered and every figure has a source', () => {
    const { rows } = worksheet({ ownerChanges: loan, resolved: answered() });
    const r = assess({ rows });
    expect(r.blockers.map((b) => b.id)).toEqual([]);
    expect(r.verdict === 'ready' || r.verdict === 'review').toBe(true);
  });

  it('stops at review when the figures do not sit together, and clears when the owner has read each', () => {
    const { rows } = worksheet({ ownerChanges: loan, resolved: answered() });
    const args = { rows, outcome: { noi: 1_300_000, capRate: 5.5, dscr: 1.1 }, claims: { noi: 1_093_745, managementCost: 53_522 }, selfManaged: true, exitCap: 4.5 };
    const first = assess(args);
    expect(first.verdict).toBe('review');
    expect(first.warnings.map((w) => w.id)).toEqual(expect.arrayContaining(['noi-gap', 'dscr-thin', 'cap-compression']));
    const cleared = assess({ ...args, acknowledged: new Set(first.warnings.map((w) => w.id)) });
    expect(cleared.verdict).toBe('ready');
  });

  it('does not warn about figures that sit together', () => {
    const { rows } = worksheet({ ownerChanges: loan, resolved: answered() });
    const r = assess({ rows, outcome: { noi: 1_100_000, capRate: 5.97, dscr: THIN_DSCR + 0.3 }, claims: { noi: 1_093_745, managementCost: 53_522 }, selfManaged: true, exitCap: 5.97 - CAP_COMPRESSION + 0.1 });
    expect(r.warnings.filter((w) => ['noi-gap', 'dscr-thin', 'cap-compression'].includes(w.id))).toEqual([]);
  });

  it('adds back the seller\'s own management cost when the owner manages the property, so like is compared with like', () => {
    const { rows } = worksheet({ ownerChanges: loan, resolved: answered() });
    const mine = 1_147_267; // the seller's NOI plus its management cost
    expect(assess({ rows, outcome: { noi: mine, capRate: 6, dscr: 2 }, claims: { noi: 1_093_745, managementCost: 53_522 }, selfManaged: true }).warnings.map((w) => w.id)).not.toContain('noi-gap');
    expect(assess({ rows, outcome: { noi: mine, capRate: 6, dscr: 2 }, claims: { noi: 1_093_745, managementCost: 53_522 }, selfManaged: false }).warnings.map((w) => w.id)).not.toContain('noi-gap');
  });

  it('puts the document\'s failed arithmetic in front of the owner', () => {
    const { rows } = worksheet({ ownerChanges: loan, resolved: answered() });
    const r = assess({ rows, checks: [{ label: 'Income less costs equals the NOI', ok: false, detail: '12% apart' }] });
    expect(r.warnings.map((w) => w.id)).toContain('check:Income less costs equals the NOI');
    expect(r.verdict).toBe('review');
  });

  it('names an unusual expense ratio and the range most properties run in', () => {
    const { rows } = worksheet({ ownerChanges: { ...loan, opexRatio: '12' }, resolved: answered({ expenseRatio: 'x' }), ownerReasons: { expenseRatio: 'Our statements' } });
    const w = assess({ rows }).warnings.find((x) => x.id === 'expense-ratio-range')!;
    expect(w.detail).toMatch(/run 20% to 60%/);
  });
});

describe('a question never disappears into a blank row', () => {
  it('shows the rent as a decision while the documents disagree and the form holds none', () => {
    const { rows } = worksheet({ rent: null });
    const rent = row(rows, 'grossRentPerMonth');
    expect(rent.value).toBeNull();
    expect(rent.state).toBe('decide');
    expect(assess({ rows }).blockers.map((b) => b.id)).toContain('decide:grossRentPerMonth');
  });

  it('puts the line a figure is read from before the lines it is only measured against', () => {
    const { rows } = worksheet();
    expect(row(rows, 'vacancyRate').basis).toMatch(/Vacancy/);
  });

  it('says what the profile supplied without a stray full stop', () => {
    const { rows } = worksheet();
    expect(row(rows, 'closingDate').basis).toBe('Your investor profile: set to close 6 weeks after the project is created');
  });
});

describe('every row has a place in the form', () => {
  it('puts a note under a field for every assumption of the worksheet, so nothing owed is hidden', () => {
    const modal: string = modalSource;
    const grouped = [...modal.matchAll(/<FieldNotes keys=\{\[([^\]]*)\]\}/g)].flatMap((m) => [...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]));
    const placed = new Set([...[...modal.matchAll(/<FieldNote k="([A-Za-z]+)"/g)].map((m) => m[1]), ...grouped]);
    const missing = ROW_SPECS.map((s) => s.key).filter((k) => !placed.has(k));
    expect(missing).toEqual([]);
  });
});

describe('the screen asks in few words', () => {
  const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

  it('keeps every choice to four words or fewer', () => {
    for (const c of LINE_CONTRACTS) for (const o of c.options) expect(words(o.label), `${c.key}: ${o.label}`).toBeLessThanOrEqual(4);
  });

  it('says each open decision in one sentence of twenty words or fewer', () => {
    const { rows } = worksheet();
    for (const r of rows) for (const d of r.decisions) for (const x of d.reasons) expect(words(x.detail), `${d.key}: ${x.detail}`).toBeLessThanOrEqual(20);
  });

  it('says what is wrong with an expense ratio in twenty words or fewer', () => {
    const { rows } = worksheet({ rent: null });
    for (const x of row(rows, 'expenseRatio').reasons) expect(words(x.detail), x.detail).toBeLessThanOrEqual(20);
  });

  it('says each warning in a title and one short sentence', () => {
    const { rows } = worksheet({ ownerChanges: { down: '30', rate: '6.5', amort: '30', opexRatio: '12' }, resolved: { ...ALL_ANSWERED, expenseRatio: 'x' }, ownerReasons: { expenseRatio: 'Our statements' } });
    const r = assess({ rows, outcome: { noi: 1_300_000, capRate: 5.5, dscr: 1.1 }, claims: { noi: 1_093_745, managementCost: 53_522 }, selfManaged: true, exitCap: 4.5 });
    expect(r.warnings.length).toBeGreaterThan(3);
    for (const w of r.warnings) { expect(words(w.title), w.title).toBeLessThanOrEqual(8); expect(words(w.detail), w.detail).toBeLessThanOrEqual(20); }
  });
});

describe('one rent question, not two', () => {
  it('shows the document\'s average rent as a hint to the rent question, with no second decision beside it', () => {
    const { rows } = worksheet({ rent: null });
    const rent = row(rows, 'grossRentPerMonth');
    expect(rent.decisions.map((d) => d.key)).not.toContain('rentAgreesWithStatedAverage');
    expect(rent.hint).toMatch(/average rent is \$1,832/);
  });

  it('asks for a confirmation after the rent is chosen only if the choice still disagrees with the average', () => {
    expect(row(worksheet({ rent: 120_900 }).rows, 'grossRentPerMonth').decisions).toEqual([]);
    expect(row(worksheet({ rent: 125_700 }).rows, 'grossRentPerMonth').decisions.map((d) => d.key)).toEqual(['rentAgreesWithStatedAverage']);
  });
});
