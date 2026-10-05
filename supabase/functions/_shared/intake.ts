/**
 * The intake schema: what a document parser hands to the engine. Pure types, no behaviour.
 *
 * Two rules shape everything here:
 * 1. The parser reads and labels. It never computes. Every number is a value found in the document (or null when the document does not
 *    say), together with where it came from. Annualising, summing, ratios and unit conversion are done in code (`toDealInputs.ts`).
 * 2. What a document can teach depends on what kind of document it is. A lease teaches lease dynamics; a P&L teaches the expense
 *    ratio; an offering memorandum teaches little that is reliable. So the parser first decides the document type
 *    (`documentTypes.ts`) and then asks only the questions that type can answer (one payload type per document type below).
 */

/** Where a value came from. `llm` and `deterministic` are parsing steps; `typed` is the owner's own entry on the review screen. */
export type FieldSource = 'typed' | 'deterministic' | 'llm' | 'county_gis' | 'derived';

/**
 * One extracted value. `value` is null (never 0, never a guess) when the document does not state it.
 * `evidence` is a short verbatim quote or cell reference so the review screen can show the owner where it was read.
 */
export interface Sourced<T> {
  value: T | null;
  source: FieldSource;
  /** 0..1. A deterministic exact match is 1; an LLM reading is whatever it reports, clamped. */
  confidence: number;
  evidence?: string;
}

type S<T> = Sourced<T>;

/** ISO date `YYYY-MM-DD`. */
export type IsoDate = string;

export type DocumentType =
  | 'lease'
  | 'rent_roll'
  | 'operating_statement' // T12 / trailing P&L / income statement
  | 'offering_memorandum'
  | 'loan_terms' // term sheet, loan quote, note
  | 'purchase_agreement'
  | 'unknown';

/**
 * How far a figure from this kind of document can be trusted:
 * - `executed`: a signed contract; the terms are what the parties agreed
 * - `reported`: a seller's or manager's record of what happened; checkable, not guaranteed
 * - `projected`: marketing or a forecast; a claim to test, never an input to adopt as-is
 */
export type Reliability = 'executed' | 'reported' | 'projected';

// ---------------------------------------------------------------------------
// Lease (executed). The richest source of the dynamics the engine models.
// ---------------------------------------------------------------------------

export type ExpenseStructure = 'NNN' | 'Gross' | 'Modified Gross' | 'Full Service';
export type EscalationKind = 'fixed_percent' | 'fixed_amount' | 'cpi' | 'stepped_schedule' | 'none';

export interface RentStep {
  /** The month (1-based) of the lease term this rent starts, or a date; whichever the lease states. */
  fromMonth: S<number>;
  fromDate: S<IsoDate>;
  monthlyRent: S<number>;
}

export interface LeaseIntake {
  documentType: 'lease';
  tenantName: S<string>;
  premises: S<string>;
  /** Rentable square feet of the leased space. */
  squareFeet: S<number>;
  commencementDate: S<IsoDate>;
  expirationDate: S<IsoDate>;
  /** Base rent as stated, with the period stated alongside so code (not the model) converts it. */
  baseRent: S<number>;
  baseRentPeriod: S<'monthly' | 'annual' | 'per_sf_annual' | 'per_sf_monthly'>;
  escalationKind: S<EscalationKind>;
  /** Percent for fixed_percent, dollars per period for fixed_amount; the CPI cap for cpi. */
  escalationValue: S<number>;
  escalationFrequency: S<'annual' | 'monthly' | 'every_n_years' | 'at_renewal'>;
  /** For stepped schedules, the steps exactly as written. */
  rentSteps: RentStep[];
  expenseStructure: S<ExpenseStructure>;
  /** Tenant's share of building expenses, as a percent, when it pays a pro-rata share. */
  proRataSharePercent: S<number>;
  /** The year whose expenses a gross-type lease absorbs before the tenant starts paying increases. */
  baseYear: S<number>;
  camCapPercent: S<number>;
  /** Renewal options as written. */
  renewalOptionCount: S<number>;
  renewalOptionYears: S<number>;
  renewalRentBasis: S<'fixed_percent' | 'fair_market' | 'stated_schedule' | 'not_stated'>;
  freeRentMonths: S<number>;
  tenantImprovementAllowance: S<number>;
  securityDeposit: S<number>;
  hasPersonalGuaranty: S<boolean>;
  /** An early-termination right for the tenant (or landlord), and any fee for using it. */
  earlyTerminationRight: S<boolean>;
  earlyTerminationFee: S<number>;
  percentageRentPercent: S<number>;
  /** Plain text of anything unusual (exclusives, co-tenancy, go-dark, relocation). Not interpreted by code. */
  specialProvisions: S<string>;
}

// ---------------------------------------------------------------------------
// Rent roll (reported)
// ---------------------------------------------------------------------------

export interface RentRollRow {
  unit: S<string>;
  tenantName: S<string>;
  squareFeet: S<number>;
  monthlyRent: S<number>;
  leaseStartDate: S<IsoDate>;
  leaseEndDate: S<IsoDate>;
  status: S<'occupied' | 'vacant' | 'month_to_month' | 'notice_to_vacate'>;
  securityDeposit: S<number>;
  /** Free text from the roll's own comments column. */
  note: S<string>;
}

export interface RentRollIntake {
  documentType: 'rent_roll';
  asOfDate: S<IsoDate>;
  /** What the rent column holds, as labelled on the roll. Code converts; the model only reports the label. */
  rentPeriod: S<'monthly' | 'annual'>;
  rows: RentRollRow[];
  /** The roll's own printed totals, kept so a validator can compare them with the sum of the rows. */
  reportedTotalRent: S<number>;
  reportedUnitCount: S<number>;
  reportedOccupancyPercent: S<number>;
}

// ---------------------------------------------------------------------------
// Operating statement: T12 / P&L (reported)
// ---------------------------------------------------------------------------

export type IncomeCategory = 'rent' | 'recoveries' | 'other_income' | 'vacancy_credit_loss' | 'other';
export type ExpenseCategory =
  | 'property_tax'
  | 'insurance'
  | 'utilities'
  | 'repairs_maintenance'
  | 'management'
  | 'payroll'
  | 'marketing'
  | 'professional_fees'
  | 'reserves_capex' // listed for visibility; code excludes it from operating expenses
  | 'debt_service' // likewise excluded
  | 'depreciation_amortization' // likewise excluded
  | 'other';

export interface StatementLine<C extends string> {
  label: S<string>;
  category: S<C>;
  /** The amount for the whole statement period, as printed. Expenses are positive numbers. */
  amount: S<number>;
}

export interface OperatingStatementIntake {
  documentType: 'operating_statement';
  periodStart: S<IsoDate>;
  periodEnd: S<IsoDate>;
  income: StatementLine<IncomeCategory>[];
  expenses: StatementLine<ExpenseCategory>[];
  reportedEffectiveGrossIncome: S<number>;
  reportedTotalExpenses: S<number>;
  reportedNoi: S<number>;
}

// ---------------------------------------------------------------------------
// Offering memorandum (projected): identity and claims to test
// ---------------------------------------------------------------------------

export interface OfferingMemorandumIntake {
  documentType: 'offering_memorandum';
  address: S<string>;
  city: S<string>;
  state: S<string>;
  zip: S<string>;
  apn: S<string>;
  assetClass: S<'commercial' | 'multi_family' | 'residential' | 'storage'>;
  askingPrice: S<number>;
  squareFeet: S<number>;
  lotAcres: S<number>;
  /** The land area when the memorandum states it in square feet; code converts it to acres. */
  lotSqFt: S<number>;
  yearBuilt: S<number>;
  unitCount: S<number>;
  occupancyPercent: S<number>;
  /** The broker's figures. Kept apart from the engine's inputs on purpose: they are claims. */
  claimedNoi: S<number>;
  claimedCapRatePercent: S<number>;
  /** Tenant names and any lease facts the memorandum summarises; the leases themselves are the better source. */
  tenantSummaries: S<string>;
  /** The unit mix table: one row per unit type, with the current rent and the broker's market rent, as printed. */
  unitMix: UnitMixRow[];
  /** The memorandum's annual income and expense table, from its current (in-place) column. Subtotals and totals are not listed. */
  income: StatementLine<IncomeCategory>[];
  expenses: StatementLine<ExpenseCategory>[];
}

export interface UnitMixRow {
  unitType: S<string>;
  unitCount: S<number>;
  avgSqFt: S<number>;
  /** Per unit, per month, as printed. */
  currentMonthlyRent: S<number>;
  marketMonthlyRent: S<number>;
}

// ---------------------------------------------------------------------------
// Loan terms (executed once signed; a quote is `projected`)
// ---------------------------------------------------------------------------

export interface LoanTermsIntake {
  documentType: 'loan_terms';
  loanAmount: S<number>;
  interestRatePercent: S<number>;
  rateType: S<'fixed' | 'arm' | 'interest_only' | 'seller_financing'>;
  /** The maturity: when the balance is due. Not the same as the amortization period. */
  termYears: S<number>;
  /** The period the payment is calculated over. Often longer than the term (a balloon pays the rest at maturity). */
  amortizationYears: S<number>;
  interestOnlyYears: S<number>;
  originationFeePercent: S<number>;
  minDscr: S<number>;
  maxLtvPercent: S<number>;
  prepaymentPenalty: S<string>;
}

// ---------------------------------------------------------------------------
// Purchase agreement (executed)
// ---------------------------------------------------------------------------

export interface PurchaseAgreementIntake {
  documentType: 'purchase_agreement';
  purchasePrice: S<number>;
  closingDate: S<IsoDate>;
  earnestMoney: S<number>;
  diligenceDays: S<number>;
  buyerClosingCosts: S<number>;
  address: S<string>;
}

export interface UnknownIntake {
  documentType: 'unknown';
  /** One line on what the document seems to be, for the review screen. */
  note: S<string>;
}

/** What one parsed document yields. */
export type IntakeDocument =
  | LeaseIntake
  | RentRollIntake
  | OperatingStatementIntake
  | OfferingMemorandumIntake
  | LoanTermsIntake
  | PurchaseAgreementIntake
  | UnknownIntake;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const missing = <T>(source: FieldSource = 'llm'): Sourced<T> => ({ value: null, source, confidence: 0 });

export const found = <T>(value: T, source: FieldSource = 'deterministic', confidence = 1, evidence?: string): Sourced<T> => ({
  value,
  source,
  confidence,
  ...(evidence ? { evidence } : {}),
});

/** The value, or null: the one place callers unwrap, so a missing value can never become a 0 by accident. */
export const val = <T>(s: Sourced<T> | null | undefined): T | null => (s && s.value !== undefined ? s.value : null);
