/**
 * Does the reader know when it does not know? The Cowiche Creek memorandum (the trimmed text in fixtures/) is run through the same steps the app
 * uses, against two investor profiles, and each figure is expected to end up in one of three places: put in without a question (auto), put to the
 * owner (ask), or listed as missing. The score that matters is the cost of a wrong figure that went in quietly, not how many figures were right.
 *
 * The reader's answer below is SIMULATED: written by hand the way a competent reader would answer this text, slips included. It tests the checks
 * and the asking, not the model. Replace `READER_ANSWER` with a recorded `parse-document` response when one can be captured; the expectations stay.
 *
 */
import { afterEach, describe, expect, it } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { suggestedStartingPoints, type UnderwritingAssumptions } from '@engine/underwritingAssumptions';
import { setAssumptionDefaults } from '../../engine/assumptionDefaults';
import { attachVariances, proposeChanges, type Proposal } from '../apply';
import { expectedFor } from '../expected';
import { groundIntake, traceDocument } from '../lineage';
import { documentChecks } from '../validate';
import { evaluateContracts } from '../contracts';
import { openQuestions } from '../openQuestions';
import { COWICHE_TEXT } from './fixtures/cowicheCreek';
import { box, COWICHE_READER_ANSWER, line, mix } from './fixtures/cowicheReader';

const READER_ANSWER = COWICHE_READER_ANSWER;

/** The conventions a new profile starts with, for an owner who manages the property themselves. */
function startingProfile(): UnderwritingAssumptions {
  const p = suggestedStartingPoints(null);
  p.assets['multi-unit'] = { ...p.assets['multi-unit'], usesPropertyManager: false };
  return p;
}

/** An owner whose own standards happen to match this property's printed figures: vacancy 5%, expenses 17.3% of rent, reserves $250 a unit. */
function closeProfile(): UnderwritingAssumptions {
  const p = startingProfile();
  p.assets['multi-unit'] = { ...p.assets['multi-unit'], vacancyRate: 5, expenseRatio: 17.3, capexBasis: 'perUnit', capexValue: 250 };
  return p;
}

/** An owner who underwrites more conservatively than this document: 8% vacancy, $400 a unit for reserves. */
function farProfile(): UnderwritingAssumptions {
  const p = startingProfile();
  p.assets['multi-unit'] = { ...p.assets['multi-unit'], vacancyRate: 8, capexBasis: 'perUnit', capexValue: 400 };
  return p;
}

const deal = { asset_class: 'multi-unit', purchase_price: null, inputs: {} };

function run(profile: UnderwritingAssumptions): { proposal: Proposal; asks: string[]; auto: string[] } {
  setAssumptionDefaults({ assumptions: profile, discountRate: 8, exitYear: 10 });
  const intake = groundIntake(coerceIntake('offering_memorandum', READER_ANSWER), COWICHE_TEXT);
  const proposal = proposeChanges([intake], deal);
  attachVariances(proposal, expectedFor(proposal, deal));
  const asks = proposal.changes.filter((c) => c.unsure || c.variance).map((c) => c.key);
  const auto = proposal.changes.filter((c) => !c.unsure && !c.variance && !c.waitingOn).map((c) => c.key);
  return { proposal, asks, auto };
}

/** Every contract's outcome for a reader's answer, under a profile. */
function contractsFor(answer: Record<string, unknown>, profile: UnderwritingAssumptions, text: string = COWICHE_TEXT) {
  setAssumptionDefaults({ assumptions: profile, discountRate: 8, exitYear: 10 });
  const intake = groundIntake(coerceIntake('offering_memorandum', answer), text);
  const proposal = proposeChanges([intake], deal);
  attachVariances(proposal, expectedFor(proposal, deal));
  return evaluateContracts(proposal, [intake]);
}

afterEach(() => setAssumptionDefaults({ assumptions: { assets: {} }, discountRate: undefined, exitYear: undefined } as never));

describe('Cowiche Creek: what is asked whatever the owner\'s profile', () => {
  const { proposal } = run(closeProfile());

  it('puts the rent to the owner: the unit mix gives 125,700 a month and the income table 120,900', () => {
    const rent = proposal.changes.find((c) => c.key === 'grossRentPerMonth')!;
    expect(rent.unsure).toBe(true);
    expect(rent.alternatives?.map((a) => a.value)).toEqual([120_900]);
  });

  it('holds the expense ratio until the rent is settled, since it is the costs over that rent', () => {
    expect(proposal.changes.find((c) => c.key === 'expenseRatio')!.waitingOn).toBe('grossRentPerMonth');
  });

  it("ties the document's income and costs to its printed NOI on the basis it uses (after the 16,500 reserve), 0.7% apart", () => {
    const check = documentChecks(groundIntake(coerceIntake('offering_memorandum', READER_ANSWER), COWICHE_TEXT)).find((c) => c.label.startsWith('Income less costs'))!;
    expect(check.ok).toBe(true);
    expect(check.detail).toContain('replacement reserve');
  });

  it("ties the printed cap rate to the price and NOI", () => {
    const check = documentChecks(groundIntake(coerceIntake('offering_memorandum', READER_ANSWER), COWICHE_TEXT)).find((c) => c.label.startsWith('NOI over the price'))!;
    expect(check.ok).toBe(true);
  });

  it('finds every number the reader returned in the text', () => {
    const intake = groundIntake(coerceIntake('offering_memorandum', READER_ANSWER), COWICHE_TEXT);
    expect(traceDocument(intake, COWICHE_TEXT, 'cowiche').filter((r) => !r.found).map((r) => r.label)).toEqual([]);
  });

  it('does not take the seller\'s NOI or cap rate as figures to underwrite (they are claims)', () => {
    expect(proposal.changes.some((c) => /noi|capRate/i.test(c.key))).toBe(false);
  });

  // The policy: these are the owner's call even when the document states a figure.
  it('asks about the management fee: the table charges 53,522 (3.5% of income) while the text calls it "above-market (~5% of EGI)" and "self-managed"', () => {
    expect(contractsFor(READER_ANSWER, closeProfile()).find((r) => r.key === 'managementFee')).toMatchObject({ outcome: 'ask' });
  });

  it('asks how the utility reimbursements (RUBS, 103,932) are treated: taken off the costs, or counted as income', () => {
    expect(contractsFor(READER_ANSWER, closeProfile()).find((r) => r.key === 'utilityReimbursements')).toMatchObject({ outcome: 'ask' });
  });
});

describe('Cowiche Creek: the investor profile decides what else is asked (the 5% rule)', () => {
  it('asks about vacancy and the reserve when the owner\'s standards are far from the document', () => {
    const { asks } = run(farProfile());
    expect(asks).toContain('vacancyRate');
    expect(asks).toContain('capexReserveAnnual');
  });

  it('does not ask about them when the owner\'s standards match the document', () => {
    const { asks } = run(closeProfile());
    expect(asks).not.toContain('vacancyRate');
    expect(asks).not.toContain('capexReserveAnnual');
  });

  it('puts in without a question the facts the document states plainly (price, units, address, parcel, year built)', () => {
    const { auto } = run(startingProfile());
    for (const key of ['purchasePrice', 'unitCount', 'address', 'primaryApn', 'yearBuilt', 'squareFeet']) expect(auto).toContain(key);
  });
});

describe('Cowiche Creek: what the document cannot give is listed as missing, never guessed', () => {
  it('asks for the loan', () => {
    const { proposal } = run(startingProfile());
    const inputs = { ...(proposal.patch.patch as Record<string, unknown>) };
    const keys = openQuestions({ asset_class: 'multi-unit', purchase_price: Number(inputs.purchasePrice), inputs }).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['downPaymentPercent']));
    expect(keys).not.toContain('purchasePrice');
  });
});

describe('Contracts: governance (they hold when the reader slips or the document changes)', () => {
  const asked = (answer: Record<string, unknown>) => contractsFor(answer, closeProfile()).filter((r) => r.outcome === 'ask').map((r) => r.key);
  const without = (label: string) => ({ ...READER_ANSWER, expenses: READER_ANSWER.expenses.filter((l) => l.label.value !== label) });

  it('records every check that ran, and names the failed one for every question', () => {
    for (const r of contractsFor(READER_ANSWER, farProfile())) {
      expect(r.checksRun.length, r.key).toBeGreaterThan(0);
      if (r.outcome === 'ask') expect(r.reasons.length, r.key).toBeGreaterThan(0);
      else expect(r.reasons, r.key).toEqual([]);
    }
  });

  it('stops asking about management when the document has no management line', () => {
    expect(asked(without('Management'))).not.toContain('managementFee');
  });

  it('still asks when the reader files management under "other" (its name gives it away)', () => {
    const slip = { ...READER_ANSWER, expenses: READER_ANSWER.expenses.map((l) => (l.label.value === 'Management' ? line('Management', 'other', 53_522) : l)) };
    expect(asked(slip)).toContain('managementFee');
  });

  it('still asks when the reader files the reimbursements as ordinary other income', () => {
    const slip = { ...READER_ANSWER, income: READER_ANSWER.income.map((l) => (l.label.value === 'RUBS' ? line('RUBS', 'other_income', 103_932) : l)) };
    expect(asked(slip)).toContain('utilityReimbursements');
  });

  it('asks about an income line the reader could not classify, instead of leaving it out silently', () => {
    const answer = { ...READER_ANSWER, income: [...READER_ANSWER.income, line('Parking', 'other', 12_000)] };
    expect(asked(answer)).toContain('unclassifiedIncome');
  });

  it('asks about nothing the document leaves unsaid: a clean answer with no such lines raises no line contracts', () => {
    const answer = { ...READER_ANSWER, expenses: READER_ANSWER.expenses.filter((l) => l.label.value !== 'Management'), income: READER_ANSWER.income.filter((l) => l.label.value !== 'RUBS') };
    expect(asked(answer)).toEqual(expect.not.arrayContaining(['managementFee', 'utilityReimbursements', 'unclassifiedIncome']));
  });
});

describe('Contracts: mutation (change the document or the reading and the outcome may only move toward asking)', () => {
  const run1 = (answer: Record<string, unknown>, text = COWICHE_TEXT) => contractsFor(answer, closeProfile(), text);
  const outcome = (rs: ReturnType<typeof run1>, key: string) => rs.find((r) => r.key === key)?.outcome;
  const base = run1(READER_ANSWER);
  const set = (over: Record<string, unknown>) => ({ ...READER_ANSWER, ...over });
  const dropPage = (n: number) => COWICHE_TEXT.split(/^(?=--- Page \d+ ---$)/m).map((p) => (p.startsWith(`--- Page ${n} ---`) ? `--- Page ${n} ---\n` : p)).join('');

  it('starts from a baseline where the plain facts go in and the rent is the only figure asked on its own', () => {
    expect(outcome(base, 'purchasePrice')).toBe('auto');
    expect(outcome(base, 'grossRentPerMonth')).toBe('ask');
  });

  it('a price the reader returned that is not in the text is asked about', () => {
    expect(outcome(run1(set({ askingPrice: box(1_840_000) })), 'purchasePrice')).toBe('ask');
  });

  it('a reader that quietly takes the market rent everywhere is caught by the stated average rent', () => {
    const market = set({
      unitMix: [mix('2 Bd / 2.5 Bth TH', 30, 1266, 1900), mix('3 Bd / 2.5 Bth TH', 36, 1268, 1910)],
      income: READER_ANSWER.income.map((l) => (l.label.value === 'Gross Potential Rent' ? line('Gross Potential Rent', 'rent', 1_508_400) : l)),
    });
    const r = run1(market).find((x) => x.key === 'rentAgreesWithStatedAverage')!;
    expect(r.outcome).toBe('ask');
  });

  it('does not complain about the rent against the average when the document is consistent', () => {
    const consistent = set({ unitMix: [mix('2 Bd / 2.5 Bth TH', 30, 1266, 1800), mix('3 Bd / 2.5 Bth TH', 36, 1268, 1858.33)] });
    expect(outcome(run1(consistent), 'rentAgreesWithStatedAverage')).toBe('auto');
  });

  it('a line the reader missed makes the document stop tying to its own NOI', () => {
    const missed = set({ expenses: READER_ANSWER.expenses.filter((l) => l.label.value !== 'RE Taxes') });
    const intake = groundIntake(coerceIntake('offering_memorandum', missed), COWICHE_TEXT);
    expect(documentChecks(intake).find((c) => c.label.startsWith('Income less costs'))!.ok).toBe(false);
  });

  it('with the income and expense page removed, nothing the reader took from it goes in without a question', () => {
    const rs = run1(READER_ANSWER, dropPage(9));
    for (const key of ['vacancyRate', 'otherIncomeAnnual', 'expenseRatio', 'capexReserveAnnual']) {
      const r = rs.find((x) => x.key === key);
      if (r) expect(r.outcome, key).toBe('ask');
    }
  });

  it('an expense line the reader was unsure of sends the ratio to the owner, with the reason', () => {
    const unsure = set({ expenses: READER_ANSWER.expenses.map((l) => (l.label.value === 'Landscaping' ? { ...l, amount: box(27_189, 0.5, 'Landscaping (est.)') } : l)) });
    const r = run1(unsure).find((x) => x.key === 'expenseRatio')!;
    expect(r.outcome).toBe('ask');
    expect(r.reasons.map((x) => x.check)).toContain('The reader was sure');
  });

  it('does not depend on the order the reader listed the lines in', () => {
    const shuffled = set({ income: [...READER_ANSWER.income].reverse(), expenses: [...READER_ANSWER.expenses].reverse(), unitMix: [...READER_ANSWER.unitMix].reverse() });
    const key = (rs: ReturnType<typeof run1>) => rs.map((r) => `${r.key}:${r.outcome}`).sort();
    expect(key(run1(shuffled))).toEqual(key(base));
  });

  it('across every mutation, no figure that was asked about in the baseline becomes automatic', () => {
    const mutations = [set({ askingPrice: box(1_840_000) }), set({ expenses: READER_ANSWER.expenses.filter((l) => l.label.value !== 'RE Taxes') }), set({ expenses: READER_ANSWER.expenses.map((l) => (l.label.value === 'Insurance' ? { ...l, amount: box(19_962, 0.4) } : l)) })];
    for (const m of mutations) {
      const rs = run1(m);
      for (const b of base.filter((x) => x.outcome === 'ask' && !x.key.startsWith('rentAgrees'))) {
        const now = rs.find((x) => x.key === b.key);
        if (now) expect(now.outcome, b.key).toBe('ask');
      }
    }
  });
});
