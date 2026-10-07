/**
 * Can every number that goes into the underwriting be walked back to where it came from? A page and line of a document, a setting in the owner's
 * investor profile (with their reason), or something the owner typed. The steps below are the wizard's own, in its own order: read the document,
 * apply what needs no question, let the owner decide the rent, fill what is left from the profile, then save the record and check each figure.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { reconcileBasis, suggestedStartingPoints, TRACKED_INPUTS, type InputBasis } from '@engine/underwritingAssumptions';
import { setAssumptionDefaults } from '../../engine/assumptionDefaults';
import { attachVariances, defaultTicked, figureRows, proposeChanges, releaseDependents, withChosenValue } from '../apply';
import { expectedFor } from '../expected';
import { buildIntakeRecord, closingFigure } from '../intakeRecord';
import { groundIntake, traceDocument } from '../lineage';
import { receiptsFor, receiptText, untraced } from '../receipts';
import { applyToForm, formAsInputs, profileFill } from '../wizardMap';
import { COWICHE_TEXT } from './fixtures/cowicheCreek';
import { COWICHE_READER_ANSWER } from './fixtures/cowicheReader';

const DOC = 'Cowiche Creek OM.pdf';
const deal = { asset_class: 'multi-unit', purchase_price: null, inputs: {} };

const profile = () => {
  const p = suggestedStartingPoints(null);
  p.assets['multi-unit'] = { ...p.assets['multi-unit'], usesPropertyManager: false };
  return p;
};

/** The wizard's flow with the owner's decisions: they settle the rent on the figure from the income table. */
function underwrite(ownerChanges: Record<string, string> = {}) {
  const assumptions = profile();
  setAssumptionDefaults({ assumptions, discountRate: 8, exitYear: 10 });
  const intake = groundIntake(coerceIntake('offering_memorandum', COWICHE_READER_ANSWER), COWICHE_TEXT);
  let proposal = proposeChanges([intake], deal, { assetClass: true, manager: { uses: false } });
  attachVariances(proposal, expectedFor(proposal, deal));
  const ticked = defaultTicked(proposal);

  // The owner is asked about the rent and chooses the income table's figure; the expense ratio that waited on it is then stated
  proposal = releaseDependents(withChosenValue(proposal, 'grossRentPerMonth', 120_900), 'grossRentPerMonth');
  const applied = new Set([...ticked, 'grossRentPerMonth', 'expenseRatio']);

  const fill = applyToForm({ form: {}, asset: 'multi-unit', proposal, ticked: applied });
  const fromProfile = profileFill({ assumptions, discountRate: 8, exitYear: 10, base: fill.form, asset: 'multi-unit', now: new Date('2026-10-06') });
  const form = { ...fill.form, ...fromProfile.patch, ...ownerChanges };
  const inputs: Record<string, any> = { ...formAsInputs(form, 'multi-unit'), ...fill.extra };
  const basis = { ...fill.basis, ...fromProfile.basis } as Record<string, InputBasis>;
  inputs.assumptionBasis = reconcileBasis(basis, inputs);

  // As the wizard does: the address is held composed (street, city, state, zip), so the street the document gave is what the form still holds
  const current = (k: string, value: unknown) => {
    if (k === 'address') return typeof value === 'string' && String(inputs.address).toLowerCase().startsWith(value.toLowerCase()) ? value : (inputs.address as string);
    return typeof inputs[k] === 'number' || typeof inputs[k] === 'string' ? (inputs[k] as number | string) : undefined;
  };
  const record = buildIntakeRecord({
    documents: [{ name: DOC, type: 'offering_memorandum' }],
    documentFigures: figureRows(proposal, applied).map((f) => ({ ...f, current: current(f.key, f.value) })),
    profileFigures: [
      ...Object.entries(fromProfile.basis).map(([key, b]) => ({ key, label: b.label, value: Number(b.value), why: b.rationale })),
      ...(closingFigure(fromProfile.closing) ? [closingFigure(fromProfile.closing)!] : []),
    ],
    claims: [], notes: [], choices: [],
    lineage: traceDocument(intake, COWICHE_TEXT, DOC),
  })!;
  return { inputs, record, receipts: receiptsFor(record) };
}

afterEach(() => setAssumptionDefaults({ assumptions: { assets: {} }, discountRate: undefined, exitYear: undefined } as never));

describe('Cowiche Creek: every number can be walked back to where it came from', () => {
  const { inputs, record, receipts } = underwrite();

  it('traces every figure in the saved record: a document figure to a line found in the document, the others by their recorded reason', () => {
    expect(untraced(receipts).map((r) => r.key)).toEqual([]);
  });

  it('leaves no number in the project without a source: each is in the record, or has a basis (profile, document, county or owner)', () => {
    const derived = new Set(['monthlyRent', 'grossRentAnnual', 'monthlyRentPerUnit', 'assumptionBasis', 'manageProperty', 'financingType']);
    const recorded = new Set(receipts.map((r) => r.key));
    const basis = (inputs.assumptionBasis ?? {}) as Record<string, InputBasis>;
    const orphans = Object.keys(inputs).filter((k) => !derived.has(k) && inputs[k] !== undefined && !recorded.has(k) && !basis[k]);
    expect(orphans).toEqual([]);
  });

  it('points the rent at the unit-mix line it was read from, with the page', () => {
    const rent = receipts.find((r) => r.key === 'grossRentPerMonth')!;
    expect(rent.source).toBe('document');
    expect(rent.from.some((s) => s.page !== null && /1,850|1,950/.test(s.snippet ?? ''))).toBe(true);
  });

  it('points the vacancy at the Vacancy line of the income table on page 9', () => {
    const vac = receipts.find((r) => r.key === 'vacancyRate')!;
    expect(vac.from.some((s) => s.page === 9 && /Vacancy/i.test(s.snippet ?? ''))).toBe(true);
  });

  it('points the expense ratio at the cost lines of page 9, not at management or the reserve', () => {
    const ratio = receipts.find((r) => r.key === 'expenseRatio')!;
    const labels = ratio.from.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['RE Taxes', 'Insurance', 'Utilities W/S/G/E']));
    expect(labels).not.toContain('Management');
    expect(labels).not.toContain('Reserves');
    expect(ratio.from.every((s) => s.page !== null)).toBe(true);
  });

  it('points the reserve at its own line, and the price, units, address and parcel at the page that gives them', () => {
    const at = (key: string) => receipts.find((r) => r.key === key)!;
    expect(at('capexReserveAnnual').from.map((s) => s.label)).toEqual(['Reserves']);
    for (const key of ['purchasePrice', 'unitCount', 'address', 'primaryApn', 'yearBuilt', 'squareFeet']) expect(at(key).traced, key).toBe(true);
    expect(at('primaryApn').from[0].snippet).toContain('181309-41011');
    expect(at('address').from[0].page).toBe(5);
  });

  it('says where a profile figure came from in words, including the owner\'s reason', () => {
    const profileOnes = receipts.filter((r) => r.source === 'profile');
    expect(profileOnes.length).toBeGreaterThan(0);
    for (const r of profileOnes) expect(receiptText(r), r.key).toMatch(/investor profile/i);
  });

  it('says where a document figure came from in words: the document, the page and the line', () => {
    const text = receiptText(receipts.find((r) => r.key === 'vacancyRate')!);
    expect(text).toContain(DOC);
    expect(text).toContain('page 9');
  });

  it('never records a number the document does not contain as read from the document', () => {
    for (const r of receipts.filter((x) => x.source === 'document')) expect(r.from.length, r.key).toBeGreaterThan(0);
  });
});

describe('Cowiche Creek: the owner\'s own number beats the document, and says so', () => {
  it('records a vacancy the owner changed as theirs, and keeps what the document said', () => {
    const { receipts } = underwrite({ vacancy: '7' });
    const vac = receipts.find((r) => r.key === 'vacancyRate')!;
    expect(vac.source).toBe('owner');
    expect(vac.how).toMatch(/document said/i);
    expect(vac.traced).toBe(true);
  });

  it('keeps the expense ratio on the document when only vacancy changed', () => {
    const { receipts } = underwrite({ vacancy: '7' });
    expect(receipts.find((r) => r.key === 'expenseRatio')!.source).toBe('document');
  });
});

describe('Traceability is not satisfied by a figure that cannot be found', () => {
  it('flags a document figure whose line is not in the text', () => {
    const { record } = underwrite();
    const broken = { ...record, lineage: (record.lineage ?? []).filter((r) => !(r.keys ?? []).includes('capexReserveAnnual')) };
    expect(untraced(receiptsFor(broken)).map((r) => r.key)).toContain('capexReserveAnnual');
  });

  it('reports the keys the wizard form uses for the tracked inputs', () => {
    expect(Object.keys(TRACKED_INPUTS)).toContain('vacancyRate');
  });
});
