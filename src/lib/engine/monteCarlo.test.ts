import { describe, it, expect } from 'vitest';
import { calculateProjections, resolveLeaseMonthlyRent, createMonteCarloRunner, runMonteCarlo } from './index';

/** Pure fixtures, no database. A lease-based deal (two lease periods, like an intercompany period then a formal lease). */
const leases = [
  { tenantName: 'Operating LLC (intercompany)', monthlyRent: 2600, annualRent: 31200, leaseStartDate: '2025-07-15', leaseEndDate: '2026-07-31', escalationRate: 0, expiryAssumption: 'vacant' },
  { tenantName: 'Operating LLC', monthlyRent: 2600, annualRent: 31200, leaseStartDate: '2026-08-03', leaseEndDate: '2036-08-03', escalationRate: 3, nextEscalationDate: '2027-08-03', escalationType: 'Percentage Bump (%)' },
];
const inputs: any = {
  purchasePrice: 300000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 25, exitYear: 12, closingDate: '2025-07-15',
  closingCosts: 9000, vacancyRate: 3, expenseRatio: 8, targetCapRate: 7.5, leaseType: 'NNN', discountRate: 8, leases,
};

/** Deterministic uniform source so runs are repeatable. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('lean evaluation', () => {
  it('gives exactly the same numbers as a full evaluation', () => {
    const full = calculateProjections('commercial', inputs);
    const lean = calculateProjections('commercial', inputs, { lean: true });
    for (const k of ['irr', 'npv', 'equityMultiplier', 'dscr', 'capRate', 'initialCashInvested']) expect(lean[k]).toEqual(full[k]);
    expect(lean.projections).toHaveLength(full.projections.length);
    lean.projections.forEach((p: any, i: number) => {
      for (const k of ['effectiveGrossIncome', 'netOperatingIncome', 'cashFlow', 'propertyValue', 'capRate', 'equity', 'debtService', 'cashOnCash'])
        expect(p[k]).toEqual(full.projections[i][k]);
    });
  });

  it('skips the explanatory text', () => {
    const lean = calculateProjections('commercial', inputs, { lean: true });
    expect(lean.projections[2].monthlyReceipts).toEqual([]);
    expect(lean.projections[2].methodologyFootnote).toBe('');
    const full = calculateProjections('commercial', inputs);
    expect(full.projections[2].monthlyReceipts.length).toBeGreaterThan(0);
  });

  it('a lease month resolves to the same rent, status and cycles either way', () => {
    for (const lease of leases) {
      for (let y = 2025; y <= 2040; y++) {
        for (let m = 1; m <= 12; m++) {
          const a = resolveLeaseMonthlyRent(lease, y, m);
          const b = resolveLeaseMonthlyRent(lease, y, m, { lean: true });
          expect([b.monthlyRent, b.isActive, b.status, b.escalationCycles, b.oneTimeCost]).toEqual([a.monthlyRent, a.isActive, a.status, a.escalationCycles, a.oneTimeCost]);
        }
      }
    }
  });

  it('re-reads lease dates when they change on the same object', () => {
    const l: any = { monthlyRent: 1000, leaseStartDate: '2025-01-01', leaseEndDate: '2030-01-01', escalationRate: 0, expiryAssumption: 'vacant' };
    expect(resolveLeaseMonthlyRent(l, 2025, 6).isActive).toBe(true);
    l.leaseStartDate = '2026-01-01';
    expect(resolveLeaseMonthlyRent(l, 2025, 6).isActive).toBe(false);
  });

  it('is fast enough with leases (generous budget; measured about 0.4 ms)', () => {
    calculateProjections('commercial', inputs, { lean: true });
    const t0 = performance.now();
    for (let i = 0; i < 25; i++) calculateProjections('commercial', inputs, { lean: true });
    expect((performance.now() - t0) / 25).toBeLessThan(2.5);
  });
});

describe('Monte Carlo runner', () => {
  it('advancing in slices gives the same result as running at once', () => {
    const once = runMonteCarlo('commercial', inputs, { runs: 300, rng: seeded(99) });
    const runner = createMonteCarloRunner('commercial', inputs, { runs: 300, rng: seeded(99) });
    expect(runner.total).toBe(300);
    runner.step(100);
    expect(runner.completed).toBe(100);
    runner.step(100);
    runner.step(1000); // asking for more than remains stops at the total
    expect(runner.completed).toBe(300);
    expect(runner.finish()).toEqual(once);
  });

  it('cannot be summarised before it is finished', () => {
    const runner = createMonteCarloRunner('commercial', inputs, { runs: 200, rng: seeded(1) });
    runner.step(50);
    expect(() => runner.finish()).toThrow(/incomplete/);
  });

  it('is repeatable with a fixed random source', () => {
    const a = runMonteCarlo('commercial', inputs, { runs: 200, rng: seeded(5) });
    const b = runMonteCarlo('commercial', inputs, { runs: 200, rng: seeded(5) });
    expect(a).toEqual(b);
  });
});
