import { describe, it, expect } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { proposeChanges } from './apply';
import { documentLines, expenseFeeds, groundIntake, locate, numberForms, traceDocument, UNGROUNDED_NOTE } from './lineage';

const TEXT = [
  '--- Page 1 ---',
  'Cowiche Creek Townhomes',
  'Asking price\t$18,400,000',
  'Units\t66',
  '--- Page 4 ---',
  'Income\tCurrent',
  'Gross Potential Rent\t1,450,800',
  'RUBS reimbursements\t103,932',
  'Pet and other income\t54,268',
  'Vacancy\t(72,540)',
  'Expenses',
  'Real Estate Taxes\t115,670',
  'Management\t53,522',
  'Reserves\t16,500',
  'Mortgage payment\t900,000',
].join('\n');

const box = (value: unknown, confidence = 1) => ({ value, confidence });
const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
const memo = (extraIncome: unknown[] = []) => coerceIntake('offering_memorandum', {
  address: box('1 Main St'), assetClass: box('multi_family'), askingPrice: box(18_400_000), unitCount: box(66),
  income: [line('Gross Potential Rent', 'rent', 1_450_800), line('RUBS reimbursements', 'recoveries', 103_932), line('Pet and other income', 'other_income', 54_268), line('Vacancy', 'vacancy_credit_loss', -72_540), ...extraIncome],
  expenses: [line('Real Estate Taxes', 'property_tax', 115_670), line('Management', 'management', 53_522), line('Reserves', 'reserves_capex', 16_500), line('Mortgage payment', 'debt_service', 900_000)],
});

describe('finding a number in the document', () => {
  it('knows the ways a number is printed', () => {
    expect(numberForms(1_450_800)).toContain('1,450,800');
    expect(numberForms(1831.82)).toContain('1,831.82');
  });

  it('gives the page and the line, and the line itself', () => {
    const where = locate(documentLines(TEXT), 1_450_800, 'Gross Potential Rent')!;
    expect(where.page).toBe(4);
    expect(where.snippet).toContain('Gross Potential Rent');
    expect(where.matches).toBe(1);
  });

  it('does not take part of a longer number for the number', () => {
    expect(locate(documentLines('Total\t11,450,800'), 1_450_800)).toBeNull();
    expect(locate(documentLines('Total\t1,450,8001'), 1_450_800)).toBeNull();
  });

  it('finds a figure printed in parentheses or without its thousands separators', () => {
    expect(locate(documentLines('Vacancy\t(72,540)'), 72_540)).not.toBeNull();
    expect(locate(documentLines('Price 18400000'), 18_400_000)).not.toBeNull();
  });
});

describe('the paper trail from the document to the underwriting', () => {
  const rows = traceDocument(memo(), TEXT, 'OM.pdf');
  const row = (label: string) => rows.find((r) => r.label === label)!;

  it('says what each line was sorted into and what that feeds', () => {
    expect(row('Gross Potential Rent')).toMatchObject({ section: 'Income', category: 'rent', feeds: 'Rent', page: 4, found: true });
    expect(row('RUBS reimbursements').feeds).toContain('Taken off the costs');
    expect(row('Pet and other income').feeds).toBe('Other income');
    expect(row('Vacancy').feeds).toBe('Vacancy rate');
    expect(row('Real Estate Taxes').feeds).toBe('Expense ratio');
    expect(row('Management').feeds).toContain('Not in the expense ratio');
    expect(row('Reserves').feeds).toContain('Replacement reserve');
    expect(row('Mortgage payment').feeds).toContain('not an operating cost');
  });

  it('names the document, and the single figures too', () => {
    expect(rows.every((r) => r.document === 'OM.pdf')).toBe(true);
    expect(rows.find((r) => r.label === 'Asking price')).toMatchObject({ section: 'Figure', feeds: 'Purchase price', page: 1, found: true });
  });

  it('charges storage payroll separately', () => {
    expect(expenseFeeds('payroll', 'storage')).toContain('separately');
    expect(expenseFeeds('payroll', 'multi_family')).toBe('Expense ratio');
  });

  it('flags a number that is not in the document at all', () => {
    const made = traceDocument(memo([line('Late fees', 'other_income', 12_345)]), TEXT, 'OM.pdf');
    expect(made.find((r) => r.label === 'Late fees')).toMatchObject({ found: false, page: null, snippet: null });
  });
});

describe('a number the document does not contain goes to the owner', () => {
  it('lowers its confidence, notes why, and leaves the reader\'s own answer untouched', () => {
    const original = memo([line('Late fees', 'other_income', 12_345)]);
    const grounded = groundIntake(original, TEXT);
    const late = (d: typeof original) => (d as any).income.find((l: any) => l.label.value === 'Late fees').amount;
    expect(late(grounded)).toMatchObject({ confidence: 0.3, evidence: UNGROUNDED_NOTE });
    expect(late(original).confidence).toBe(1);
  });

  it('sends the figure it feeds to the owner as unsure, and not the ones that are in the document', () => {
    const p = proposeChanges([groundIntake(memo([line('Late fees', 'other_income', 12_345)]), TEXT)], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    expect(p.changes.find((c) => c.key === 'otherIncomeAnnual')!.unsure).toBe(true);
    expect(p.changes.find((c) => c.key === 'purchasePrice')!.unsure).toBeFalsy();
  });

  it('leaves a document whose numbers are all there as the reader gave it', () => {
    const p = proposeChanges([groundIntake(memo(), TEXT)], { asset_class: 'multi-unit', purchase_price: null, inputs: {} });
    expect(p.changes.filter((c) => c.unsure)).toHaveLength(0);
  });
});
