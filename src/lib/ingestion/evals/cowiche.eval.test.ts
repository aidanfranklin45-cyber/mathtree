/**
 * Does the reader know when it does not know? The Cowiche Creek memorandum (the trimmed text in fixtures/) is run through the same steps the app
 * uses, against two investor profiles, and each figure is expected to end up in one of three places: put in without a question (auto), put to the
 * owner (ask), or listed as missing. The score that matters is the cost of a wrong figure that went in quietly, not how many figures were right.
 *
 * The reader's answer below is SIMULATED: written by hand the way a competent reader would answer this text, slips included. It tests the checks
 * and the asking, not the model. Replace `READER_ANSWER` with a recorded `parse-document` response when one can be captured; the expectations stay.
 *
 * A test marked `it.fails` is a known gap: the behaviour the policy wants and the code does not yet do. When the gap is closed the test turns red
 * and the marker is removed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { suggestedStartingPoints, type UnderwritingAssumptions } from '@engine/underwritingAssumptions';
import { setAssumptionDefaults } from '../../engine/assumptionDefaults';
import { attachVariances, proposeChanges, type Proposal } from '../apply';
import { expectedFor } from '../expected';
import { groundIntake, traceDocument } from '../lineage';
import { documentChecks } from '../validate';
import { openQuestions } from '../openQuestions';
import { COWICHE_TEXT } from './fixtures/cowicheCreek';

const box = (value: unknown, confidence = 1, evidence?: string) => ({ value, confidence, ...(evidence ? { evidence } : {}) });
const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
const mix = (type: string, count: number, sf: number, rent: number) => ({ unitType: box(type), unitCount: box(count), avgSqFt: box(sf), currentMonthlyRent: box(rent), marketMonthlyRent: box(null) });

/** What a competent reader returns for pages 4, 5, 9, 11 and 12. The per-type rents come from the comparables row for the property itself (1,850 and 1,950), the only place they are printed. */
const READER_ANSWER = {
  address: box('5101 W Powerhouse Rd'), city: box('Yakima'), state: box('WA'), zip: box('98908'), apn: box('181309-41011'),
  assetClass: box('multi_family'), askingPrice: box(18_400_000), squareFeet: box(83_628), lotSqFt: box(386_377), yearBuilt: box(2023), unitCount: box(66),
  claimedNoi: box(1_093_745), claimedCapRatePercent: box(5.94), averageCurrentRent: box(1832), averageMarketRent: box(1905),
  unitMix: [mix('2 Bd / 2.5 Bth TH', 30, 1266, 1850), mix('3 Bd / 2.5 Bth TH', 36, 1268, 1950)],
  income: [
    line('Gross Potential Rent', 'rent', 1_450_800), line('Vacancy', 'vacancy_credit_loss', -72_540), line('RUBS', 'recoveries', 103_932),
    line('Pet', 'other_income', 34_686), line('Misc. Income', 'other_income', 19_582),
  ],
  expenses: [
    line('Maint/Repair', 'repairs_maintenance', 33_000), line('Turnover', 'repairs_maintenance', 11_880), line('Payroll', 'payroll', 32_000), line('R&M Payroll', 'payroll', 25_000),
    line('Contract Services', 'other', 8_941), line('Landscaping', 'other', 27_189), line('Marketing', 'marketing', 7_720), line('Admin', 'other', 10_696),
    line('Reserves', 'reserves_capex', 16_500), line('RE Taxes', 'property_tax', 115_670), line('Insurance', 'insurance', 19_962),
    line('Utilities W/S/G/E', 'utilities', 73_382), line('Management', 'management', 53_522),
  ],
};

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

  it("finds that the document does not add up to its own NOI, and says so (its net rental income is 5.5% off the rent, not the printed 5% vacancy)", () => {
    const check = documentChecks(groundIntake(coerceIntake('offering_memorandum', READER_ANSWER), COWICHE_TEXT)).find((c) => c.label.startsWith('Income less costs'))!;
    expect(check.ok).toBe(false);
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

  // The policy: these are the owner's call even when the document states a figure. Neither is asked today.
  it.fails('asks about the management fee: the table charges 53,522 (3.5% of income) while the text calls it "above-market (~5% of EGI)" and "self-managed"', () => {
    expect(proposal.changes.some((c) => /management/i.test(c.key) && c.unsure)).toBe(true);
  });

  it.fails('asks how the utility reimbursements (RUBS, 103,932) are treated: taken off the costs, or counted as income', () => {
    expect(proposal.changes.some((c) => /rubs|reimburse|recover/i.test(c.key) && c.unsure)).toBe(true);
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
