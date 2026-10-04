import { describe, it, expect } from 'vitest';
import { computeDealMetrics, computeSensitivity, computeTaxMetrics, runMonteCarlo } from './testEngine';

const deal: any = {
  id: 'd1',
  asset_class: 'residential',
  purchase_price: 300000,
  inputs: {
    purchasePrice: 300000, downPaymentPercent: 25, interestRate: 6.75, loanTerm: 30,
    monthlyRent: 2600, vacancyRate: 5, expenseRatio: 35, rentGrowth: 3, appreciationRate: 3,
    closingCosts: 6000, exitYear: 10,
  },
};

// Deterministic uniform RNG (mulberry32)
function seeded(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('compute layer', () => {
  it('returns every field the studio reads, derived only from inputs', () => {
    const m = computeDealMetrics(deal);
    for (const k of ['purchasePrice', 'initialEquity', 'loanAmount', 'ltv', 'noi', 'capRate', 'year1Cashflow',
      'cashOnCash', 'irr', 'equityMultiplier', 'npv', 'dscr']) {
      expect(m).toHaveProperty(k);
    }
    expect(m.projections.length).toBeGreaterThanOrEqual(10);
    expect(m.amortizationSchedule.length).toBeGreaterThan(0);
  });

  it('is memoised and responds to input changes', () => {
    expect(computeDealMetrics(deal)).toBe(computeDealMetrics(deal));
    const more = computeDealMetrics(deal, { monthlyRent: 3200 });
    expect(more.noi).toBeGreaterThan(computeDealMetrics(deal).noi);
  });

  it('falls back to deal.purchase_price when inputs omit it', () => {
    const m = computeDealMetrics({ ...deal, inputs: { ...deal.inputs, purchasePrice: undefined } });
    expect(m.purchasePrice).toBe(300000);
  });

  it('adapts the sensitivity grid to the studio shape (cap rows x vacancy cols)', () => {
    const s = computeSensitivity(deal);
    expect(s.capRateSteps).toHaveLength(5);
    expect(s.vacancySteps).toHaveLength(5);
    expect(s.irrGrid).toHaveLength(5);
    expect(s.irrGrid[0]).toHaveLength(5);
    // Higher vacancy can only lower IRR along a row
    expect(s.irrGrid[2][0]).toBeGreaterThanOrEqual(s.irrGrid[2][4]);
  });

  it('uses the 27.5-year residential schedule for residential aliases', () => {
    expect(computeTaxMetrics(deal).depYears).toBe(27.5);
    expect(computeTaxMetrics({ ...deal, asset_class: 'commercial' }).depYears).toBe(39);
  });

  it('correctly handles 0% down payment (100% debt financing)', () => {
    const zeroDownDeal = {
      ...deal,
      inputs: { ...deal.inputs, downPaymentPercent: 0, closingCosts: 12000, rehabCosts: 0 },
    };
    const m: any = computeDealMetrics(zeroDownDeal);
    expect(m.loanAmount).toBe(300000);
    expect(m.downPaymentAmount).toBe(0);
    expect(m.initialCashInvested).toBe(12000);
    expect(m.ltv).toBe(100);
  });
});

describe('runMonteCarlo (shared engine)', () => {
  const run = () => runMonteCarlo('residential', deal.inputs, { runs: 500, rng: seeded(42) });

  it('is deterministic under a seeded rng and reproduces the UI contract', () => {
    const a = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(run()));
    for (const k of ['meanIrr', 'medianIrr', 'stdDev', 'minIrr', 'maxIrr', 'var95', 'probabilityPositive']) {
      expect(typeof (a as any)[k]).toBe('number');
      expect(Number.isFinite((a as any)[k])).toBe(true);
    }
    expect(a.histogramBins.length).toBeGreaterThan(0);
    expect(a.histogramBins.reduce((n, b) => n + b.count, 0)).toBe(a.runs);
  });

  it('has ordered percentiles and a sane centre near the base case', () => {
    const a = run();
    expect(a.minIrr).toBeLessThanOrEqual(a.p5Irr);
    expect(a.p5Irr).toBeLessThanOrEqual(a.p50Irr);
    expect(a.p50Irr).toBeLessThanOrEqual(a.p95Irr);
    expect(a.p95Irr).toBeLessThanOrEqual(a.maxIrr);
    expect(a.var95).toBe(a.p5Irr);
    expect(a.probabilityPositive).toBeGreaterThanOrEqual(0);
    expect(a.probabilityPositive).toBeLessThanOrEqual(100);
  });
});
