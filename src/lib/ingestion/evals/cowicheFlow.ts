/**
 * The wizard's own pure steps for the Cowiche Creek memorandum, in the wizard's own order: read the document, apply what needs no question, let the
 * owner settle what they are asked, fill what is left from the investor profile, and save the record. Shared by the evals so each asks of the same
 * state. `ownerChanges` are form fields the owner then typed over; `decisions` are the answers to the questions.
 */
import { coerceIntake } from '@engine/intakeParse';
import { reconcileBasis, suggestedStartingPoints, type InputBasis } from '@engine/underwritingAssumptions';
import { setAssumptionDefaults } from '../../engine/assumptionDefaults';
import { attachVariances, defaultTicked, figureRows, proposeChanges, releaseDependents, withChosenValue } from '../apply';
import { expectedFor } from '../expected';
import { buildIntakeRecord, closingFigure } from '../intakeRecord';
import { groundIntake, traceDocument } from '../lineage';
import { receiptsFor } from '../receipts';
import { applyToForm, formAsInputs, profileFill } from '../wizardMap';
import { COWICHE_TEXT } from './fixtures/cowicheCreek';
import { COWICHE_READER_ANSWER } from './fixtures/cowicheReader';

export const DOC = 'Cowiche Creek OM.pdf';
export const deal = { asset_class: 'multi-unit', purchase_price: null, inputs: {} };

export const profile = () => {
  const p = suggestedStartingPoints(null);
  p.assets['multi-unit'] = { ...p.assets['multi-unit'], usesPropertyManager: false };
  return p;
};

/** The wizard's flow with the owner's decisions: they settle the rent on the figure from the income table. */
export function underwrite(ownerChanges: Record<string, string> = {}, opts: { rent?: number | null } = { rent: 120_900 }) {
  const assumptions = profile();
  setAssumptionDefaults({ assumptions, discountRate: 8, exitYear: 10 });
  const intake = groundIntake(coerceIntake('offering_memorandum', COWICHE_READER_ANSWER), COWICHE_TEXT);
  let proposal = proposeChanges([intake], deal, { assetClass: true, manager: { uses: false } });
  attachVariances(proposal, expectedFor(proposal, deal));
  const ticked = defaultTicked(proposal);

  // The owner is asked about the rent and chooses the income table's figure; the expense ratio that waited on it is then stated
  const settled = opts.rent !== null && opts.rent !== undefined;
  if (settled) proposal = releaseDependents(withChosenValue(proposal, 'grossRentPerMonth', opts.rent as number), 'grossRentPerMonth');
  const applied = new Set(settled ? [...ticked, 'grossRentPerMonth', 'expenseRatio'] : ticked);

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
  return { inputs, record, receipts: receiptsFor(record), proposal, form, intake };
}

