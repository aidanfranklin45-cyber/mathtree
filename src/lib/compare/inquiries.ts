import type { DealRecord, DealInputs } from '../math/types';
import { formatCurrency } from '../format';
import { resolveDealDisplayName } from '../math/pointInTime';
import { prepareEngineInputs } from '../engine/compute';
import {
  calculateDownPaymentMatrix,
  calculateProjections,
  solveTargetPurchasePrice,
  firstFullYear,
  normalizeAssetClass,
} from '../engine';
import { buildColumn } from './buildColumns';
import type { ComparisonColumn } from './compareTypes';
import {
  ComparativeStory,
  generateBankabilityStory,
  generateLeverageStory,
  generateStrikePriceStory,
  generateStressStory,
} from './comparativeStories';
import type { GuidedQuestionId } from './guidedQuestions';
import { buildAssumptionAuditTrail } from './assumptionAudit';

export interface InquiryExecutionResult {
  questionId: GuidedQuestionId;
  story: ComparativeStory;
  columns: ComparisonColumn[];
  rawResult: Record<string, any>;
}

/**
 * 1. Bankability Inquiry:
 * Solves which down payment clears lender covenants (e.g. 1.25x DSCR).
 */
export function executeBankabilityInquiry(
  deal: DealRecord,
  targetDscr = 1.25,
  customPercentages: number[] = [15, 20, 25, 30, 35, 40]
): InquiryExecutionResult {
  const inputs = prepareEngineInputs(deal);
  const assetClass = normalizeAssetClass(deal.asset_class || deal.assetType || 'commercial');
  const title = resolveDealDisplayName(deal);

  const matrixResult = calculateDownPaymentMatrix(assetClass, inputs, customPercentages);
  const story = generateBankabilityStory(title, matrixResult, targetDscr);
  const bankableRow = matrixResult.rows.find((r) => (r.dscr ?? 0) >= targetDscr);
  story.assumptionAuditTrail = buildAssumptionAuditTrail(
    deal,
    bankableRow ? { downPaymentPercent: bankableRow.downPaymentPercent } : undefined,
    { questionId: 'bankability_down_payment', targetDscr }
  );

  // Generate comparison columns for the down payment spectrum
  const columns: ComparisonColumn[] = matrixResult.rows.map((row, idx) => {
    const isBaseline = row.isBaseline;
    const isBankable = (row.dscr ?? 0) >= targetDscr;
    const name = `${row.downPaymentPercent}% Down${isBaseline ? ' (Baseline)' : isBankable ? ' (Bankable)' : ''}`;
    const overrides: Partial<DealInputs> = { downPaymentPercent: row.downPaymentPercent };
    return buildColumn(deal, 'custom', name, overrides, isBaseline, `dp:${row.downPaymentPercent}`);
  });

  return {
    questionId: 'bankability_down_payment',
    story,
    columns,
    rawResult: matrixResult,
  };
}

/**
 * 2. Financial Leverage Inquiry:
 * Analyzes whether borrowing expands (positive) or dilutes (negative) equity returns.
 */
export function executeLeverageInquiry(deal: DealRecord): InquiryExecutionResult {
  const inputs = prepareEngineInputs(deal);
  const assetClass = normalizeAssetClass(deal.asset_class || deal.assetType || 'commercial');
  const title = resolveDealDisplayName(deal);

  const matrixResult = calculateDownPaymentMatrix(assetClass, inputs, [20, 25, 35, 50, 100]);
  const story = generateLeverageStory(title, matrixResult);
  story.assumptionAuditTrail = buildAssumptionAuditTrail(deal, undefined, {
    questionId: 'financial_leverage',
  });

  // Comparison columns: Unlevered All-Cash vs Baseline Financed vs High Leverage
  const baselinePct = matrixResult.baselinePercent;
  const cols = [
    buildColumn(deal, 'custom', `Unlevered (100% Cash)`, { downPaymentPercent: 100 }, false, 'lev:all_cash'),
    buildColumn(deal, 'custom', `${baselinePct}% Down (Your Baseline)`, { downPaymentPercent: baselinePct }, true, 'lev:baseline'),
    buildColumn(deal, 'custom', `35% Down (Conservative Debt)`, { downPaymentPercent: 35 }, false, 'lev:conservative'),
  ];

  return {
    questionId: 'financial_leverage',
    story,
    columns: cols,
    rawResult: matrixResult,
  };
}

/**
 * 3. Strike Price / Maximum Offer Basis Inquiry:
 * Back-solves maximum allowable acquisition basis for a target DSCR or hurdle IRR.
 */
export function executeStrikePriceInquiry(
  deal: DealRecord,
  targetType: 'dscr' | 'irr',
  targetValue?: number
): InquiryExecutionResult {
  const inputs = prepareEngineInputs(deal);
  const assetClass = normalizeAssetClass(deal.asset_class || deal.assetType || 'commercial');
  const title = resolveDealDisplayName(deal);
  const askingPrice = Number(inputs.purchasePrice || deal.purchase_price || 0);

  let solvedPrice = askingPrice;
  let targetVal = targetValue ?? (targetType === 'dscr' ? 1.25 : 15);

  if (targetType === 'irr') {
    const solved = solveTargetPurchasePrice(assetClass, inputs, targetVal);
    solvedPrice = solved.solvedPurchasePrice;
  } else {
    // Bisection solver for target DSCR using calculateProjections
    let low = 10000;
    let high = Math.max(askingPrice * 2, 2000000);
    let best = askingPrice;

    for (let i = 0; i < 40; i++) {
      const mid = Math.round((low + high) / 2);
      const testInputs = { ...inputs, purchasePrice: mid };
      try {
        const res = calculateProjections(assetClass, testInputs);
        const y1 = firstFullYear(res.projections) || res.projections?.[0] || {};
        const dscr = Number(y1.dscr ?? 0);

        if (Math.abs(dscr - targetVal) < 0.01) {
          best = mid;
          break;
        }
        if (dscr < targetVal) {
          // Price too high -> debt too high -> DSCR too low
          high = mid;
        } else {
          low = mid;
        }
        best = mid;
      } catch {
        high = mid;
      }
    }
    solvedPrice = best;
  }

  // Evaluate baseline vs solved projections
  const baseRes = calculateProjections(assetClass, inputs);
  const solvedRes = calculateProjections(assetClass, { ...inputs, purchasePrice: solvedPrice });

  const baseY1 = firstFullYear(baseRes.projections) || baseRes.projections?.[0] || {};
  const solvedY1 = firstFullYear(solvedRes.projections) || solvedRes.projections?.[0] || {};

  const baselineSummary = {
    dscr: baseY1.dscr !== null && baseY1.dscr !== undefined ? Number(baseY1.dscr) : null,
    cashOnCash: Number(baseY1.cashOnCash ?? 0),
    initialCash: Number(baseRes.initialCashInvested ?? 0),
    loanAmount: Number(baseRes.loanAmount ?? 0),
    irr: Number(baseRes.irr ?? 0),
  };

  const solvedSummary = {
    dscr: solvedY1.dscr !== null && solvedY1.dscr !== undefined ? Number(solvedY1.dscr) : null,
    cashOnCash: Number(solvedY1.cashOnCash ?? 0),
    initialCash: Number(solvedRes.initialCashInvested ?? 0),
    loanAmount: Number(solvedRes.loanAmount ?? 0),
    irr: Number(solvedRes.irr ?? 0),
  };

  const story = generateStrikePriceStory(
    title,
    askingPrice,
    targetType,
    targetVal,
    solvedPrice,
    solvedSummary,
    baselineSummary
  );
  story.assumptionAuditTrail = buildAssumptionAuditTrail(
    deal,
    { purchasePrice: solvedPrice },
    {
      questionId: targetType === 'dscr' ? 'max_offer_dscr' : 'max_offer_irr',
      targetDscr: targetVal,
      targetIrr: targetVal,
    }
  );

  // Comparison columns: Asking Price vs Solved Strike Basis
  const columns: ComparisonColumn[] = [
    buildColumn(deal, 'live', `Asking Price ($${askingPrice.toLocaleString()})`, undefined, true, 'strike:asking'),
    buildColumn(
      deal,
      'custom',
      `Target Strike Basis ($${solvedPrice.toLocaleString()})`,
      { purchasePrice: solvedPrice },
      false,
      'strike:solved'
    ),
  ];

  return {
    questionId: targetType === 'dscr' ? 'max_offer_dscr' : 'max_offer_irr',
    story,
    columns,
    rawResult: { askingPrice, solvedPrice, targetType, targetVal, baselineSummary, solvedSummary },
  };
}

/**
 * 4. Stress Resilience Inquiry:
 * Analyzes rate hikes (+100 bps) and vacancy shocks (+5%) against break-even occupancy.
 */
export function executeStressInquiry(
  deal: DealRecord,
  rateShockBps = 100,
  vacancyShockPct = 5
): InquiryExecutionResult {
  const inputs = prepareEngineInputs(deal);
  const assetClass = normalizeAssetClass(deal.asset_class || deal.assetType || 'commercial');
  const title = resolveDealDisplayName(deal);

  const baseRate = Number(inputs.interestRate || 0);
  const baseVac = Number(inputs.vacancyRate || 0);

  // Projections
  const baseRes = calculateProjections(assetClass, inputs);
  const rateShockRes = calculateProjections(assetClass, {
    ...inputs,
    interestRate: +(baseRate + rateShockBps / 100).toFixed(2),
  });
  const vacShockRes = calculateProjections(assetClass, {
    ...inputs,
    vacancyRate: +(baseVac + vacancyShockPct).toFixed(1),
  });

  const baseY1 = firstFullYear(baseRes.projections) || baseRes.projections?.[0] || {};
  const rateY1 = firstFullYear(rateShockRes.projections) || rateShockRes.projections?.[0] || {};
  const vacY1 = firstFullYear(vacShockRes.projections) || vacShockRes.projections?.[0] || {};

  // Break-even occupancy % = (Operating Expenses + Debt Service) / Gross Potential Income * 100
  const grossIncome = Number(baseY1.grossPotentialIncome || (inputs.monthlyRent ? inputs.monthlyRent * 12 : 0));
  const opex = Number(baseY1.operatingExpenses || 0);
  const debt = Number(baseY1.debtService || 0);
  const breakEvenOcc = grossIncome > 0 ? Math.min(100, Math.round(((opex + debt) / grossIncome) * 1000) / 10) : 100;

  const story = generateStressStory(
    title,
    baseY1.dscr !== null && baseY1.dscr !== undefined ? Number(baseY1.dscr) : null,
    Number(baseY1.cashFlow ?? 0),
    rateY1.dscr !== null && rateY1.dscr !== undefined ? Number(rateY1.dscr) : null,
    Number(rateY1.cashFlow ?? 0),
    vacY1.dscr !== null && vacY1.dscr !== undefined ? Number(vacY1.dscr) : null,
    Number(vacY1.cashFlow ?? 0),
    breakEvenOcc
  );
  story.assumptionAuditTrail = buildAssumptionAuditTrail(
    deal,
    {
      interestRate: +(baseRate + rateShockBps / 100).toFixed(2),
      vacancyRate: +(baseVac + vacancyShockPct).toFixed(1),
    },
    { questionId: 'rate_and_vacancy_stress', rateShockBps, vacancyShockPct }
  );

  const columns: ComparisonColumn[] = [
    buildColumn(deal, 'live', `Baseline Case`, undefined, true, 'stress:base'),
    buildColumn(
      deal,
      'custom',
      `Rate Shock (+${rateShockBps} bps)`,
      { interestRate: +(baseRate + rateShockBps / 100).toFixed(2) },
      false,
      'stress:rate'
    ),
    buildColumn(
      deal,
      'custom',
      `Vacancy Shock (+${vacancyShockPct}%)`,
      { vacancyRate: +(baseVac + vacancyShockPct).toFixed(1) },
      false,
      'stress:vac'
    ),
  ];

  return {
    questionId: 'rate_and_vacancy_stress',
    story,
    columns,
    rawResult: { breakEvenOcc, rateShockBps, vacancyShockPct },
  };
}

/**
 * 5. Cross-Pipeline Capital Allocation Inquiry:
 * Compares candidate deals side-by-side to highlight risk-adjusted equity yield.
 */
export function executeAllocationInquiry(deals: DealRecord[]): InquiryExecutionResult {
  const columns: ComparisonColumn[] = deals.map((d, i) =>
    buildColumn(d, 'live', undefined, undefined, i === 0, `alloc:${d.id}`)
  );

  // Identify top cash-on-cash and top DSCR safety cushion
  const sortedByCoC = [...columns].sort((a, b) => b.summary.cashOnCashYear1 - a.summary.cashOnCashYear1);
  const sortedByDscr = [...columns].sort((a, b) => (b.summary.dscr ?? 0) - (a.summary.dscr ?? 0));

  const topCoC = sortedByCoC[0];
  const topSafety = sortedByDscr[0];

  const story: ComparativeStory = {
    questionId: 'pipeline_allocation',
    headline: `Capital Allocation: Comparing ${deals.length} candidate properties in your pipeline`,
    verdictBadge: {
      status: 'accretive',
      label: `${topCoC ? topCoC.dealTitle : 'Pipeline'} leads cash yield`,
    },
    keyTakeaways: [
      `Highest Cash-on-Cash Return: ${topCoC?.dealTitle} (${topCoC?.summary.cashOnCashYear1.toFixed(1)}% CoC, $${formatCurrency(topCoC?.summary.cashFlowYear1)}/yr).`,
      `Strongest Debt Coverage Margin: ${topSafety?.dealTitle} (${topSafety?.summary.dscr !== null ? `${topSafety.summary.dscr.toFixed(2)}x` : 'N/A'} DSCR).`,
      `Evaluate your priority: Yield maximization vs. lender coverage and downside defense.`,
    ],
    narrativeParagraphs: [
      `When deploying capital across prospective acquisitions, equity should be evaluated on both return intensity and downside cushion.`,
      `${topCoC?.dealTitle} delivers the strongest immediate cash distribution on invested equity. Conversely, ${topSafety?.dealTitle} provides the widest debt service buffer, insulating the investment against market shocks.`,
    ],
    actionRecommendation: `If your objective is income generation, prioritize ${topCoC?.dealTitle}. If capital preservation and lender financing ease are paramount, prioritize ${topSafety?.dealTitle}.`,
    covenantData: {
      dealCount: deals.length,
      topCoCId: topCoC?.dealId,
      topSafetyId: topSafety?.dealId,
    },
    assumptionAuditTrail: deals[0]
      ? buildAssumptionAuditTrail(deals[0], undefined, { questionId: 'pipeline_allocation' })
      : undefined,
  };

  return {
    questionId: 'pipeline_allocation',
    story,
    columns,
    rawResult: { dealsCount: deals.length },
  };
}
