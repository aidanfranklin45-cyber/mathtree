/**
 * The evaluation set for reading documents. A case is a document's text, the answer the reader gave when it read that text, and an answer key written
 * by a person from the document. Running the cases through the same steps the app uses shows what a change to the reader, its prompt or the checks
 * did to the result: which figures came out right, which were sent to the owner, which numbers were found in the document, which checks tied.
 *
 * The cases here are made up. A real case is added the same way: the text of a real document (with names and contact details removed, since this
 * is committed), the reader's recorded answer, and the owner's answer key. The more real cases, the more a score means.
 */

export interface EvalCase {
  name: string;
  /** What the case shows. */
  about: string;
  documentText: string;
  /** The reader's recorded answer for the document, in the reader's own shape. */
  modelAnswer: Record<string, unknown>;
  answerKey: {
    /** The figures the underwriting should end up with (keys of the proposed changes). */
    inputs: Record<string, number>;
    /** Figures that must go to the owner as a question (unsure, or competing figures). */
    flagged: string[];
    /** Lines whose number is not in the document and must be marked so. */
    notInDocument: string[];
    /** The document's own arithmetic: each check's label starts with this, and it ties (or does not). */
    checks: Array<{ startsWith: string; ties: boolean }>;
  };
}

const box = (value: unknown, confidence = 1, evidence?: string) => ({ value, confidence, ...(evidence ? { evidence } : {}) });
const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
const mix = (type: string, count: number, rent: number) => ({ unitType: box(type), unitCount: box(count), avgSqFt: box(900), currentMonthlyRent: box(rent), marketMonthlyRent: box(null) });

const pageOne = ['--- Page 1 ---', 'Riverside Townhomes', '1 Riverside Dr', 'Asking price\t$18,400,000', 'Units\t66'];
const unitMix = ['--- Page 3 ---', 'Unit mix\tUnits\tCurrent rent', '2 Bed 2 Bath\t30\t1,800', '3 Bed 2 Bath\t36\t2,000'];
const incomeTable = (rent: string, vacancy: string, noi = '1,228,132', cap = '6.67%') => [
  '--- Page 4 ---', 'Income\tCurrent',
  `Gross Potential Rent\t${rent}`, `Vacancy\t(${vacancy})`, 'Other income\t54,268',
  'Expenses', 'Real Estate Taxes\t115,670', 'Insurance\t19,962', 'Utilities\t73,382', 'Management\t53,522',
  `Net Operating Income\t${noi}`, `Cap rate\t${cap}`,
];
const base = (over: Record<string, unknown> = {}) => ({
  address: box('1 Riverside Dr'), assetClass: box('multi_family'), askingPrice: box(18_400_000), unitCount: box(66),
  claimedNoi: box(1_228_132), claimedCapRatePercent: box(6.67),
  unitMix: [mix('2 Bed 2 Bath', 30, 1800), mix('3 Bed 2 Bath', 36, 2000)],
  income: [line('Gross Potential Rent', 'rent', 1_512_000), line('Vacancy', 'vacancy_credit_loss', -75_600), line('Other income', 'other_income', 54_268)],
  expenses: [line('Real Estate Taxes', 'property_tax', 115_670), line('Insurance', 'insurance', 19_962), line('Utilities', 'utilities', 73_382), line('Management', 'management', 53_522)],
  ...over,
});

const CLEAN_INPUTS = { grossRentPerMonth: 126_000, vacancyRate: 5, otherIncomeAnnual: 54_268, expenseRatio: 13.82, purchasePrice: 18_400_000, unitCount: 66 };

export const EVAL_CASES: EvalCase[] = [
  {
    name: 'a clean apartment memorandum',
    about: 'The unit mix and the income table agree, every number is in the text, and the document ties to its own NOI and cap rate.',
    documentText: [...pageOne, ...unitMix, ...incomeTable('1,512,000', '75,600')].join('\n'),
    modelAnswer: base(),
    answerKey: { inputs: CLEAN_INPUTS, flagged: [], notInDocument: [], checks: [{ startsWith: 'NOI over the price', ties: true }] },
  },
  {
    name: 'the rent is given in two places and they disagree',
    about: 'The unit mix gives 126,000 a month and the income table 120,900. Neither may be chosen silently: the owner is asked.',
    documentText: [...pageOne, ...unitMix, ...incomeTable('1,450,800', '72,540')].join('\n'),
    modelAnswer: base({ income: [line('Gross Potential Rent', 'rent', 1_450_800), line('Vacancy', 'vacancy_credit_loss', -72_540), line('Other income', 'other_income', 54_268)] }),
    // the costs are divided by the rent underwritten (the unit mix, 1,512,000), not by the 1,450,800 the income table prints
    answerKey: { inputs: CLEAN_INPUTS, flagged: ['grossRentPerMonth'], notInDocument: [], checks: [] },
  },
  {
    name: 'the reader returns a number that is not in the document',
    about: 'A "Late fees" line of 12,345 appears nowhere in the text. It must be marked as not found and sent to the owner, along with the figure it feeds.',
    documentText: [...pageOne, ...unitMix, ...incomeTable('1,512,000', '75,600')].join('\n'),
    modelAnswer: base({ income: [line('Gross Potential Rent', 'rent', 1_512_000), line('Vacancy', 'vacancy_credit_loss', -75_600), line('Other income', 'other_income', 54_268), line('Late fees', 'other_income', 12_345)] }),
    answerKey: { inputs: { grossRentPerMonth: 126_000, vacancyRate: 5, expenseRatio: 13.82, purchasePrice: 18_400_000, unitCount: 66 }, flagged: ['otherIncomeAnnual'], notInDocument: ['Late fees'], checks: [] },
  },
  {
    name: 'the document does not add up to its own NOI',
    about: 'The memorandum prints an NOI that its own income and costs do not give: a line was missed or misread. The check must say so.',
    documentText: [...pageOne, ...unitMix, ...incomeTable('1,512,000', '75,600', '1,400,000', '7.61%')].join('\n'),
    modelAnswer: base({ claimedNoi: box(1_400_000), claimedCapRatePercent: box(7.61) }),
    answerKey: { inputs: CLEAN_INPUTS, flagged: [], notInDocument: [], checks: [{ startsWith: 'Income less costs', ties: false }] },
  },
];
