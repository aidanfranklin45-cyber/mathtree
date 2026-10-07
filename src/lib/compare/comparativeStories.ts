import { formatCurrency } from '../format';
import type { DownPaymentMatrixResult, DownPaymentMatrixRow } from '../engine';
import type { AssumptionAuditEntry } from './assumptionAudit';

export type StoryVerdictStatus = 'bankable' | 'tight' | 'unbankable' | 'accretive' | 'dilutive' | 'resilient' | 'vulnerable';

export interface VerdictBadge {
  status: StoryVerdictStatus;
  label: string;
}

export interface ComparativeStory {
  questionId: string;
  headline: string;
  verdictBadge: VerdictBadge;
  keyTakeaways: string[];
  narrativeParagraphs: string[];
  actionRecommendation: string;
  covenantData?: Record<string, any>;
  assumptionAuditTrail?: AssumptionAuditEntry[];
}

const fmtPct = (val: number | null | undefined, decimals = 1): string => {
  if (val === null || val === undefined || isNaN(Number(val))) return 'N/A';
  return `${Number(val).toFixed(decimals)}%`;
};

const fmtX = (val: number | null | undefined, decimals = 2): string => {
  if (val === null || val === undefined || isNaN(Number(val))) return 'N/A';
  return `${Number(val).toFixed(decimals)}x`;
};

/**
 * Synthesizes bankability down-payment matrix results into an executive narrative.
 */
export function generateBankabilityStory(
  dealTitle: string,
  matrixResult: DownPaymentMatrixResult,
  targetDscr = 1.25
): ComparativeStory {
  const { purchasePrice, baselinePercent, goingInCapRate, loanConstant, leverageType, debtServicePer5PctDown, rows } = matrixResult;
  const baselineRow = rows.find((r) => r.isBaseline) || rows[0];
  const bankableRow = rows.find((r) => (r.dscr ?? 0) >= targetDscr);

  const baselineDscr = baselineRow?.dscr ?? null;
  const isBaselineBankable = baselineDscr !== null && baselineDscr >= targetDscr;
  const isBaselineTight = baselineDscr !== null && baselineDscr >= 1.0 && baselineDscr < targetDscr;

  let verdictStatus: StoryVerdictStatus = 'unbankable';
  let verdictLabel = 'Under-Collateralized (DSCR < 1.0x)';

  if (isBaselineBankable) {
    verdictStatus = 'bankable';
    verdictLabel = `Bankable (${fmtX(baselineDscr)} DSCR at ${fmtPct(baselinePercent, 0)} down)`;
  } else if (isBaselineTight) {
    verdictStatus = 'tight';
    verdictLabel = `Tight Coverage (${fmtX(baselineDscr)} DSCR at ${fmtPct(baselinePercent, 0)} down)`;
  }

  const takeaways: string[] = [];
  const paragraphs: string[] = [];

  // Takeaways
  if (isBaselineBankable) {
    takeaways.push(`Your baseline ${fmtPct(baselinePercent, 0)} down payment ($${formatCurrency(baselineRow.downPaymentAmount)}) clears lender covenants with ${fmtX(baselineDscr)} DSCR.`);
  } else if (bankableRow) {
    const additionalEquity = Math.max(0, bankableRow.downPaymentAmount - baselineRow.downPaymentAmount);
    takeaways.push(`Requires at least ${fmtPct(bankableRow.downPaymentPercent, 0)} down (${formatCurrency(bankableRow.downPaymentAmount)}) to reach ${fmtX(targetDscr)} DSCR covenant.`);
    if (additionalEquity > 0) {
      takeaways.push(`Bridge the coverage gap by contributing an additional ${formatCurrency(additionalEquity)} of equity.`);
    }
  } else {
    takeaways.push(`Even at 50% down payment, stabilized NOI does not satisfy a ${fmtX(targetDscr)} DSCR under the current purchase price and loan terms.`);
  }

  if (debtServicePer5PctDown > 0) {
    takeaways.push(`Each 5% increase in down payment saves ${formatCurrency(debtServicePer5PctDown)} in annual mortgage payments.`);
  }

  // Leverage takeaway
  if (leverageType === 'positive') {
    takeaways.push(`Positive financial leverage: Going-in cap rate (${fmtPct(goingInCapRate)}) exceeds loan constant (${fmtPct(loanConstant)}).`);
  } else if (leverageType === 'negative') {
    takeaways.push(`Negative financial leverage: Loan constant (${fmtPct(loanConstant)}) exceeds cap rate (${fmtPct(goingInCapRate)}), causing debt to dilute equity yields.`);
  }

  // Narrative Paragraph 1: Present state
  paragraphs.push(
    `At a purchase price of ${formatCurrency(purchasePrice)}, ${dealTitle} generates ${formatCurrency(baselineRow.netOperatingIncome)} in stabilized Year-1 NOI. ` +
    `Under your stated financing terms with a ${fmtPct(baselinePercent, 0)} down payment (${formatCurrency(baselineRow.downPaymentAmount)} equity), ` +
    `annual debt service of ${formatCurrency(baselineRow.annualDebtService)} results in a ${fmtX(baselineDscr)} debt service coverage ratio (DSCR).`
  );

  // Narrative Paragraph 2: The Bankability Path
  if (isBaselineBankable) {
    paragraphs.push(
      `Because commercial and portfolio lenders generally require a minimum 1.20x to 1.25x DSCR, this deal meets standard institutional guidelines without requiring structural changes to your capital allocation.`
    );
  } else if (bankableRow) {
    const addedCash = bankableRow.downPaymentAmount - baselineRow.downPaymentAmount;
    paragraphs.push(
      `To satisfy a standard lender covenant of ${fmtX(targetDscr)} DSCR, the down payment must increase to ${fmtPct(bankableRow.downPaymentPercent, 0)} ` +
      `(${formatCurrency(bankableRow.downPaymentAmount)} total equity, requiring an additional ${formatCurrency(addedCash)}). ` +
      `This reduces the loan amount to ${formatCurrency(bankableRow.loanAmount)} and lowers annual debt service to ${formatCurrency(bankableRow.annualDebtService)}, ` +
      `delivering a compliant ${fmtX(bankableRow.dscr)} DSCR and ${formatCurrency(bankableRow.netCashFlow)} in annual net cash flow (${fmtPct(bankableRow.cashOnCash)} cash-on-cash).`
    );
  } else {
    paragraphs.push(
      `Because annual debt service remains high relative to net operating income, reaching lender covenants through down payment alone is capital-inefficient. ` +
      `Consider negotiating a purchase price reduction or securing seller/mezzanine financing terms.`
    );
  }

  // Recommendation
  let recommendation = '';
  if (isBaselineBankable) {
    recommendation = `Proceed with lender term sheet review at your current ${fmtPct(baselinePercent, 0)} down payment (${formatCurrency(baselineRow.downPaymentAmount)}).`;
  } else if (bankableRow) {
    recommendation = `Structure your loan application with ${fmtPct(bankableRow.downPaymentPercent, 0)} down (${formatCurrency(bankableRow.downPaymentAmount)}) to ensure lender debt approval, or negotiate a purchase price reduction of at least ${formatCurrency(Math.max(0, baselineRow.downPaymentAmount * 0.2))}.`;
  } else {
    recommendation = `The current purchase price cannot support market debt. Re-evaluate the acquisition basis with the Strike Price Solver before submitting a binding offer.`;
  }

  return {
    questionId: 'bankability_down_payment',
    headline: isBaselineBankable
      ? `${dealTitle} is bankable at ${fmtPct(baselinePercent, 0)} down (${fmtX(baselineDscr)} DSCR)`
      : bankableRow
        ? `${dealTitle} requires ${fmtPct(bankableRow.downPaymentPercent, 0)} down (${formatCurrency(bankableRow.downPaymentAmount)}) for bankability`
        : `${dealTitle} is over-leveraged under current debt terms`,
    verdictBadge: {
      status: verdictStatus,
      label: verdictLabel,
    },
    keyTakeaways: takeaways,
    narrativeParagraphs: paragraphs,
    actionRecommendation: recommendation,
    covenantData: {
      baselineDownPct: baselinePercent,
      bankableDownPct: bankableRow?.downPaymentPercent ?? null,
      bankableEquityDollars: bankableRow?.downPaymentAmount ?? null,
      additionalEquityNeeded: bankableRow ? Math.max(0, bankableRow.downPaymentAmount - baselineRow.downPaymentAmount) : null,
      loanConstant,
      goingInCapRate,
      debtServiceSavingsPer5Pct: debtServicePer5PctDown,
    },
  };
}

/**
 * Synthesizes financial leverage mechanics (Cap Rate vs Loan Constant) into an executive story.
 */
export function generateLeverageStory(
  dealTitle: string,
  matrixResult: DownPaymentMatrixResult
): ComparativeStory {
  const { goingInCapRate, loanConstant, leverageType, baselinePercent, rows } = matrixResult;
  const spreadPct = (goingInCapRate - (loanConstant ?? 0));
  const isAccretive = leverageType === 'positive';

  const baselineRow = rows.find((r) => r.isBaseline) || rows[0];
  const allCashRow = rows.find((r) => r.downPaymentPercent === 100) || rows[rows.length - 1];

  const takeaways: string[] = [
    `Going-in cap rate: ${fmtPct(goingInCapRate)} vs Loan constant: ${fmtPct(loanConstant)} (Spread: ${spreadPct >= 0 ? '+' : ''}${fmtPct(spreadPct, 2)}).`,
    isAccretive
      ? `Debt is accretive: Borrowing cost is cheaper than asset yield, expanding equity cash-on-cash return.`
      : `Debt is dilutive (Negative Leverage): Debt service exceeds asset yield, reducing equity returns as leverage increases.`,
  ];

  const paragraphs: string[] = [
    `In real estate finance, debt is accretive to returns only when the property's unlevered yield (the Going-in Cap Rate of ${fmtPct(goingInCapRate)}) ` +
    `is strictly greater than the annual borrowing cost of that debt (the Loan Constant of ${fmtPct(loanConstant)}).`,
    isAccretive
      ? `Because your spread is positive (+${fmtPct(spreadPct, 2)}), every dollar of debt you introduce works in your favor. At ${fmtPct(baselinePercent, 0)} down, ` +
        `your levered Cash-on-Cash return is ${fmtPct(baselineRow.cashOnCash)}, which is higher than the unlevered all-cash return of ${fmtPct(allCashRow?.capRate ?? goingInCapRate)}.`
      : `Because your spread is negative (${fmtPct(spreadPct, 2)}), debt is dragging down returns. Borrowing money to fund this acquisition consumes more NOI in debt service ` +
        `than the property earns on that slice of capital. At ${fmtPct(baselinePercent, 0)} down, Cash-on-Cash is ${fmtPct(baselineRow.cashOnCash)}, whereas putting more equity down or buying all-cash delivers ${fmtPct(allCashRow?.capRate ?? goingInCapRate)}.`,
  ];

  const recommendation = isAccretive
    ? `Maintain conservative leverage (e.g. 70-75% LTV) to capture positive leverage while maintaining compliance with DSCR covenants.`
    : `Increase equity contribution or negotiate a lower interest rate/purchase price to avoid negative leverage erosion.`;

  return {
    questionId: 'financial_leverage',
    headline: isAccretive
      ? `Positive leverage detected: Debt expands returns by ${fmtPct(spreadPct, 2)} on ${dealTitle}`
      : `Negative leverage warning: Debt dilutes returns on ${dealTitle} by ${fmtPct(Math.abs(spreadPct), 2)}`,
    verdictBadge: {
      status: isAccretive ? 'accretive' : 'dilutive',
      label: isAccretive ? `Accretive Leverage (+${fmtPct(spreadPct, 2)} spread)` : `Dilutive Leverage (${fmtPct(spreadPct, 2)} spread)`,
    },
    keyTakeaways: takeaways,
    narrativeParagraphs: paragraphs,
    actionRecommendation: recommendation,
    covenantData: {
      goingInCapRate,
      loanConstant,
      spreadPct,
      isAccretive,
    },
  };
}

/**
 * Synthesizes maximum offer basis / strike price solver results into an executive narrative.
 */
export function generateStrikePriceStory(
  dealTitle: string,
  askingPrice: number,
  targetType: 'dscr' | 'irr',
  targetValue: number,
  solvedPrice: number,
  solvedSummary: {
    dscr: number | null;
    cashOnCash: number;
    initialCash: number;
    loanAmount: number;
    irr?: number;
  },
  baselineSummary: {
    dscr: number | null;
    cashOnCash: number;
    initialCash: number;
    loanAmount: number;
    irr?: number;
  }
): ComparativeStory {
  const priceDelta = solvedPrice - askingPrice;
  const pctDelta = askingPrice > 0 ? (priceDelta / askingPrice) * 100 : 0;
  const isDiscountNeeded = priceDelta < 0;

  const metricLabel = targetType === 'dscr' ? `${fmtX(targetValue)} DSCR` : `${fmtPct(targetValue, 1)} IRR`;

  const takeaways: string[] = [
    isDiscountNeeded
      ? `Maximum allowable offer is ${formatCurrency(solvedPrice)} (${formatCurrency(Math.abs(priceDelta))} or ${fmtPct(Math.abs(pctDelta), 1)} below asking price).`
      : `At or near asking price: Deal already achieves ${metricLabel} at ${formatCurrency(solvedPrice)}.`,
    `Equity required at strike price: ${formatCurrency(solvedSummary.initialCash)} (vs ${formatCurrency(baselineSummary.initialCash)} at asking price).`,
    `Projected returns at strike basis: ${fmtX(solvedSummary.dscr)} DSCR, ${fmtPct(solvedSummary.cashOnCash)} Year-1 Cash-on-Cash${solvedSummary.irr ? `, ${fmtPct(solvedSummary.irr)} IRR` : ''}.`,
  ];

  const paragraphs: string[] = [
    `Under the asking price of ${formatCurrency(askingPrice)}, ${dealTitle} yields a ${fmtX(baselineSummary.dscr)} DSCR and ` +
    `${fmtPct(baselineSummary.cashOnCash)} Cash-on-Cash return${baselineSummary.irr ? ` (${fmtPct(baselineSummary.irr)} IRR)` : ''}. ` +
    (isDiscountNeeded
      ? `This falls short of your target benchmark of ${metricLabel}.`
      : `This satisfies your target hurdle of ${metricLabel}.`),
    isDiscountNeeded
      ? `To achieve your hurdle without relying on speculative market appreciation, the purchase price must not exceed ${formatCurrency(solvedPrice)}. ` +
        `At this strike basis, the loan amount sizes to ${formatCurrency(solvedSummary.loanAmount)}, moderating debt service and unlocking ${fmtPct(solvedSummary.cashOnCash)} in initial cash yield.`
      : `Your underwriting indicates room for negotiation. You can pay up to ${formatCurrency(solvedPrice)} while continuing to satisfy your ${metricLabel} requirement.`,
  ];

  const recommendation = isDiscountNeeded
    ? `Anchor your initial letter of intent (LOI) at or below ${formatCurrency(solvedPrice)}, citing lender debt coverage constraints (${metricLabel}) as justification.`
    : `The asking price supports your investment hurdles. Prioritize due diligence on property condition and lease verifications.`;

  return {
    questionId: targetType === 'dscr' ? 'max_offer_dscr' : 'max_offer_irr',
    headline: isDiscountNeeded
      ? `Offer at or below ${formatCurrency(solvedPrice)} (${fmtPct(Math.abs(pctDelta), 1)} below asking) to hit ${metricLabel}`
      : `Asking price of ${formatCurrency(askingPrice)} satisfies ${metricLabel}`,
    verdictBadge: {
      status: isDiscountNeeded ? 'tight' : 'bankable',
      label: isDiscountNeeded ? `Requires ${fmtPct(Math.abs(pctDelta), 1)} Discount` : `Hurdle Satisfied`,
    },
    keyTakeaways: takeaways,
    narrativeParagraphs: paragraphs,
    actionRecommendation: recommendation,
    covenantData: {
      askingPrice,
      solvedPrice,
      priceDelta,
      pctDelta,
      solvedEquity: solvedSummary.initialCash,
    },
  };
}

/**
 * Synthesizes downside stress tests (rate hikes and vacancy shocks) into an executive narrative.
 */
export function generateStressStory(
  dealTitle: string,
  baseDscr: number | null,
  baseCashFlow: number,
  rateShockDscr: number | null,
  rateShockCashFlow: number,
  vacancyShockDscr: number | null,
  vacancyShockCashFlow: number,
  breakEvenOccupancyPct: number
): ComparativeStory {
  const isBaseBankable = baseDscr !== null && baseDscr >= 1.25;
  const rateShockPasses = rateShockDscr !== null && rateShockDscr >= 1.15;
  const vacancyShockPasses = vacancyShockDscr !== null && vacancyShockDscr >= 1.15;
  const isResilient = rateShockPasses && vacancyShockPasses;

  const takeaways: string[] = [
    `Break-even occupancy is ${fmtPct(breakEvenOccupancyPct)}, providing a ${fmtPct(Math.max(0, 100 - breakEvenOccupancyPct))} occupancy buffer before debt service deficits occur.`,
    `+100 bps Interest Rate Hike: DSCR moves from ${fmtX(baseDscr)} to ${fmtX(rateShockDscr)} (annual cash flow drops by ${formatCurrency(Math.abs(baseCashFlow - rateShockCashFlow))}).`,
    `+5% Vacancy Expansion: DSCR adjusts to ${fmtX(vacancyShockDscr)} (cash flow drops by ${formatCurrency(Math.abs(baseCashFlow - vacancyShockCashFlow))}).`,
  ];

  const paragraphs: string[] = [
    `Under baseline underwriting, ${dealTitle} provides a ${fmtX(baseDscr)} DSCR and ${formatCurrency(baseCashFlow)}/year in operating cash flow. ` +
    `To evaluate downside defense, the asset was subjected to a +100 bps rate shock and an unexpected 5-percentage-point vacancy increase.`,
    isResilient
      ? `The property demonstrates strong capital resilience. Under both stress vectors, net operating income remains sufficient to service debt without requiring capital calls. Break-even occupancy of ${fmtPct(breakEvenOccupancyPct)} leaves substantial margin against tenant departures.`
      : `The asset operates with narrow safety margins. Under stress, debt coverage compresses near or below break-even (${fmtX(rateShockDscr)} DSCR under rate shock; ${fmtX(vacancyShockDscr)} under vacancy expansion), exposing the sponsor to cash calls if market conditions soften.`,
  ];

  const recommendation = isResilient
    ? `The capital structure carries sufficient safety margin to withstand debt market volatility and standard tenant turnover.`
    : `Increase equity reserves or secure fixed-rate debt with an extended interest-only period to insulate against interest rate spikes.`;

  return {
    questionId: 'rate_and_vacancy_stress',
    headline: isResilient
      ? `${dealTitle} demonstrates resilient downside defense (${fmtPct(breakEvenOccupancyPct)} break-even occupancy)`
      : `${dealTitle} carries tight downside margins under rate and vacancy stress`,
    verdictBadge: {
      status: isResilient ? 'resilient' : 'vulnerable',
      label: isResilient ? `Resilient Cushion (${fmtPct(breakEvenOccupancyPct)} Break-even)` : `Narrow Cushion (DSCR < 1.15x under stress)`,
    },
    keyTakeaways: takeaways,
    narrativeParagraphs: paragraphs,
    actionRecommendation: recommendation,
    covenantData: {
      breakEvenOccupancyPct,
      rateShockDscr,
      vacancyShockDscr,
      isResilient,
    },
  };
}
