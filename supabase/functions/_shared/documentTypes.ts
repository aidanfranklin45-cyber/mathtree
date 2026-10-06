/**
 * Step one of parsing: decide what kind of document this is, because the kind decides which questions are worth asking.
 * A P&L cannot tell you about escalation clauses, and a lease cannot tell you the expense ratio. Asking a document for what it
 * cannot hold only produces guesses, so each type has a profile: what it teaches, how far to trust it, and what to ask.
 *
 * `classifyDocument` is the cheap deterministic pass (filename and keyword scoring). When it is not clear-cut the caller falls back
 * to the LLM, which is given the same `DOCUMENT_TYPES` list and must answer with one of them or `unknown`.
 */

import type { DocumentType, Reliability } from './intake.ts';

export interface DocumentProfile {
  type: DocumentType;
  label: string;
  reliability: Reliability;
  /** What this document can teach the engine, in plain words (shown on the upload screen). */
  teaches: string;
  /**
   * The questions put to the model for this type, in the words it should answer in. Each maps to a field of the type's intake payload.
   * Anything the document cannot answer must come back null.
   */
  questions: string[];
  /** Engine areas this document feeds, so the review screen can say what a document improved. */
  feeds: Array<'rent' | 'leases' | 'vacancy' | 'expenses' | 'financing' | 'price' | 'identity'>;
  /** Lowercase phrases whose presence suggests this type. A phrase counts once. */
  signals: string[];
  /** Filename fragments (lowercase) that suggest this type. */
  filenameHints: string[];
}

export const DOCUMENT_PROFILES: Record<Exclude<DocumentType, 'unknown'>, DocumentProfile> = {
  lease: {
    type: 'lease',
    label: 'Lease',
    reliability: 'executed',
    teaches: 'How rent actually behaves: term, escalations, who pays expenses, renewal options and the tenant\'s exit rights.',
    questions: [
      'Who is the tenant, and what premises (unit, rentable square feet) are leased?',
      'What are the commencement and expiration dates?',
      'What is the base rent, and is it stated per month, per year, or per square foot? Quote it exactly as written.',
      'How does rent change: a fixed percent, a fixed amount, CPI, or a schedule of steps? How often? Copy any schedule exactly.',
      'Who pays operating expenses: is it NNN, gross, modified gross, or full service? Is there a pro-rata share, a base year, or a CAM cap?',
      'Are there renewal options: how many, how long, and is the renewal rent fixed, a stated schedule, or fair market?',
      'Is there free rent, a tenant improvement allowance, a security deposit, or a personal guaranty?',
      'Can the tenant (or landlord) terminate early, and is there a fee? Is there percentage rent?',
      'Anything unusual: exclusives, co-tenancy, go-dark, relocation, purchase options?',
    ],
    feeds: ['leases', 'rent', 'expenses'],
    signals: ['lessor', 'lessee', 'landlord', 'tenant shall', 'commencement date', 'base rent', 'premises', 'term of lease', 'renewal option', 'security deposit', 'triple net', 'estoppel'],
    filenameHints: ['lease', 'amendment', 'estoppel'],
  },
  rent_roll: {
    type: 'rent_roll',
    label: 'Rent roll',
    reliability: 'reported',
    teaches: 'Who is in the building today and what each pays: occupancy, rent per tenant, and when leases end.',
    questions: [
      'What is the as-of date, and is the rent column monthly or annual?',
      'For each row: unit, tenant, square feet, rent, lease start, lease end, and whether it is occupied, vacant, month-to-month or on notice.',
      'What totals does the roll itself print (total rent, unit count, occupancy)?',
    ],
    feeds: ['leases', 'rent', 'vacancy'],
    signals: ['rent roll', 'unit #', 'unit no', 'lease from', 'lease to', 'tenant name', 'move-in', 'sq ft', 'occupied', 'vacant', 'market rent', 'total units'],
    filenameHints: ['rent roll', 'rentroll', 'rr_', 'tenant list'],
  },
  operating_statement: {
    type: 'operating_statement',
    label: 'Operating statement (T12 / P&L)',
    reliability: 'reported',
    teaches: 'What the property really earned and spent: the expense ratio, other income, and the vacancy actually suffered.',
    questions: [
      'What period does it cover (start and end)?',
      'List every income line with its category and the amount for the period.',
      'List every expense line with its category and the amount for the period. Mark reserves, debt service and depreciation as such.',
      'What totals does the statement itself print (effective gross income, total expenses, NOI)?',
    ],
    feeds: ['expenses', 'vacancy', 'rent'],
    signals: ['profit and loss', 'income statement', 't-12', 't12', 'trailing 12', 'net operating income', 'total operating expenses', 'effective gross income', 'repairs and maintenance', 'property taxes', 'management fee', 'noi'],
    filenameHints: ['t12', 't-12', 'p&l', 'p_l', 'pnl', 'operating statement', 'income statement', 'profit'],
  },
  offering_memorandum: {
    type: 'offering_memorandum',
    label: 'Offering memorandum',
    reliability: 'projected',
    teaches: 'Identity and the broker\'s story: address, size, asking price and the NOI and cap rate the seller is claiming.',
    questions: [
      'What is the property address, city, state, zip, parcel number (APN), asset class, net rentable square feet, land area (in acres, or in square feet if that is how it is printed), year built and unit count?',
      'What type of property is it (assetClass)? Decide from the whole document even when it never says so outright: apartments, townhomes or a unit mix with bedrooms is multi_family; a single house or condo is residential; self-storage units or RV/boat parking is storage; retail, office, industrial, medical or flex space is commercial. If you had to infer it, say what you based it on in the evidence and lower the confidence.',
      'What is the asking or list price and the stated occupancy?',
      'What NOI and cap rate does the memorandum claim? (Record these as claims.)',
      'Which tenants does it summarise?',
      'Unit mix: for each unit type, how many units, the average square feet, the current (in-place) monthly rent per unit and the market monthly rent per unit? Piece it together from anywhere in the text: a table, a sentence such as "30 two-bedroom and 36 three-bedroom units", or the row for the property itself in a rent comparables table (a rent there is the market or asking rent for that unit type unless the document says otherwise). Also give the average current rent and the average market rent per unit if the document states them. In the evidence, say where each figure came from. Use only figures that are printed as text, never an estimate, and leave a figure null when it is not printed.',
      'Income and expenses: list each income line and each expense line from the memorandum\'s annual table, using the CURRENT (in-place) column, with its amount as printed. Include vacancy, other income (utility reimbursements, pet, misc), and every expense line including reserves. Do not list subtotals or totals (such as total expenses, effective gross income or NOI).',
    ],
    feeds: ['identity', 'price'],
    signals: ['offering memorandum', 'confidential', 'investment highlights', 'executive summary', 'asking price', 'pro forma', 'broker', 'cap rate', 'property overview', 'disclaimer'],
    filenameHints: ['om', 'offering', 'memorandum', 'brochure', 'flyer'],
  },
  loan_terms: {
    type: 'loan_terms',
    label: 'Loan terms',
    reliability: 'projected',
    teaches: 'The real financing: amount, rate, term versus amortization, interest-only period, fees and covenants.',
    questions: [
      'What are the loan amount and interest rate, and is the rate fixed, adjustable or interest-only?',
      'What is the term (when the balance is due) and, separately, the amortization period the payment is based on?',
      'Is there an interest-only period, an origination fee, a minimum DSCR or maximum LTV, or a prepayment penalty?',
    ],
    feeds: ['financing'],
    signals: ['term sheet', 'loan amount', 'interest rate', 'amortization', 'prepayment', 'origination fee', 'debt service coverage', 'maturity', 'lender', 'borrower', 'promissory note', 'balloon'],
    filenameHints: ['term sheet', 'termsheet', 'loan', 'quote', 'note'],
  },
  purchase_agreement: {
    type: 'purchase_agreement',
    label: 'Purchase agreement',
    reliability: 'executed',
    teaches: 'The agreed price and timeline: purchase price, closing date, earnest money and diligence period.',
    questions: ['What is the purchase price, closing date, earnest money, diligence period (days) and buyer closing costs?', 'What is the property address?'],
    feeds: ['price', 'identity'],
    signals: ['purchase and sale', 'purchase agreement', 'earnest money', 'closing date', 'due diligence period', 'seller', 'buyer', 'title company', 'escrow', 'purchase price'],
    filenameHints: ['psa', 'purchase', 'contract', 'p&s'],
  },
};

export const DOCUMENT_TYPES = Object.keys(DOCUMENT_PROFILES) as Array<Exclude<DocumentType, 'unknown'>>;

export interface DocumentClassification {
  type: DocumentType;
  /** 0..1. Below `CLEAR_ENOUGH` the caller should ask the LLM (or the owner) rather than trust this. */
  confidence: number;
  /** Every type with its score, best first, so the review screen can offer the runner-up. */
  scores: Array<{ type: Exclude<DocumentType, 'unknown'>; score: number }>;
  /** The phrases that matched the winner. */
  matched: string[];
}

/** Winner must have at least this many points and beat the runner-up by this margin before the deterministic answer is trusted. */
export const CLEAR_ENOUGH = { minScore: 3, margin: 2 };

/** Keyword and filename scoring over the first part of the document. Cheap and testable; not a substitute for the LLM on messy files. */
export function classifyDocument(args: { text: string; filename?: string }): DocumentClassification {
  const text = args.text.slice(0, 20000).toLowerCase();
  const name = (args.filename ?? '').toLowerCase();

  const scored = DOCUMENT_TYPES.map((type) => {
    const p = DOCUMENT_PROFILES[type];
    const matched = p.signals.filter((s) => text.includes(s));
    // A filename hint is worth two content phrases: people name files for what they are.
    const nameHits = p.filenameHints.filter((h) => name.includes(h)).length;
    return { type, score: matched.length + (nameHits > 0 ? 2 : 0), matched };
  }).sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scored;
  const clear = best.score >= CLEAR_ENOUGH.minScore && best.score - (runnerUp?.score ?? 0) >= CLEAR_ENOUGH.margin;
  const confidence = clear ? Math.min(1, 0.5 + 0.1 * (best.score - (runnerUp?.score ?? 0))) : Math.min(0.49, 0.1 * best.score);

  return {
    type: clear ? best.type : 'unknown',
    confidence,
    scores: scored.map(({ type, score }) => ({ type, score })),
    matched: best.matched,
  };
}
