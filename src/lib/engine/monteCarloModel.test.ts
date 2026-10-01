import { describe, it, expect } from 'vitest';
import { calculateProjections, runMonteCarlo, buildFixedHistogram, seededRandom } from './index';

/** Pure fixtures, no database. A lease-based deal: intercompany rent, then a formal 10-year lease ending Aug 2036. */
const leases = [
  { tenantName: 'Operating LLC (intercompany)', monthlyRent: 2600, annualRent: 31200, leaseStartDate: '2025-07-15', leaseEndDate: '2026-07-31', escalationRate: 0, expiryAssumption: 'vacant' },
  { tenantName: 'Operating LLC', monthlyRent: 2600, annualRent: 31200, leaseStartDate: '2026-08-03', leaseEndDate: '2036-08-03', escalationRate: 3, nextEscalationDate: '2027-08-03', escalationType: 'Percentage Bump (%)' },
];
const inputs: any = {
  purchasePrice: 300000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 25, exitYear: 12, closingDate: '2025-07-15',
  closingCosts: 9000, vacancyRate: 3, expenseRatio: 8, targetCapRate: 7.5, leaseType: 'NNN', discountRate: 8, leases,
};

describe('every simulated input has to matter (a dead input silently flattens the distribution)', () => {
  const sd = (r: any) => r.profit.stdDev;
  const run = (over: Record<string, any>, opts: Record<string, any> = {}) =>
    runMonteCarlo('commercial', { ...inputs, ...over }, { runs: 400, seed: 7, tenantDefaultProbPct: 0, ...opts });

  it('rent-growth volatility moves the result when a lease ends inside the hold (market rent after the end drifts)', () => {
    const calm = run({ exitYear: 15 }, { rentGrowthVolPct: 0 });
    const wild = run({ exitYear: 15 }, { rentGrowthVolPct: 4 });
    expect(sd(wild)).toBeGreaterThan(sd(calm) * 1.1);
  });

  it('but it moves nothing while contract rent covers the whole hold (contract rent is not varied)', () => {
    const calm = run({ exitYear: 8 }, { rentGrowthVolPct: 0 });
    const wild = run({ exitYear: 8 }, { rentGrowthVolPct: 4 });
    expect(wild.profit.mean).toBeCloseTo(calm.profit.mean, -2);
    expect(sd(wild)).toBeCloseTo(sd(calm), -2);
  });

  it('exit-cap volatility moves the result', () => {
    expect(sd(run({}, { exitCapSpreadBps: 300 }))).toBeGreaterThan(sd(run({}, { exitCapSpreadBps: 25 })));
  });

  it('vacancy volatility moves the result', () => {
    expect(sd(run({}, { vacancyVolPct: 8 }))).toBeGreaterThan(sd(run({}, { vacancyVolPct: 1 })));
  });
});

describe('tenant default risk (a labelled probability with downtime)', () => {
  const run = (opts: Record<string, any>) => runMonteCarlo('commercial', inputs, { runs: 600, seed: 11, ...opts });

  it('lowers profit, more so with a higher chance and a longer downtime', () => {
    const none = run({ tenantDefaultProbPct: 0 });
    const some = run({ tenantDefaultProbPct: 20, tenantDefaultDowntimeMonths: 12 });
    const worse = run({ tenantDefaultProbPct: 20, tenantDefaultDowntimeMonths: 24 });
    const likelier = run({ tenantDefaultProbPct: 40, tenantDefaultDowntimeMonths: 12 });
    expect(some.profit.mean).toBeLessThan(none.profit.mean);
    expect(worse.profit.mean).toBeLessThan(some.profit.mean);
    expect(likelier.profit.mean).toBeLessThan(some.profit.mean);
  });

  it('reports what it applied and how often it happened', () => {
    const r = run({ tenantDefaultProbPct: 20, tenantDefaultDowntimeMonths: 6 });
    expect(r.tenantDefault).toMatchObject({ applies: true, probabilityPct: 20, downtimeMonths: 6 });
    expect(r.tenantDefault.runsAffectedPct).toBeGreaterThan(14);
    expect(r.tenantDefault.runsAffectedPct).toBeLessThan(26);
    expect(run({ tenantDefaultProbPct: 0 }).tenantDefault.applies).toBe(false);
  });

  it('applies only to commercial and storage deals with income', () => {
    const home = runMonteCarlo('single-family', { purchasePrice: 300000, monthlyRent: 2400, downPaymentPercent: 20, interestRate: 6.5, loanTerm: 30, exitYear: 10 }, { runs: 200, seed: 3, tenantDefaultProbPct: 30 });
    expect(home.tenantDefault.applies).toBe(false);
    const land = runMonteCarlo('commercial', { purchasePrice: 90000, downPaymentPercent: 20, interestRate: 6.5, loanTerm: 20, exitYear: 10 }, { runs: 200, seed: 3, tenantDefaultProbPct: 30 });
    expect(land.tenantDefault.applies).toBe(false);
  });
});

describe('profit in dollars and IRR for every deal', () => {
  it('net profit is every cash flow plus the exit equity minus the cash put in', () => {
    const r = runMonteCarlo('commercial', inputs, { runs: 300, seed: 5, tenantDefaultProbPct: 0, rentGrowthVolPct: 0, vacancyVolPct: 0, exitCapSpreadBps: 0, apprecVolPct: 0 });
    const base = calculateProjections('commercial', inputs);
    const expected = base.projections.reduce((s: number, p: any) => s + p.cashFlow, 0) + base.projections[base.projections.length - 1].equity - base.initialCashInvested;
    expect(Math.abs(r.profit.mean - expected) / Math.abs(expected)).toBeLessThan(0.02);
  });

  it('flags thin equity (and not normal equity), so IRR can be read with care', () => {
    expect(runMonteCarlo('commercial', { ...inputs, downPaymentPercent: 0 }, { runs: 100, seed: 1 }).equity.thin).toBe(true);
    expect(runMonteCarlo('commercial', inputs, { runs: 100, seed: 1 }).equity.thin).toBe(false);
  });

  it('reports the chance of clearing the hurdle, which falls as the hurdle rises', () => {
    const low = runMonteCarlo('commercial', inputs, { runs: 300, seed: 2, hurdleRatePct: 2 });
    const high = runMonteCarlo('commercial', inputs, { runs: 300, seed: 2, hurdleRatePct: 40 });
    expect(low.probAboveHurdle).toBeGreaterThan(high.probAboveHurdle);
    expect(high.probAboveHurdle).toBe(0);
  });
});

describe('shape and repeatability', () => {
  it('a normal-equity deal without default risk gives a spread-out, roughly symmetric distribution (no spike)', () => {
    const r = runMonteCarlo('commercial', inputs, { runs: 1000, seed: 21, tenantDefaultProbPct: 0 });
    for (const bins of [r.histogramBins, r.profit.histogramBins]) {
      const biggest = Math.max(...bins.map((b) => b.count));
      expect(biggest / r.runs).toBeLessThan(0.4);
    }
    expect(Math.abs(r.skewnessIndex)).toBeLessThan(0.5);
  });

  it('the same seed repeats exactly and a different seed does not', () => {
    const a = runMonteCarlo('commercial', inputs, { runs: 200, seed: 'deal-1' });
    const b = runMonteCarlo('commercial', inputs, { runs: 200, seed: 'deal-1' });
    const c = runMonteCarlo('commercial', inputs, { runs: 200, seed: 'deal-2' });
    expect(a).toEqual(b);
    expect(c.meanIrr).not.toBe(a.meanIrr);
  });

  it('a seeded generator is uniform enough (mean near 0.5, inside [0,1))', () => {
    const g = seededRandom(42);
    const xs = Array.from({ length: 5000 }, g);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe('fixed-width histogram', () => {
  const fmt = (v: number) => v.toFixed(1);
  const gaussSample = (n: number) => {
    const g = seededRandom(9);
    return Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(1 - g())) * Math.cos(2 * Math.PI * g()) * 5 + 20).sort((a, b) => a - b);
  };

  it('counts every value exactly once and has equal-width core bins', () => {
    const bins = buildFixedHistogram(gaussSample(1000), fmt);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(1000);
    const core = bins.filter((b) => !b.isTail);
    expect(core).toHaveLength(12);
    const widths = core.map((b) => b.binEnd - b.binStart);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1e-6);
  });

  it('a bell-shaped sample looks like a bell, with only about 1% in each end bar', () => {
    const bins = buildFixedHistogram(gaussSample(1000), fmt);
    expect(bins.filter((b) => b.isTail).every((b) => b.count <= 15)).toBe(true);
    const core = bins.filter((b) => !b.isTail).map((b) => b.count);
    const peak = core.indexOf(Math.max(...core));
    expect(Math.max(...core)).toBeLessThan(250);
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThan(9);
  });

  it('never invents a window: identical values give a single bar', () => {
    const bins = buildFixedHistogram(new Array(100).fill(60.6), fmt);
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(100);
  });

  it('has no end bars when nothing falls outside the 1st to 99th percentile, and handles an empty sample', () => {
    const bins = buildFixedHistogram(Array.from({ length: 100 }, (_, i) => i), fmt);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(100);
    expect(buildFixedHistogram([], fmt)).toEqual([]);
  });
});
