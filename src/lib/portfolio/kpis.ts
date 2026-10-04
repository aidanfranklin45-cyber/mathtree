import type { DealRecord } from '../math/types';
import { resolvePointInTimeDealMetrics } from '../math/pointInTime';
import { tryComputeDealMetrics } from '../engine/compute';

/**
 * The four dashboard headline tiles, as one pure function. The dashboard and the portfolio brief both call this,
 * so the PDF cannot show a different number from the screen.
 */
export interface PortfolioKpis {
  ownedVal: number;
  ownedDebt: number;
  ownedEquity: number;
  ownedCashflow: number;
  /** Whether the owned cash flow rests on collected rent (`collected`), the forecast (`estimated`), or a mix of owned deals. Null with none. */
  ownedCashflowBasis: 'collected' | 'estimated' | 'mixed' | null;
  ownedLtv: number;
  avgCoc: number;
  pipelineVal: number;
  pipelineCount: number;
  blendedIrr: number;
}

export function computePortfolioKpis(deals: DealRecord[], today: Date = new Date()): PortfolioKpis {
  // 1. Owned portfolio metrics (point in time)
  const ownedDeals = deals.filter((d) => d.status === 'owned');
  let ownedVal = 0;
  let ownedDebt = 0;
  let ownedEquity = 0;
  let ownedCashflow = 0;
  const bases = new Set<string>();
  let weightedCocSum = 0;

  ownedDeals.forEach((d) => {
    const pit = resolvePointInTimeDealMetrics(d, today);
    ownedVal += pit.currentVal;
    ownedDebt += pit.currentDebt;
    ownedEquity += pit.currentEquity;
    ownedCashflow += pit.currentCashFlow;
    bases.add(pit.state.cashFlow.basis === 'estimated' ? 'estimated' : 'collected');
    if (pit.currentEquity > 0) {
      weightedCocSum += (pit.currentCashFlow / pit.currentEquity) * pit.currentEquity;
    }
  });

  const ownedLtv = ownedVal > 0 ? (ownedDebt / ownedVal) * 100 : 0;
  const avgCoc = ownedEquity > 0 ? (weightedCocSum / ownedEquity) * 100 : 0;

  // 2. Pipeline metrics
  const pipelineDeals = deals.filter((d) => d.status !== 'owned');
  let pipelineVal = 0;
  let sumIrr = 0;
  let countIrr = 0;

  pipelineDeals.forEach((d) => {
    const price = Number(d.purchase_price) || Number(d.inputs?.purchasePrice || 0);
    pipelineVal += price;
    const irr = tryComputeDealMetrics(d)?.irr || 0;
    if (irr > 0) {
      sumIrr += irr;
      countIrr++;
    }
  });

  const blendedIrr = countIrr > 0 ? sumIrr / countIrr : 0;

  return {
    ownedVal: Math.round(ownedVal),
    ownedDebt: Math.round(ownedDebt),
    ownedEquity: Math.round(ownedEquity),
    ownedCashflow: Math.round(ownedCashflow),
    ownedCashflowBasis: bases.size === 0 ? null : bases.size > 1 ? 'mixed' : (bases.has('collected') ? 'collected' : 'estimated'),
    ownedLtv: Math.round(ownedLtv * 10) / 10,
    avgCoc: Math.round(avgCoc * 10) / 10,
    pipelineVal: Math.round(pipelineVal),
    pipelineCount: pipelineDeals.length,
    blendedIrr: Math.round(blendedIrr * 10) / 10,
  };
}
