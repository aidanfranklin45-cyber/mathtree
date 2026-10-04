import type { RemodelInput } from '../../../supabase/functions/_shared/remodel';

export type AssetClass = 'commercial' | 'multi_family' | 'multi-unit' | 'residential' | 'single-family' | 'storage';
export type DealStatus = 'owned' | 'pipeline' | 'prospect' | 'archived';

export interface LeaseTerm {
  tenantName?: string;
  monthlyRent: number;
  annualRent: number;
  leaseStartDate: string;
  leaseEndDate: string;
  leaseType: 'NNN' | 'Gross' | 'Modified Gross' | 'Full Service';
  escalationType?: string;
  escalationRate?: number;
  escalationFrequency?: string;
  nextEscalationDate?: string;
}

export interface ParcelRecord {
  apn: string;
  formattedApn?: string;
  acres?: number;
  sqft?: number;
  buildingSqFt?: number;
  assessedValue?: number;
  totalAssessedValue?: number;
  landValue?: number;
  marketLandValue?: number;
  improvementValue?: number;
  marketImprovementValue?: number;
  zoning?: string;
  county?: string;
  address?: string;
  street?: string;
  legalDescription?: string;
  useCode?: string;
  owner?: string;
  included?: boolean;
  isPrimary?: boolean;
}

export interface DealInputs {
  purchasePrice: number;
  closingDate?: string;
  holdingPeriod?: number;
  exitYear?: number;
  
  // Revenue
  grossRentAnnual?: number;
  grossRentPerMonth?: number;
  monthlyRent?: number;
  vacancyRate?: number;
  rentGrowth?: number;
  otherIncomeAnnual?: number;
  leases?: LeaseTerm[];
  /** Optional remodel or expansion of an owned property; absent means no effect on the numbers. */
  remodel?: RemodelInput;

  // Operating Expenses
  /** Operating expenses as % of gross income. Case by case per lease type; there is no default. */
  expenseRatio?: number;
  operatingExpenseRatio?: number;
  /** Annual operating expense inflation rate (%) */
  expenseGrowth?: number;
  expenseInflation?: number;
  /** Charged only when manageProperty is true; then required. % of collected income. */
  manageProperty?: boolean;
  managementFeePercent?: number;
  /** Storage only, required. */
  payrollMarketingPercent?: number;
  /** Replacement reserves, required (0 is an answer): dollars a year, or a % of effective gross income. */
  capexReserveAnnual?: number;
  capexReservePercent?: number;
  /** Carrying costs: required for land, or when tenants pay the building's costs (NNN). */
  annualTaxes?: number;
  annualInsurance?: number;
  annualMaintenance?: number;

  // Financing / Debt
  downPaymentPercent?: number;
  /** One of downPaymentPercent or loanAmount is required; the percent wins when both are given. */
  loanAmount?: number;
  interestRate?: number;
  /** Legacy name for the amortization period (what the wizard has always stored). */
  loanTerm?: number;
  /** The period the payment is calculated over (the loan's own). Required. */
  amortizationYears?: number;
  /** When the balance falls due. Required, and not before the hold ends. */
  loanMaturityYears?: number;
  financingType?: 'fixed' | 'arm' | 'interest_only' | 'seller_financing';
  interestOnlyYears?: number;
  sellerFinanceBalloon?: number;
  armInitialYears?: number;
  armAdjustmentRate?: number;
  armRateCap?: number;
  closingCosts?: number;
  rehabCosts?: number;
  rehabBudget?: number;
  rehabFinancingMode?: 'out_of_pocket' | 'roll_into_loan';
  financeRehabAndClosingCosts?: boolean;
  leaseType?: string;

  // Valuation & Exit (all stated by the owner; none assumed)
  /** Brokerage and closing costs at sale, as a % of the sale price. Required (0 is an answer). */
  sellingCostPercent?: number;
  appreciationRate?: number;
  /** Tax module, both required there: land share of the price and the owner's marginal rate (%). */
  landPercent?: number;
  taxRate?: number;
  targetCapRate?: number;
  targetExitCapRate?: number;
  discountRate?: number;

  // Property Details & County GIS
  propertyType?: AssetClass;
  squareFeet?: number;
  units?: number;
  unitCount?: number;
  numUnits?: number;
  storageUnitCount?: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  primaryApn?: string;
  apn?: string;
  parcels?: ParcelRecord[];
  adjacentParcels?: any[];
  assessorData?: any;
  entity_id?: string;
  dealStage?: string;
  [key: string]: any;
}

export interface ProFormaYear {
  year: number;
  calendarYear: number;
  grossPotentialRent: number;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  debtService: number;
  principalPaid: number;
  interestPaid: number;
  cashFlow: number;
  netCashFlow: number;
  cashOnCash: number;
  cumulativeCashFlow: number;
  endingLoanBalance: number;
  propertyValue: number;
  exitProceedsNet?: number;
  /** Engine-native names (aliased to grossPotentialRent / endingLoanBalance by the compute layer). */
  grossPotentialIncome?: number;
  loanBalanceRemaining?: number;
  operatingMonths?: number;
  isStubYear?: boolean;
  dscr: number | string;
  methodologyFootnote?: string;
  monthlyReceipts?: Array<{ month: string; rent: number; status: string }>;
}

export interface AmortizationScheduleEntry {
  year: number;
  appliedRate: number;
  beginningBalance: number;
  totalPayment: number;
  principalPaid: number;
  interestPaid: number;
  endingBalance: number;
  cumulativePrincipalPaid: number;
  isInterestOnly: boolean;
  isArmAdjusted: boolean;
  operatingMonths: number;
}

export interface DealMetrics {
  purchasePrice: number;
  initialEquity: number;
  loanAmount: number;
  ltv: number;
  noi: number;
  capRate: number;
  year1Cashflow: number;
  cashOnCash: number;
  cash_on_cash?: number;
  irr: number;
  equityMultiplier: number;
  npv: number;
  dscr: number | string;
  /** True when the deal has no cash equity in (100% financed); IRR/CoC are not meaningful. */
  isZeroEquity?: boolean;
  /** 1-based year cumulative cash turns positive, or the engine's 'N/A' string. */
  breakEvenYear?: number | string;
  irrDisplay?: string;
  equityMultiplierDisplay?: string;
  monthlyMortgagePayment?: number;
  /** Annual debt service (year 1). */
  annualDebtService?: number;
  /** Cash required at close (down payment + rehab + closing, net of any rolled-in costs). */
  initialCashInvested?: number;
  projections: ProFormaYear[];
  amortizationSchedule: AmortizationScheduleEntry[];
}

export interface DealRecord {
  id: string;
  user_id?: string;
  title: string;
  location?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  asset_class: AssetClass;
  assetType?: string;
  status: DealStatus;
  purchase_price: number;
  is_demo?: boolean;
  is_shared?: boolean;
  entity_id?: string;
  primary_apn?: string;
  closing_date?: string;
  inputs: DealInputs;
  /** Rent roll, payments and expense rows for an owned deal (loaded facts, never stored); read by resolvePointInTimeDealMetrics. */
  property_facts?: import('../property/types').PropertyFacts;
  metrics?: DealMetrics;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface TaxMetrics {
  depYears: 27.5 | 39.0;
  depreciableBasis: number;
  annualDepreciation: number;
  annualTaxShield: number;
  landAllocationPct: number;
  effectiveTaxRate: number;
}

export interface SensitivityMatrix {
  vacancySteps: number[];
  capRateSteps: number[];
  /** irrGrid[capIdx][vacIdx] */
  irrGrid: number[][];
}
