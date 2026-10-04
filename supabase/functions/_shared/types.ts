// supabase/functions/_shared/types.ts
// Canonical shared types for Supabase Edge Functions.

import type { RemodelInput } from './remodel.ts';

export type { RemodelInput };

export type AssetClass = 'commercial' | 'multi_family' | 'residential' | 'storage';

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

export interface DealInputs {
  purchasePrice?: number | string;
  closingDate?: string;
  holdingPeriod?: number | string;
  exitYear?: number | string;

  // Revenue
  grossRentAnnual?: number | string;
  grossRentPerMonth?: number | string;
  monthlyRent?: number | string;
  vacancyRatePercent?: number | string;
  rentGrowthPercent?: number | string;
  otherIncomeAnnual?: number | string;
  leases?: LeaseTerm[];

  // Optional remodel or expansion of an owned property (see remodel.ts)
  remodel?: RemodelInput;

  // Operating expenses. The engine reads exactly these (see inputRequirements.ts); it assumes none of them.
  /** Operating expenses as a % of gross rent, before vacancy. Required (0 is an answer). */
  expenseRatio?: number | string;
  /** Annual growth of operating expenses (%). Optional: without it expenses follow income at the ratio. */
  expenseGrowth?: number | string;
  expenseGrowthPercent?: number | string;
  expenseInflation?: number | string;
  /** Charged only when manageProperty is true; then required. % of collected (effective gross) income. */
  manageProperty?: boolean;
  managementFeePercent?: number | string;
  /** Storage only, required: on-site payroll and marketing as a % of gross income. */
  payrollMarketingPercent?: number | string;
  /** Replacement reserves, required (0 is an answer): dollars a year, or a % of effective gross income. */
  capexReserveAnnual?: number | string;
  capexReservePercent?: number | string;
  /** What the property costs to carry with no income; required for land, or when tenants pay the building's costs (NNN). */
  annualTaxes?: number | string;
  annualInsurance?: number | string;
  annualMaintenance?: number | string;

  // Financing / Debt
  /** One of downPaymentPercent or loanAmount is required; the percent wins when both are given. */
  downPaymentPercent?: number | string;
  loanAmount?: number | string;
  interestRate?: number | string;
  /** The period the payment is calculated over (the loan's own). Required. Legacy deals call it loanTerm. */
  amortizationYears?: number | string;
  /** When the balance falls due. Required, and not before the hold ends. (loanTermYears is the legacy name.) */
  loanMaturityYears?: number | string;
  loanTermYears?: number | string;
  loanTerm?: number | string;
  financingType?: 'fixed' | 'arm' | 'interest_only' | 'seller_financing';
  interestOnlyYears?: number | string;
  armInitialYears?: number | string;
  armAdjustmentRate?: number | string;
  armRateCap?: number | string;
  closingCosts?: number | string;
  rehabCosts?: number | string;
  rehabBudget?: number | string;
  rehabFinancingMode?: 'out_of_pocket' | 'roll_into_loan';
  financeRehabAndClosingCosts?: boolean;
  leaseType?: 'NNN' | 'Gross' | 'Modified Gross' | 'Full Service' | string;

  // Valuation & Exit (all stated by the owner; none assumed)
  /** Required for commercial and storage. */
  targetCapRate?: number | string;
  /** Required for the other asset classes. */
  appreciationRate?: number | string;
  /** Brokerage and closing costs at sale, as a % of the sale price. Required (0 is an answer). */
  sellingCostPercent?: number | string;
  discountRate?: number | string;
  discountRatePercent?: number | string;

  // Property Details
  squareFeet?: number | string;
  units?: number | string;
  address?: string;
  county?: string;
  primaryApn?: string;

  // Tax module: both vary by deal and owner, so both are required there
  landPercent?: number | string;
  taxRate?: number | string;

  // Pass-through for legacy keys
  [key: string]: unknown;
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
  exitProceedsNet: number;
  dscr: number | string;
  breakEvenOccupancyPct?: number;
  isInterestOnly?: boolean;
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
  initialCashInvested: number;
  loanAmount: number;
  ltv: number;
  noi: number;
  capRate: number;
  year1Cashflow: number;
  cashOnCash: number;
  irr: number;
  equityMultiplier: number;
  npv: number;
  dscr: number | string;
  projections: ProFormaYear[];
  amortizationSchedule: AmortizationScheduleEntry[];
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

export interface CalculateProjectionsRequest {
  dealId?: string;
  assetClass: AssetClass;
  inputs: DealInputs;
  computeSensitivity?: boolean;
}

export interface CalculateProjectionsResponse {
  success: true;
  metrics: DealMetrics;
  tax: TaxMetrics;
  sensitivity?: SensitivityMatrix;
}
