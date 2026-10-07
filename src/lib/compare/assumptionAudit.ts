import type { DealRecord, DealInputs } from '../math/types';
import { formatCurrency } from '../format';
import { stated, KEYS } from '../../../supabase/functions/_shared/inputRequirements';
import type { InputBasis } from '../../../supabase/functions/_shared/underwritingAssumptions';

export type AssumptionSourceType = 'contract' | 'document' | 'county' | 'profile' | 'hypothesis';

export interface AssumptionAuditEntry {
  key: string;
  label: string;
  currentValue: string;
  baselineValue?: string;
  source: AssumptionSourceType;
  sourceBadge: string;
  rationale: string;
  isHypothesis: boolean;
}

/**
 * Maps known input keys to clear labels and formatting.
 */
function formatInputValue(key: string, val: any): string {
  if (val === undefined || val === null || val === '') return 'Unstated';
  const n = Number(val);
  if (isNaN(n)) return String(val);

  if (key === 'purchasePrice' || key === 'loanAmount' || key === 'closingCosts' || key === 'rehabCosts') {
    return formatCurrency(n);
  }
  if (
    key === 'downPaymentPercent' ||
    key === 'interestRate' ||
    key === 'vacancyRate' ||
    key === 'expenseRatio' ||
    key === 'rentGrowth' ||
    key === 'expenseGrowth' ||
    key === 'targetCapRate' ||
    key === 'appreciationRate' ||
    key === 'sellingCostPercent'
  ) {
    return `${n}%`;
  }
  if (key === 'amortizationYears' || key === 'loanTerm' || key === 'holdingPeriod') {
    return `${n} years`;
  }
  return String(val);
}

/**
 * Traces the provenance and justification of underwriting inputs for a deal and scenario overrides.
 */
export function buildAssumptionAuditTrail(
  deal: DealRecord,
  overrides?: Partial<DealInputs>,
  inquiryContext?: {
    questionId: string;
    targetDscr?: number;
    targetIrr?: number;
    rateShockBps?: number;
    vacancyShockPct?: number;
  }
): AssumptionAuditEntry[] {
  const inputs = (deal.inputs || {}) as Record<string, any>;
  const assumptionBasis = (inputs.assumptionBasis || {}) as Record<string, InputBasis>;
  const trail: AssumptionAuditEntry[] = [];

  const trackedKeys: Array<{ key: string; label: string; aliases: readonly string[] }> = [
    { key: 'purchasePrice', label: 'Purchase Basis', aliases: ['purchasePrice'] },
    { key: 'downPaymentPercent', label: 'Down Payment', aliases: ['downPaymentPercent'] },
    { key: 'interestRate', label: 'Interest Rate', aliases: ['interestRate'] },
    { key: 'amortizationYears', label: 'Loan Amortization', aliases: KEYS.amortization },
    { key: 'vacancyRate', label: 'Vacancy & Credit Loss', aliases: KEYS.vacancy },
    { key: 'expenseRatio', label: 'Operating Expense Ratio', aliases: KEYS.expenseRatio },
    { key: 'holdingPeriod', label: 'Hold Period', aliases: KEYS.hold },
    { key: 'rentGrowth', label: 'Rent Growth Rate', aliases: KEYS.rentGrowth },
    { key: 'targetCapRate', label: 'Exit Cap Rate', aliases: KEYS.exitCap },
  ];

  for (const item of trackedKeys) {
    const rawVal = stated(inputs, ...item.aliases);
    const hasOverride = overrides && overrides[item.key as keyof DealInputs] !== undefined;
    const effectiveVal = hasOverride ? overrides[item.key as keyof DealInputs] : rawVal;

    if (effectiveVal === undefined && rawVal === undefined) continue;

    // Provenance lookup
    const basis: InputBasis | undefined = assumptionBasis[item.key] || assumptionBasis[item.aliases[0]];
    let source: AssumptionSourceType = 'contract';
    let sourceBadge = 'Contract Fact';
    let rationale = basis?.rationale || 'Directly stated on project contract or underwriting intake.';

    if (hasOverride) {
      source = 'hypothesis';
      sourceBadge = 'Inquiry Hypothesis';

      // Generate defensible justification based on inquiry context
      if (item.key === 'downPaymentPercent') {
        const targetDscr = inquiryContext?.targetDscr ?? 1.25;
        rationale = `Hypothesis tested to evaluate equity required to achieve ${targetDscr}x lender DSCR bankability covenant.`;
      } else if (item.key === 'purchasePrice') {
        if (inquiryContext?.questionId === 'max_offer_dscr') {
          rationale = `Back-solved strike price to maintain debt service compliance at a 1.25x DSCR without requiring cash subsidies.`;
        } else if (inquiryContext?.questionId === 'max_offer_irr') {
          rationale = `Back-solved acquisition strike price to satisfy your ${inquiryContext?.targetIrr ?? 15}% hurdle IRR over the hold.`;
        } else {
          rationale = `Hypothesis tested to evaluate valuation sensitivity against baseline asking price.`;
        }
      } else if (item.key === 'interestRate') {
        rationale = `Stress-tested with a +${inquiryContext?.rateShockBps ?? 100} bps rate expansion to verify debt coverage resilience before financing lock.`;
      } else if (item.key === 'vacancyRate') {
        rationale = `Stress-tested with a +${inquiryContext?.vacancyShockPct ?? 5}% vacancy expansion to measure default break-even cushion.`;
      } else {
        rationale = `Custom scenario parameter tested for comparative return analysis.`;
      }
    } else if (basis) {
      if (basis.source === 'document') {
        source = 'document';
        sourceBadge = basis.label ? `Document: ${basis.label}` : 'Document Extraction';
        rationale = basis.rationale || 'Extracted and verified from source offering memorandum or rent roll.';
      } else if (basis.source === 'profile') {
        source = 'profile';
        sourceBadge = basis.label || 'Investor Profile Standard';
        rationale = basis.rationale || 'Standard underwriting benchmark from your verified investor profile.';
      } else if (basis.source === 'county_record') {
        source = 'county';
        sourceBadge = basis.label || 'County GIS Record';
        rationale = basis.rationale || 'Read directly from public county assessor parcels.';
      }
    }

    trail.push({
      key: item.key,
      label: item.label,
      currentValue: formatInputValue(item.key, effectiveVal),
      baselineValue: hasOverride ? formatInputValue(item.key, rawVal) : undefined,
      source,
      sourceBadge,
      rationale,
      isHypothesis: Boolean(hasOverride),
    });
  }

  return trail;
}
