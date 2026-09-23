// supabase/functions/_shared/types.ts
// Canonical shared types for Supabase Edge Functions.

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

  // Operating Expenses
  operatingExpensesAnnual?: number | string;
  expenseGrowthPercent?: number | string;
  propertyTaxAnnual?: number | string;
  insuranceAnnual?: number | string;
  managementFeePercent?: number | string;
  maintenanceReserveAnnual?: number | string;
  utilitiesAnnual?: number | string;

  // Financing / Debt
  downPaymentPercent?: number | string;
  initialEquity?: number | string;
  loanAmount?: number | string;
  interestRate?: number | string;
  loanTermYears?: number | string;
  amortizationYears?: number | string;
  financingType?: 'fixed' | 'arm' | 'interest_only' | 'seller_financing';
  interestOnlyYears?: number | string;
  armInitialYears?: number | string;
  armAdjustmentRate?: number | string;
  armRateCap?: number | string;
  closingCosts?: number | string;
  rehabCosts?: number | string;

  // Valuation & Exit
  exitCapRatePercent?: number | string;
  sellingCostPercent?: number | string;
  discountRatePercent?: number | string;

  // Property Details
  squareFeet?: number | string;
  units?: number | string;
  address?: string;
  county?: string;
  primaryApn?: string;

  // Tax overrides (optional)
  landAllocationPercent?: number | string;
  effectiveTaxRatePercent?: number | string;

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
