import { describe, it, expect } from 'vitest';
import { createLeaseScheduleCache } from './index';
import { calculateProjections, createMonteCarloRunner } from './testEngine';

/** A 120-unit apartment building, one lease per tenant, with a spread of move-in dates, rents, terms and expiry assumptions. */
const modes = ['renew', 'extend', 'relet', 'vacant'];
const bigLeases = Array.from({ length: 120 }, (_, i) => {
  const startYear = 2022 + (i % 4);
  const startMonth = 1 + (i % 12);
  const monthToMonth = i % 7 === 0;
  return {
    tenantName: `Unit ${100 + i}`,
    monthlyRent: 1200 + (i % 9) * 35,
    leaseStartDate: `${startYear}-${String(startMonth).padStart(2, '0')}-01`,
    leaseEndDate: monthToMonth ? '' : `${startYear + 1 + (i % 3)}-${String(startMonth).padStart(2, '0')}-28`,
    termType: monthToMonth ? 'month_to_month' : 'fixed',
    escalationRate: i % 5 === 0 ? 0 : 3,
    nextEscalationDate: i % 6 === 0 ? `${startYear + 1}-${String(startMonth).padStart(2, '0')}-01` : undefined,
    expiryAssumption: modes[i % modes.length],
    extensionYears: 2,
    extensionRentChangePct: i % 2 ? 4 : 0,
    reletVacancyMonths: 1 + (i % 3),
    reletRentChangePct: 5,
    reletCosts: i % 3 === 0 ? 900 : 0,
  };
});
const bigInputs: any = {
  purchasePrice: 18_000_000, downPaymentPercent: 30, interestRate: 6.25, loanTerm: 30, exitYear: 10, closingDate: '2025-09-01',
  closingCosts: 250_000, vacancyRate: 5, expenseRatio: 38, targetCapRate: 6, rentGrowth: 3, discountRate: 8, unitCount: 120, leases: bigLeases,
};

/** Deterministic uniform source so scenarios are repeatable. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Scenarios like the Monte Carlo makes: drift after lease ends, tenants leaving with make-ready costs, a default. */
function scenarios(base: any, count: number): any[] {
  const rng = seeded(11);
  const out: any[] = [];
  for (let s = 0; s < count; s++) {
    const tenantInterruptions = Array.from({ length: Math.floor(rng() * 25) }, () => ({
      leaseIndex: Math.floor(rng() * base.leases.length),
      startOffset: Math.floor(rng() * 120),
      months: Math.floor(rng() * 4),
      makeReadyCost: rng() < 0.8 ? 1500 * rng() : 0,
    }));
    out.push({ ...base, marketRentDrift: s === 0 ? 0 : (rng() - 0.5) * 4, rentGrowth: 3 + (rng() - 0.5) * 2, vacancyRate: s % 2 ? 0 : 5, tenantInterruptions });
  }
  return out;
}

describe('rent roll resolved once per simulation', () => {
  for (const [asset, closingDate] of [['multi-unit', '2025-09-01'], ['commercial', '2025-01-15'], ['storage', '2024-03-01']] as const) {
    it(`gives exactly the same numbers as resolving every lease each run (${asset}, closing ${closingDate})`, () => {
      const cache = createLeaseScheduleCache();
      for (const scenario of scenarios({ ...bigInputs, closingDate }, 30)) {
        const plain = calculateProjections(asset, scenario, { lean: true });
        const fast = calculateProjections(asset, scenario, { lean: true, leaseScheduleCache: cache });
        expect(fast).toEqual(plain);
      }
    });
  }

  it('builds a new schedule when the leases, closing or hold change', () => {
    const cache = createLeaseScheduleCache();
    const a = { ...bigInputs, marketRentDrift: 1.2 };
    const variants = [
      a,
      { ...a, leases: bigLeases.map((l) => ({ ...l, monthlyRent: l.monthlyRent + 50 })) },
      { ...a, closingDate: '2026-02-01' },
      { ...a, exitYear: 7 },
      a,
    ];
    for (const v of variants) {
      expect(calculateProjections('multi-unit', v, { lean: true, leaseScheduleCache: cache })).toEqual(calculateProjections('multi-unit', v, { lean: true }));
    }
  });

  it('is ignored for a full (non-lean) evaluation', () => {
    const cache = createLeaseScheduleCache();
    const full = calculateProjections('multi-unit', bigInputs, { leaseScheduleCache: cache });
    expect(cache.schedule).toBeUndefined();
    expect(full.projections[1].monthlyReceipts.length).toBeGreaterThan(0);
  });

  it('1,000 runs of a 120-unit rent roll stay fast (generous budget; was about 3.2 s, now well under 1 s)', () => {
    const t0 = performance.now();
    const runner = createMonteCarloRunner('multi-unit', bigInputs, { runs: 1000, seed: 7 });
    runner.step(runner.total);
    runner.finish();
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
