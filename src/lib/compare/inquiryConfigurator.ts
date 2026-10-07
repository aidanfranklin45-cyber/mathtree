import type { DealRecord, DealInputs } from '../math/types';
import { formatCurrency } from '../format';
import { resolveDealDisplayName } from '../math/pointInTime';
import { prepareEngineInputs } from '../engine/compute';
import { calculateProjections, firstFullYear, normalizeAssetClass } from '../engine';
import { buildColumn } from './buildColumns';
import type { ComparisonColumn } from './compareTypes';
import { ComparativeStory, StoryVerdictStatus } from './comparativeStories';
import { buildAssumptionAuditTrail } from './assumptionAudit';

export type SensitivityVariableKey =
  | 'expenseRatio'
  | 'downPaymentPercent'
  | 'purchasePrice'
  | 'interestRate'
  | 'vacancyRate'
  | 'rentGrowth';

export type TargetMetricKey =
  | 'dscr'
  | 'cash_on_cash'
  | 'irr'
  | 'cash_flow'
  | 'noi';

export interface SensitivityVariableDef {
  key: SensitivityVariableKey;
  label: string;
  unit: '%' | '$' | 'bps';
  description: string;
  defaultDeltas: number[]; // e.g. [-5, 0, 5, 10] or relative steps
  formatValue: (val: number) => string;
}

export const SENSITIVITY_VARIABLES: Record<SensitivityVariableKey, SensitivityVariableDef> = {
  expenseRatio: {
    key: 'expenseRatio',
    label: 'Operating Expense Ratio',
    unit: '%',
    description: 'Impact of operational cost inflation or higher turnover on NOI and debt coverage',
    defaultDeltas: [-3, 0, 3, 6, 10],
    formatValue: (v) => `${v.toFixed(1)}%`,
  },
  downPaymentPercent: {
    key: 'downPaymentPercent',
    label: 'Down Payment Equity',
    unit: '%',
    description: 'Equity contribution sizing against lender covenants and borrowing spread',
    defaultDeltas: [-10, -5, 0, 5, 10],
    formatValue: (v) => `${v.toFixed(0)}%`,
  },
  purchasePrice: {
    key: 'purchasePrice',
    label: 'Purchase Basis / Offer Price',
    unit: '$',
    description: 'Acquisition price variance relative to asking basis',
    defaultDeltas: [-10, -5, 0, 5, 10], // percentages of asking price
    formatValue: (v) => `$${formatCurrency(v)}`,
  },
  interestRate: {
    key: 'interestRate',
    label: 'Mortgage Interest Rate',
    unit: '%',
    description: 'Debt rate volatility and index spread fluctuations',
    defaultDeltas: [-0.5, 0, 0.5, 1.0, 1.5],
    formatValue: (v) => `${v.toFixed(2)}%`,
  },
  vacancyRate: {
    key: 'vacancyRate',
    label: 'Vacancy & Credit Loss',
    unit: '%',
    description: 'Leasing downtime, tenant default, and uncollected gross revenue',
    defaultDeltas: [-2, 0, 3, 5, 10],
    formatValue: (v) => `${v.toFixed(1)}%`,
  },
  rentGrowth: {
    key: 'rentGrowth',
    label: 'Annual Rent Escalation',
    unit: '%',
    description: 'Compound revenue escalation over the underwriting hold period',
    defaultDeltas: [-2, -1, 0, 1, 2],
    formatValue: (v) => `${v.toFixed(1)}%`,
  },
};

export interface CustomInquiryConfig {
  id?: string;
  dealId: string;
  variableKey: SensitivityVariableKey;
  targetMetric: TargetMetricKey;
  targetThreshold?: number; // e.g., 1.25 for DSCR, 10 for CoC, 15 for IRR
  values?: number[]; // Explicit test values. If omitted, generated from defaultDeltas around baseline.
}

export interface VariableSweepPoint {
  testValue: number;
  label: string;
  isBaseline: boolean;
  overrides: Partial<DealInputs>;
  dscr: number | null;
  cashOnCash: number;
  noi: number;
  cashFlow: number;
  irr: number;
  loanAmount: number;
  initialCash: number;
  operatingExpenses: number;
  status: 'bankable' | 'tight' | 'unbankable' | 'optimal' | 'suboptimal';
}

export interface ConfiguredInquiryResult {
  config: CustomInquiryConfig;
  baselineValue: number;
  points: VariableSweepPoint[];
  story: ComparativeStory;
  columns: ComparisonColumn[];
  compensatingEquityDelta?: number; // E.g., how much more equity offsets a +5% expense ratio
  breakEvenThreshold?: number; // The exact variable value where target DSCR drops below threshold
}

/**
 * Computes a parameter sensitivity sweep against the canonical math engine
 * and synthesizes an auditable comparative story.
 */
export function executeConfiguredInquiry(
  deal: DealRecord,
  config: CustomInquiryConfig
): ConfiguredInquiryResult {
  const inputs = prepareEngineInputs(deal);
  const assetClass = normalizeAssetClass(deal.asset_class || deal.assetType || 'commercial');
  const title = resolveDealDisplayName(deal);

  const varDef = SENSITIVITY_VARIABLES[config.variableKey];
  const targetThreshold = config.targetThreshold ?? (config.targetMetric === 'dscr' ? 1.25 : 8.0);

  // Determine baseline value
  let baselineVal = 0;
  if (config.variableKey === 'expenseRatio') {
    baselineVal = Number(inputs.expenseRatio ?? 20);
  } else if (config.variableKey === 'downPaymentPercent') {
    baselineVal = Number(inputs.downPaymentPercent ?? 25);
  } else if (config.variableKey === 'purchasePrice') {
    baselineVal = Number(inputs.purchasePrice ?? deal.purchase_price ?? 0);
  } else if (config.variableKey === 'interestRate') {
    baselineVal = Number(inputs.interestRate ?? 6.5);
  } else if (config.variableKey === 'vacancyRate') {
    baselineVal = Number(inputs.vacancyRate ?? 5.0);
  } else if (config.variableKey === 'rentGrowth') {
    baselineVal = Number(inputs.rentGrowth ?? 3.0);
  }

  // Determine test values
  let testValues: number[] = [];
  if (config.values && config.values.length > 0) {
    testValues = [...config.values];
  } else if (config.variableKey === 'purchasePrice') {
    testValues = varDef.defaultDeltas.map((pctDelta) => Math.round(baselineVal * (1 + pctDelta / 100)));
  } else {
    testValues = varDef.defaultDeltas.map((delta) => {
      const v = baselineVal + delta;
      return +(Math.max(0, v).toFixed(2));
    });
  }

  // Ensure baseline value is present and sorted
  if (!testValues.some((v) => Math.abs(v - baselineVal) < 0.001)) {
    testValues.push(baselineVal);
  }
  testValues.sort((a, b) => a - b);
  // Deduplicate
  testValues = testValues.filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 0.001);

  // Evaluate each test point with calculateProjections
  const points: VariableSweepPoint[] = [];
  const columns: ComparisonColumn[] = [];

  for (const val of testValues) {
    const isBaseline = Math.abs(val - baselineVal) < 0.001;
    const overrides: Partial<DealInputs> = {
      [config.variableKey]: val,
    };

    const res = calculateProjections(assetClass, { ...inputs, ...overrides });
    const y1 = firstFullYear(res.projections) || res.projections?.[0] || {};

    const rawDscr = y1.dscr ?? (res as any).dscr;
    const dscr = rawDscr !== null && rawDscr !== undefined && !isNaN(Number(rawDscr)) ? Number(rawDscr) : null;
    const cashOnCash = Number(y1.cashOnCash ?? 0);
    const noi = Number(y1.netOperatingIncome ?? (res as any).noi ?? 0);
    const cashFlow = Number(y1.cashFlow ?? (res as any).year1Cashflow ?? 0);
    const irr = Number(res.irr ?? 0);
    const loanAmount = Number(res.loanAmount ?? 0);
    const initialCash = Number(res.initialCashInvested ?? 0);
    const operatingExpenses = Number(y1.operatingExpenses ?? 0);

    let status: VariableSweepPoint['status'] = 'bankable';
    if (config.targetMetric === 'dscr') {
      if (dscr === null || dscr < 1.0) status = 'unbankable';
      else if (dscr < targetThreshold) status = 'tight';
      else status = 'bankable';
    } else {
      const metricVal = config.targetMetric === 'cash_on_cash' ? cashOnCash : irr;
      status = metricVal >= targetThreshold ? 'optimal' : 'suboptimal';
    }

    const deltaSign = val > baselineVal ? '+' : '';
    const diff = val - baselineVal;
    const deltaLabel = isBaseline
      ? 'Baseline'
      : config.variableKey === 'purchasePrice'
      ? `${deltaSign}$${formatCurrency(diff)}`
      : `${deltaSign}${diff.toFixed(1)}${varDef.unit}`;

    const label = `${varDef.formatValue(val)} (${deltaLabel})`;

    points.push({
      testValue: val,
      label,
      isBaseline,
      overrides,
      dscr,
      cashOnCash,
      noi,
      cashFlow,
      irr,
      loanAmount,
      initialCash,
      operatingExpenses,
      status,
    });

    const colName = `${varDef.formatValue(val)}${isBaseline ? ' (Baseline)' : ''}`;
    columns.push(
      buildColumn(
        deal,
        'custom',
        colName,
        overrides,
        isBaseline,
        `custom_inquiry:${config.variableKey}:${val}`
      )
    );
  }

  // Synthesize auditable Comparative Story
  const baselinePoint = points.find((p) => p.isBaseline) || points[0];
  const story = synthesizeCustomInquiryStory(title, config, baselinePoint, points, varDef, targetThreshold);

  // Attach Assumption Audit Trail for the highest-stress or key tested override
  const keyTestedPoint = points.find((p) => !p.isBaseline && p.status === 'tight') ||
    points[points.length - 1] ||
    baselinePoint;

  story.assumptionAuditTrail = buildAssumptionAuditTrail(deal, keyTestedPoint.overrides, {
    questionId: `custom_inquiry_${config.variableKey}`,
    targetDscr: targetThreshold,
  });

  return {
    config,
    baselineValue: baselineVal,
    points,
    story,
    columns,
  };
}

/**
 * Synthesizes an executive comparative story for custom inquiry sensitivity sweeps.
 */
function synthesizeCustomInquiryStory(
  dealTitle: string,
  config: CustomInquiryConfig,
  base: VariableSweepPoint,
  points: VariableSweepPoint[],
  varDef: SensitivityVariableDef,
  targetThreshold: number
): ComparativeStory {
  const isDscrTarget = config.targetMetric === 'dscr';
  const takeaways: string[] = [];
  const paragraphs: string[] = [];

  // Determine bankability or performance threshold crossing
  const failPoint = points.find((p) => p.status === 'unbankable' || p.status === 'suboptimal');
  const tightPoint = points.find((p) => p.status === 'tight');
  const baseDscr = base.dscr;

  let verdictStatus: StoryVerdictStatus = 'bankable';
  let verdictLabel = 'Bankable & Stable';

  if (isDscrTarget) {
    if (baseDscr === null || baseDscr < 1.0) {
      verdictStatus = 'unbankable';
      verdictLabel = `Under-Collateralized (${baseDscr !== null ? `${baseDscr.toFixed(2)}x` : 'N/A'} DSCR)`;
    } else if (baseDscr < targetThreshold) {
      verdictStatus = 'tight';
      verdictLabel = `Tight Coverage (${baseDscr.toFixed(2)}x DSCR vs ${targetThreshold.toFixed(2)}x covenant)`;
    } else {
      verdictStatus = 'bankable';
      verdictLabel = `Bankable (${baseDscr.toFixed(2)}x DSCR at Baseline)`;
    }
  } else {
    verdictStatus = base.status === 'optimal' ? 'accretive' : 'dilutive';
    verdictLabel = base.status === 'optimal' ? 'Hurdle Satisfied' : 'Sub-Hurdle';
  }

  // Specific reasoning for Operating Expense Ratio (user priority inquiry)
  if (config.variableKey === 'expenseRatio') {
    const higherPoints = points.filter((p) => p.testValue > base.testValue);
    const firstBreachedPoint = higherPoints.find((p) => (p.dscr ?? 0) < targetThreshold);

    takeaways.push(
      `Baseline expense ratio is ${varDef.formatValue(base.testValue)}: Stabilized NOI is ${formatCurrency(base.noi)}, supporting a ${baseDscr ? `${baseDscr.toFixed(2)}x` : 'N/A'} DSCR and ${formatCurrency(base.cashFlow)} in annual cash flow.`
    );

    if (firstBreachedPoint) {
      const opexIncrease = firstBreachedPoint.operatingExpenses - base.operatingExpenses;
      const dscrDelta = (baseDscr ?? 0) - (firstBreachedPoint.dscr ?? 0);
      takeaways.push(
        `Lender Covenant Breach: If operating expenses expand to ${varDef.formatValue(firstBreachedPoint.testValue)} (+${formatCurrency(opexIncrease)}/yr), DSCR falls to ${firstBreachedPoint.dscr?.toFixed(2)}x (below the ${targetThreshold.toFixed(2)}x covenant).`
      );
    } else {
      takeaways.push(
        `Robust Buffer: Even with operating expenses rising to ${varDef.formatValue(points[points.length - 1].testValue)}, debt coverage remains compliant above ${targetThreshold.toFixed(2)}x DSCR.`
      );
    }

    const extremePoint = points[points.length - 1];
    const maxCashFlowLoss = base.cashFlow - extremePoint.cashFlow;
    takeaways.push(
      `Extreme Stress (${varDef.formatValue(extremePoint.testValue)} expense ratio): Annual cash flow decreases by ${formatCurrency(Math.abs(maxCashFlowLoss))} to ${formatCurrency(extremePoint.cashFlow)} (${extremePoint.cashOnCash.toFixed(1)}% CoC).`
    );

    paragraphs.push(
      `Operating expenses represent one of the primary post-closing underwriting vulnerabilities. On ${dealTitle}, each 100 bps expansion in the operating expense ratio directly reduces net operating income by ${formatCurrency(Math.round(base.noi * 0.015))}. ` +
      `Under baseline underwriting (${varDef.formatValue(base.testValue)} expense ratio), the property generates ${formatCurrency(base.noi)} NOI, comfortably servicing annual mortgage obligations with a ${baseDscr ? `${baseDscr.toFixed(2)}x` : 'N/A'} DSCR.`
    );

    if (firstBreachedPoint) {
      paragraphs.push(
        `However, if property taxes, insurance, or maintenance creep drive the expense ratio to ${varDef.formatValue(firstBreachedPoint.testValue)}, ` +
        `NOI compresses to ${formatCurrency(firstBreachedPoint.noi)}, reducing debt coverage to ${firstBreachedPoint.dscr?.toFixed(2)}x. ` +
        `At this level, the deal violates commercial lender coverage covenants, which would require the sponsor to inject additional equity to pay down principal or fund upfront interest reserve escrows.`
      );
    } else {
      paragraphs.push(
        `The property possesses strong structural expense insulation. Because gross rental revenue provides substantial margin over fixed debt service, ` +
        `the asset absorbs operational inflation across the entire tested spectrum without breaching lender covenants.`
      );
    }
  } else {
    // Generalized narrative for other variable sweeps
    takeaways.push(
      `Baseline ${varDef.label}: ${varDef.formatValue(base.testValue)} yields ${baseDscr ? `${baseDscr.toFixed(2)}x` : 'N/A'} DSCR and ${base.cashOnCash.toFixed(1)}% Cash-on-Cash.`
    );
    if (failPoint) {
      takeaways.push(
        `Sensitivity Threshold: At ${varDef.formatValue(failPoint.testValue)}, ${config.targetMetric.toUpperCase()} degrades to ${isDscrTarget ? `${failPoint.dscr?.toFixed(2)}x` : `${failPoint.cashOnCash.toFixed(1)}%`}.`
      );
    }
    paragraphs.push(
      `This inquiry tests the underwriting sensitivity of ${dealTitle} by varying ${varDef.label} across ${points.length} defensible test levels. ` +
      `The analysis evaluates the point at which cash returns and bankability covenant metrics transition across acceptable thresholds.`
    );
  }

  const actionRecommendation = config.variableKey === 'expenseRatio'
    ? tightPoint || failPoint
      ? `Audit historical operating statements and utility bills. If true ongoing expenses exceed ${varDef.formatValue(tightPoint?.testValue ?? base.testValue)}, negotiate an acquisition price reduction or size down the initial loan amount to protect bankability.`
      : `The current expense structure provides ample safety cushion. Proceed with standard due diligence lease audits.`
    : `Structure loan terms and offer basis based on the threshold bounds identified in this sensitivity matrix.`;

  const headline = config.variableKey === 'expenseRatio'
    ? tightPoint || failPoint
      ? `${dealTitle}: Bankability requires expense ratio staying below ${varDef.formatValue((tightPoint || failPoint)!.testValue)}`
      : `${dealTitle}: Resilient bankability across operating expense expansions`
    : `${dealTitle}: Sensitivity analysis across ${varDef.label}`;

  return {
    questionId: `custom_inquiry_${config.variableKey}`,
    headline,
    verdictBadge: {
      status: verdictStatus,
      label: verdictLabel,
    },
    keyTakeaways: takeaways,
    narrativeParagraphs: paragraphs,
    actionRecommendation,
    covenantData: {
      variableKey: config.variableKey,
      targetMetric: config.targetMetric,
      baselineValue: base.testValue,
      targetThreshold,
      pointsCount: points.length,
    },
  };
}
