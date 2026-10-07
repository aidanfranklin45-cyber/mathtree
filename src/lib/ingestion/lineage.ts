/**
 * The paper trail from the document to the underwriting. A language model reads a document and sorts what it finds into categories, and it
 * cannot show its working. This does the part that can be shown: for each number the reader returned, it looks in the document's own text for
 * that number (and the line it is on), says which category the reader put it in, and says what that category feeds. A number that is not in the
 * document at all is flagged, because the reader cannot have read it: it computed it, or invented it.
 *
 * Pure: it works on the text the document was read from and the reader's answer. Nothing here calls a model.
 */

import type { ExpenseCategory, IncomeCategory, IntakeDocument, OfferingMemorandumIntake, OperatingStatementIntake, Sourced } from './intake';
import { val } from './intake';
import { NON_OPERATING } from './normalize';

/** The marker the extractor puts at the top of every PDF page, so a figure can be traced to its page. */
export const PAGE_MARKER = /^--- Page (\d+) ---$/;

export interface TraceRow {
  document: string;
  section: 'Income' | 'Expense' | 'Unit mix' | 'Figure';
  /** The line's name as the reader gave it. */
  label: string;
  amount: number | null;
  /** The category the reader put it in. */
  category: string | null;
  /** What that category feeds, in words. */
  feeds: string;
  page: number | null;
  line: number | null;
  /** The line of the document it was found on. */
  snippet: string | null;
  /** The deal inputs this line feeds, so a figure can be traced back to the lines it was built from. */
  keys?: string[];
  /** The number appears in the document text. False means the reader cannot have read it as printed. */
  found: boolean;
  /** How many lines of the document carry the number (more than one means the match is a best guess). */
  matches: number;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ways a number is printed in a document: with thousands separators or without, with cents or without. */
export function numberForms(n: number): string[] {
  const abs = Math.abs(n);
  const forms = new Set<string>([
    abs.toLocaleString('en-US', { maximumFractionDigits: 6 }),
    String(abs),
  ]);
  if (!Number.isInteger(abs)) {
    forms.add(abs.toFixed(2));
    forms.add(abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  return [...forms];
}

interface DocLine { text: string; line: number; page: number | null }

/** The document's lines, each with its number and the page it is on. */
export function documentLines(text: string): DocLine[] {
  const out: DocLine[] = [];
  let page: number | null = null;
  text.split('\n').forEach((raw, i) => {
    const m = PAGE_MARKER.exec(raw.trim());
    if (m) { page = Number(m[1]); return; }
    out.push({ text: raw.trim(), line: i + 1, page });
  });
  return out;
}

const hasNumber = (text: string, n: number): boolean =>
  numberForms(n).some((f) => new RegExp(`(?<![\\d.,])${escapeRe(f)}(?!\\d|[.,]\\d)`).test(text));

const firstWord = (label: string): string => (label.toLowerCase().match(/[a-z]{3,}/g) ?? [])[0] ?? '';

/** Where a number is in the document: the line that carries it, preferring one that also carries the label's first word. */
export function locate(lines: DocLine[], amount: number, label = ''): { page: number | null; line: number; snippet: string; matches: number } | null {
  const carrying = lines.filter((l) => hasNumber(l.text, amount));
  if (carrying.length === 0) return null;
  const word = firstWord(label);
  const best = (word && carrying.find((l) => l.text.toLowerCase().includes(word))) || carrying[0];
  return { page: best.page, line: best.line, snippet: best.text.length > 160 ? `${best.text.slice(0, 159)}…` : best.text, matches: carrying.length };
}

/** The deal inputs each kind of income line feeds. Rent is also the base the vacancy and the expense ratio are measured against. */
const INCOME_KEYS: Record<IncomeCategory, string[]> = {
  rent: ['grossRentPerMonth', 'vacancyRate', 'expenseRatio'],
  recoveries: ['expenseRatio'],
  other_income: ['otherIncomeAnnual'],
  vacancy_credit_loss: ['vacancyRate'],
  other: [],
};

/** The deal inputs an expense line feeds: the reserve has its own input, management is the owner's decision, the rest make up the expense ratio. */
export function expenseKeys(category: ExpenseCategory | null, assetClass: string | null): string[] {
  if (category === null || category === 'management' || NON_OPERATING.has(category)) return category === 'reserves_capex' ? ['capexReserveAnnual'] : [];
  if (assetClass === 'storage' && (category === 'payroll' || category === 'marketing')) return [];
  return ['expenseRatio'];
}

const INCOME_FEEDS: Record<IncomeCategory, string> = {
  rent: 'Rent',
  recoveries: 'Taken off the costs (tenant reimbursements)',
  other_income: 'Other income',
  vacancy_credit_loss: 'Vacancy rate',
  other: 'Not used',
};

/** What an expense line becomes. Follows the rules the figures are built with (toDealInputs). */
export function expenseFeeds(category: ExpenseCategory | null, assetClass: string | null): string {
  if (category === null) return 'Not used (no category)';
  if (category === 'management') return 'Not in the expense ratio (hiring a manager is your decision)';
  if (category === 'reserves_capex') return 'Replacement reserve (its own input)';
  if (NON_OPERATING.has(category)) return 'Left out: not an operating cost';
  if (assetClass === 'storage' && (category === 'payroll' || category === 'marketing')) return 'Charged separately (storage payroll and marketing)';
  return 'Expense ratio';
}

const incomeFeeds = (category: IncomeCategory | null): string => (category ? INCOME_FEEDS[category] : 'Not used (no category)');

type LineLike<C extends string> = { label: Sourced<string>; category: Sourced<C>; amount: Sourced<number> };

/** Each line of the document the reader returned, with where it is in the document and what it was sorted into. */
export function traceDocument(doc: IntakeDocument, text: string, documentName = 'Document'): TraceRow[] {
  if (doc.documentType !== 'offering_memorandum' && doc.documentType !== 'operating_statement') return [];
  const lines = documentLines(text);
  const rows: TraceRow[] = [];
  const add = (section: TraceRow['section'], label: string, amount: number | null, category: string | null, feeds: string, keys: string[] = []) => {
    const where = amount === null ? null : locate(lines, amount, label);
    rows.push({
      document: documentName, section, label, amount, category, feeds, keys,
      page: where?.page ?? null, line: where?.line ?? null, snippet: where?.snippet ?? null, found: amount === null ? true : where !== null, matches: where?.matches ?? 0,
    });
  };
  const assetClass = doc.documentType === 'offering_memorandum' ? (val(doc.assetClass) as string | null) : null;
  const income: LineLike<IncomeCategory>[] = doc.income;
  const expenses: LineLike<ExpenseCategory>[] = doc.expenses;
  for (const l of income) {
    const category = val(l.category) as IncomeCategory | null;
    add('Income', val(l.label) ?? '(no label)', val(l.amount), category, incomeFeeds(category), category ? INCOME_KEYS[category] : []);
  }
  for (const l of expenses) {
    const category = val(l.category) as ExpenseCategory | null;
    add('Expense', val(l.label) ?? '(no label)', val(l.amount), category, expenseFeeds(category, assetClass), expenseKeys(category, assetClass));
  }
  if (doc.documentType === 'offering_memorandum') {
    const om: OfferingMemorandumIntake = doc;
    for (const r of om.unitMix) {
      const rent = val(r.currentMonthlyRent);
      if (rent === null) continue;
      add('Unit mix', `${val(r.unitType) ?? 'Unit type'} (${val(r.unitCount) ?? '?'} units), current rent a month`, rent, null, 'Rent (units times current rent)', ['grossRentPerMonth']);
    }
    const figure = (label: string, field: Sourced<number>, feeds: string, keys: string[] = []) => { const v = val(field); if (v !== null) add('Figure', label, v, null, feeds, keys); };
    const text = (label: string, field: Sourced<string>, keys: string[]) => {
      const v = val(field);
      if (v === null || String(v).trim() === '') return;
      const where = locateText(lines, String(v));
      rows.push({ document: documentName, section: 'Figure', label, amount: null, category: null, feeds: label, keys, page: where?.page ?? null, line: where?.line ?? null, snippet: where?.snippet ?? null, found: where !== null, matches: where ? 1 : 0 });
    };
    figure('Asking price', om.askingPrice, 'Purchase price', ['purchasePrice']);
    figure('Square feet', om.squareFeet, 'Square feet', ['squareFeet']);
    figure('Unit count', om.unitCount, 'Unit count', ['unitCount']);
    figure('Year built', om.yearBuilt, 'Year built', ['yearBuilt']);
    figure('Land area (acres)', om.lotAcres, 'Acres', ['acres']);
    figure('Land area (square feet)', om.lotSqFt, 'Acres (converted from square feet)', ['acres']);
    text('Address', om.address, ['address']);
    text('Parcel number (APN)', om.apn, ['primaryApn']);
    figure('Seller\'s stated NOI', om.claimedNoi, 'Shown for comparison, never used');
    figure('Seller\'s stated cap rate', om.claimedCapRatePercent, 'Shown for comparison, never used');
  }
  return rows;
}

/** Where a piece of text is in the document: the first line that carries it, ignoring case and spacing. */
export function locateText(lines: DocLine[], text: string): { page: number | null; line: number; snippet: string } | null {
  const norm = (x: string) => x.toLowerCase().replace(/[s,]+/g, ' ').trim();
  const want = norm(text);
  if (!want) return null;
  const hit = lines.find((l) => norm(l.text).includes(want));
  return hit ? { page: hit.page, line: hit.line, snippet: hit.text.length > 160 ? `${hit.text.slice(0, 159)}…` : hit.text } : null;
}

/** A confidence this low sends the figure to the owner as one the reader could not have read as printed. */
export const UNGROUNDED_CONFIDENCE = 0.3;
export const UNGROUNDED_NOTE = 'This number was not found in the document text.';

/**
 * The reader's answer with every number that is not in the document marked as unsure. A language model can compute or invent a number and
 * report it with confidence; the document cannot be argued with. The result is a copy: the reader's own answer is left as it was.
 */
export function groundIntake<T extends IntakeDocument>(doc: T, text: string): T {
  if (doc.documentType !== 'offering_memorandum' && doc.documentType !== 'operating_statement') return doc;
  const lines = documentLines(text);
  const copy: T = JSON.parse(JSON.stringify(doc));
  const check = (f: Sourced<number> | undefined) => {
    if (!f || typeof f.value !== 'number') return;
    if (locate(lines, f.value) === null) {
      f.confidence = Math.min(f.confidence, UNGROUNDED_CONFIDENCE);
      f.evidence = UNGROUNDED_NOTE;
    }
  };
  const stmt = copy as unknown as OperatingStatementIntake;
  for (const l of stmt.income ?? []) check(l.amount);
  for (const l of stmt.expenses ?? []) check(l.amount);
  if (copy.documentType === 'offering_memorandum') {
    const om = copy as unknown as OfferingMemorandumIntake;
    for (const r of om.unitMix ?? []) { check(r.unitCount); check(r.currentMonthlyRent); }
    for (const f of [om.askingPrice, om.squareFeet, om.unitCount, om.yearBuilt, om.lotAcres, om.lotSqFt, om.claimedNoi, om.claimedCapRatePercent]) check(f);
  }
  return copy;
}
