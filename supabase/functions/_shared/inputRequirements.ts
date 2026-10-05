// supabase/functions/_shared/inputRequirements.ts
//
// The engine never invents a number. Every input it needs is either a FACT (price, closing date, the loan's own terms, a lease's rent)
// or an ASSUMPTION (vacancy, expense ratio, exit cap, selling costs, ...). Both must be stated on the deal. When one is missing the
// engine does not substitute a default: it stops and says exactly what is missing, so a screen can ask for it and the owner can defend
// every figure that reaches a lender.
//
// Pure (no imports), shared by the browser and the edge functions.

export type RequirementKind = 'fact' | 'assumption';

export interface MissingInput {
  /** The input key to set (the first alias is the one new data should be written under). */
  key: string;
  label: string;
  kind: RequirementKind;
  /** One plain line on why the engine needs it. */
  why: string;
}

export class IncompleteInputsError extends Error {
  readonly missing: MissingInput[];
  constructor(missing: MissingInput[]) {
    super(`Cannot compute: missing ${missing.map((m) => m.label).join(', ')}`);
    this.name = 'IncompleteInputsError';
    this.missing = missing;
  }
}

/** A value the owner actually stated: not undefined, null or blank. Zero counts (an explicit 0% is an answer). */
export function isStated(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return Number.isFinite(Number(v));
}

/** The first stated value among aliases, as a number; undefined when none is stated. */
export function stated(inputs: Record<string, any>, ...keys: string[]): number | undefined {
  for (const k of keys) if (isStated(inputs[k])) return Number(inputs[k]);
  return undefined;
}

/** Year and month of a closing date written `YYYY-MM-DD`, `YYYY/MM`, or `MM/DD/YYYY`; null when blank or unreadable. Never a default. */
export function parseClosingDate(raw: unknown): { year: number; month: number } | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const parts = text.split(/[-/]/);
  if (parts.length < 2) return null;
  let year: number;
  let month: number;
  if (parts[0].length === 4) {
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  } else {
    month = parseInt(parts[0], 10);
    year = parseInt(parts[2] || parts[1], 10);
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12 || year < 1900 || year > 2200) return null;
  return { year, month };
}

const normAsset = (a: string): string => {
  const s = String(a ?? '').toLowerCase().replace(/[_\s]/g, '-');
  if (s === 'residential' || s === 'single-family') return 'single-family';
  if (s === 'multi-family' || s === 'multifamily' || s === 'multi-unit') return 'multi-unit';
  if (s === 'storage' || s === 'self-storage') return 'storage';
  return 'commercial';
};

// Key aliases, in the order the engine reads them. Legacy keys stay readable so existing deals keep working; new data uses the first.
export const KEYS = {
  amortization: ['amortizationYears', 'loanTerm'], // `loanTerm` is what the wizard has always stored: the amortization period
  maturity: ['loanMaturityYears', 'loanTermYears'],
  vacancy: ['vacancyRate', 'vacancyRatePercent'],
  rentGrowth: ['rentGrowth', 'rentGrowthPercent', 'annualRentGrowth'],
  expenseRatio: ['expenseRatio', 'operatingExpenseRatio'],
  hold: ['holdingPeriod', 'exitYear', 'holdYears'],
  exitCap: ['targetCapRate', 'targetExitCapRate', 'exitCapRate'],
  capexAnnual: ['capexReserveAnnual', 'capexReserve'],
  capexPercent: ['capexReservePercent'],
  sellingCost: ['sellingCostPercent'],
  discountRate: ['discountRate', 'discountRatePercent'],
  taxes: ['annualTaxes', 'propertyTaxes'],
  insurance: ['annualInsurance', 'insurance'],
  maintenance: ['annualMaintenance', 'maintenance'],
} as const;

const hasRentSource = (inputs: Record<string, any>): boolean =>
  (Array.isArray(inputs.leases) && inputs.leases.length > 0) ||
  ['grossRentAnnual', 'grossRevenueAnnual', 'annualRent', 'grossAnnualRent', 'grossRentPerMonth', 'grossRentMonthly', 'monthlyGrossRent', 'monthlyRent', 'storageGrossRentMonthly', 'grossStorageRentMonthly']
    .some((k) => (stated(inputs, k) ?? 0) > 0) ||
  ((stated(inputs, 'storageRentPerUnit', 'storageRent') ?? 0) > 0) ||
  ((stated(inputs, 'monthlyRentPerUnit') ?? 0) > 0);

/**
 * Everything `calculateProjections` needs that the deal does not state. Empty means the engine may run.
 * It checks presence only, never plausibility; a stated 0% vacancy is the owner's call.
 */
export function checkEngineInputs(rawAssetType: string, inputs: Record<string, any> = {}): MissingInput[] {
  const asset = normAsset(rawAssetType);
  const out: MissingInput[] = [];
  const need = (key: string, label: string, kind: RequirementKind, why: string) => out.push({ key, label, kind, why });

  const price = stated(inputs, 'purchasePrice');
  if (price === undefined || !(price > 0)) need('purchasePrice', 'Purchase price', 'fact', 'Every return is measured against what is paid.');

  if (!parseClosingDate(inputs.closingDate)) {
    need('closingDate', 'Closing date', 'fact', 'Year 1 starts at closing; lease dates and the first-year proration are measured from it.');
  }

  if (stated(inputs, ...KEYS.hold) === undefined) need('holdingPeriod', 'Hold period (years)', 'assumption', 'The exit, and so the IRR, happens at the end of the hold.');
  if (stated(inputs, ...KEYS.discountRate) === undefined) need('discountRate', 'Discount rate (%)', 'assumption', 'NPV discounts cash flows at the owner\'s required return.');

  if (stated(inputs, 'closingCosts') === undefined) {
    need('closingCosts', 'Buyer closing costs ($)', 'fact', 'Every purchase has closing costs; enter 0 if there are none. A lender quote or settlement statement replaces an estimate.');
  }

  // ---- Financing: the loan's own terms, never a generic loan ----
  const down = stated(inputs, 'downPaymentPercent');
  const loanAmt = stated(inputs, 'loanAmount');
  if (down === undefined && loanAmt === undefined) {
    need('downPaymentPercent', 'Down payment (%) or loan amount', 'fact', 'Without it the engine cannot tell how much is borrowed (not borrowing at all is 100% down).');
  }
  const borrowed = down !== undefined ? down < 100 : (loanAmt ?? 0) > 0;
  const finType = String(inputs.financingType ?? 'fixed').toLowerCase();
  if (borrowed) {
    if (stated(inputs, 'interestRate') === undefined) need('interestRate', 'Interest rate (%)', 'fact', 'Set by the loan.');
    if (finType !== 'bridge' && stated(inputs, ...KEYS.amortization) === undefined) {
      need('amortizationYears', 'Amortization period (years)', 'fact', 'The payment is calculated over the loan\'s own amortization, which varies loan to loan.');
    }
    // A loan states one term: it is paid over that term and falls due at its end, measured from the closing date. A balloon (due before
    // the amortization ends) is the exception, stated on its own. A balloon that comes due before the exit is refused: how it is repaid
    // or refinanced is not guessed.
    const amortization = stated(inputs, ...KEYS.amortization);
    const maturity = stated(inputs, ...KEYS.maturity);
    if (finType === 'bridge' && maturity === undefined) need('loanMaturityYears', 'Loan term (years)', 'fact', 'A bridge loan is due at the end of its term.');
    if (maturity !== undefined) {
      const hold = stated(inputs, ...KEYS.hold);
      const balloon = amortization === undefined || maturity < amortization;
      if (balloon && hold !== undefined && maturity < hold) {
        need('loanMaturityYears', `The loan comes due in year ${maturity}, before the ${hold}-year hold ends`, 'fact', 'Shorten the hold to the due date, or lengthen the loan: how a balloon is repaid or refinanced is not guessed.');
      }
    }
    if (finType === 'arm') {
      if (stated(inputs, 'armInitialYears') === undefined) need('armInitialYears', 'ARM fixed period (years)', 'fact', 'How long the starting rate holds, per the loan.');
      if (stated(inputs, 'armAdjustmentRate') === undefined) need('armAdjustmentRate', 'ARM adjusted rate (%)', 'fact', 'The rate after the fixed period, per the loan.');
      if (stated(inputs, 'armRateCap') === undefined) need('armRateCap', 'ARM rate cap (%)', 'fact', 'The ceiling on the adjusted rate, per the loan.');
    }
    if (finType === 'interest_only' && stated(inputs, 'interestOnlyYears') === undefined) {
      need('interestOnlyYears', 'Interest-only period (years)', 'fact', 'Set by the loan.');
    }
  }

  // ---- Operations ----
  if (stated(inputs, ...KEYS.vacancy) === undefined) need('vacancyRate', 'Vacancy (%)', 'assumption', 'Income is reduced by the vacancy the owner underwrites.');
  if (stated(inputs, ...KEYS.expenseRatio) === undefined) need('expenseRatio', 'Operating expense ratio (%)', 'assumption', 'Without it operating expenses would be zero.');
  const hasLeases = Array.isArray(inputs.leases) && inputs.leases.length > 0;
  if (!hasLeases && hasRentSource(inputs) && stated(inputs, ...KEYS.rentGrowth) === undefined) {
    need('rentGrowth', 'Rent growth (%)', 'assumption', 'Rent without leases grows at the owner\'s stated rate.');
  }
  if (hasLeases) {
    (inputs.leases as any[]).forEach((l, i) => {
      if (stated(l ?? {}, 'escalationRate') === undefined) {
        need(`leases[${i}].escalationRate`, `Escalation for ${l?.tenantName || `lease ${i + 1}`} (% a year, 0 if none)`, 'fact', 'Set by the lease; the engine will not assume one.');
      }
    });
  }

  if (stated(inputs, ...KEYS.capexAnnual) === undefined && stated(inputs, ...KEYS.capexPercent) === undefined) {
    need('capexReserveAnnual', 'Capital reserve ($ a year, or % of income)', 'assumption', 'Replacement reserves come off cash flow; enter 0 if none are taken.');
  }

  // ---- Valuation and exit ----
  const incomeValued = asset === 'commercial' || asset === 'storage';
  if (incomeValued) {
    if (stated(inputs, ...KEYS.exitCap) === undefined) need('targetCapRate', 'Exit cap rate (%)', 'assumption', 'Income-producing property is valued at exit by capitalising its income.');
  } else if (stated(inputs, 'appreciationRate') === undefined) {
    need('appreciationRate', 'Appreciation (% a year)', 'assumption', 'Residential property is valued by appreciation.');
  }
  // Selling costs are optional: they exist only if a sale is planned. With none stated the exit carries no sale costs (a hold or refinance).

  // ---- Costs the engine used to guess at ----
  if (inputs.manageProperty && stated(inputs, 'managementFeePercent') === undefined) {
    need('managementFeePercent', 'Management fee (% of income)', 'assumption', 'Property management is charged at the rate the owner underwrites.');
  }
  if (asset === 'storage' && stated(inputs, 'payrollMarketingPercent') === undefined) {
    need('payrollMarketingPercent', 'Payroll and marketing (% of income)', 'assumption', 'Storage operating costs include on-site payroll and marketing.');
  }
  // A property is carried with no income when it has no rent at all, or when its leases only start after closing (the months before).
  const closing = parseClosingDate(inputs.closingDate);
  const leasesStartLater = !!closing && hasLeases && (inputs.leases as any[]).some((l) => {
    const m = /^(\d{4})-(\d{1,2})/.exec(String(l?.leaseStartDate ?? ''));
    return !!m && Number(m[1]) * 12 + Number(m[2]) > closing.year * 12 + closing.month;
  });
  // When tenants pay the building's costs (NNN) the expense ratio is small, so what the owner would carry if a tenant left cannot be
  // read from it: the costs are stated.
  const tenantsPayCosts = hasLeases && (String(inputs.leaseType ?? '') === 'NNN' || (inputs.leases as any[]).some((l) => String(l?.leaseType ?? '') === 'NNN'));
  if ((asset === 'commercial' && ((!hasLeases && !hasRentSource(inputs)) || leasesStartLater)) || tenantsPayCosts) {
    // The carrying costs of a property with no income have to be stated.
    if (stated(inputs, ...KEYS.taxes) === undefined) need('annualTaxes', 'Annual property taxes ($)', 'fact', 'A property with no income still pays tax.');
    if (stated(inputs, ...KEYS.insurance) === undefined) need('annualInsurance', 'Annual insurance ($)', 'fact', 'A property with no income still carries insurance.');
    if (stated(inputs, ...KEYS.maintenance) === undefined) need('annualMaintenance', 'Annual maintenance ($)', 'assumption', 'A property with no income still needs upkeep.');
  }

  // A remodel financed with a new loan is its own loan: its share borrowed, rate and term are stated, not assumed
  const remodel = inputs.remodel;
  if (remodel && typeof remodel === 'object' && !Array.isArray(remodel) && (remodel as Record<string, unknown>).financing === 'new_loan') {
    const r = remodel as Record<string, any>;
    if (stated(r, 'ltcPct') === undefined) need('remodel.ltcPct', 'Remodel loan: share of cost borrowed (%)', 'fact', 'Set by the remodel lender.');
    if (stated(r, 'loanRatePct') === undefined) need('remodel.loanRatePct', 'Remodel loan: interest rate (%)', 'fact', 'Set by the remodel lender; it is not the purchase loan\'s rate.');
    if (stated(r, 'loanTermYears') === undefined) need('remodel.loanTermYears', 'Remodel loan: term (years)', 'fact', 'Set by the remodel lender.');
  }

  return out;
}

/** Throws IncompleteInputsError when the deal does not state everything the engine needs. */
export function assertEngineInputs(rawAssetType: string, inputs: Record<string, any> = {}): void {
  const missing = checkEngineInputs(rawAssetType, inputs);
  if (missing.length > 0) throw new IncompleteInputsError(missing);
}

/** What the tax module needs that the deal does not state. Both vary by deal, so neither has a default. */
export function checkTaxInputs(inputs: Record<string, any> = {}): MissingInput[] {
  const out: MissingInput[] = [];
  if (stated(inputs, 'landPercent') === undefined) {
    out.push({ key: 'landPercent', label: 'Land share of the purchase price (%)', kind: 'fact', why: 'Land is not depreciable; the split varies by property (the county\'s land and improvement values are a starting point).' });
  }
  if (stated(inputs, 'taxRate') === undefined) {
    out.push({ key: 'taxRate', label: 'Marginal tax rate (%)', kind: 'assumption', why: 'The value of depreciation depends on the owner\'s own rate.' });
  }
  return out;
}
