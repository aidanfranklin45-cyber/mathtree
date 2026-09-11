export type AssetClass = 'commercial' | 'multi_family' | 'residential' | 'storage';
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
  landValue?: number;
  improvementValue?: number;
  zoning?: string;
  county?: string;
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
  vacancyRatePercent?: number;
  rentGrowthPercent?: number;
  otherIncomeAnnual?: number;
  leases?: LeaseTerm[];

  // Operating Expenses
  operatingExpensesAnnual?: number;
  expenseGrowthPercent?: number;
  propertyTaxAnnual?: number;
  insuranceAnnual?: number;
  managementFeePercent?: number;
  maintenanceReserveAnnual?: number;
  utilitiesAnnual?: number;

  // Financing / Debt
  downPaymentPercent?: number;
  initialEquity?: number;
  loanAmount?: number;
  interestRate?: number;
  loanTermYears?: number;
  amortizationYears?: number;
  financingType?: 'fixed' | 'arm' | 'interest_only' | 'seller_financing';
  interestOnlyYears?: number;
  sellerFinanceBalloon?: number;
  armInitialYears?: number;
  armAdjustmentRate?: number;
  armRateCap?: number;

  // Valuation & Exit
  exitCapRatePercent?: number;
  sellingCostPercent?: number;
  discountRatePercent?: number;

  // Property Details & County GIS
  propertyType?: AssetClass;
  squareFeet?: number;
  units?: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  primaryApn?: string;
  parcels?: ParcelRecord[];
  assessorData?: any;
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
  irr: number;
  equityMultiplier: number;
  npv: number;
  dscr: number | string;
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
  status: DealStatus;
  purchase_price: number;
  total_equity?: number;
  loan_amount?: number;
  irr?: number;
  cash_on_cash?: number;
  equity_multiple?: number;
  year1_cashflow?: number;
  cap_rate?: number;
  is_demo?: boolean;
  inputs: DealInputs;
  metrics?: DealMetrics;
  created_at?: string;
  updated_at?: string;
}
