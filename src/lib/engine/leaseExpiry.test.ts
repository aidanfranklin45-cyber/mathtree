import { describe, it, expect, afterEach } from 'vitest';
import { computeDealMetrics, prepareEngineInputs } from './compute';
import { auditDealRisks } from './index';
import { setExpiryDefaults } from './expiryDefaults';
import { applyLeaseExpiryDefaults, normalizeExpiryDefaults, leaseExpiryNotices, DEFAULT_EXPIRY } from '../../../supabase/functions/_shared/leaseExpiry';

/** Pure fixtures only, no database. A 10-year lease ending Aug 2035, held 15 years (the Stop and Go shape). */
const lease = {
  tenantName: 'Tenant', monthlyRent: 2600, annualRent: 31200, leaseStartDate: '2025-08-03', leaseEndDate: '2035-08-03',
  escalationType: 'Percentage Bump (%)', escalationRate: 3, nextEscalationDate: '2026-08-03', leaseType: 'NNN',
};
const deal = (over: Record<string, unknown> = {}, leaseOver: Record<string, unknown> = {}): any => ({
  id: 'd1', asset_class: 'commercial', purchase_price: 300000,
  inputs: {
    purchasePrice: 300000, downPaymentPercent: 0, interestRate: 4.53, loanTerm: 20, exitYear: 15, closingDate: '2025-07-15',
    closingCosts: 12000, grossRentAnnual: 31200, monthlyRent: 2600, vacancyRate: 1, expenseRatio: 1, targetCapRate: 7.5,
    leaseType: 'NNN', discountRate: 6, leases: [{ ...lease, ...leaseOver }], ...over,
  },
});
const cf = (m: any, calendarYear: number) => m.projections.find((p: any) => p.calendarYear === calendarYear);

afterEach(() => setExpiryDefaults({}));

describe('after a lease ends: investor default and per-property override', () => {
  it('defaults to renewing on current terms: income and cash flow continue past the lease end', () => {
    const m: any = computeDealMetrics(deal());
    expect(cf(m, 2037).effectiveGrossIncome).toBeGreaterThan(cf(m, 2034).effectiveGrossIncome);
    expect(m.projections.every((p: any) => p.cashFlow > 0)).toBe(true);
  });

  it('"vacant" is the pessimistic case: income stops and the shortfall is funded', () => {
    setExpiryDefaults({ leaseExpiryMode: 'vacant' });
    const m: any = computeDealMetrics(deal());
    expect(cf(m, 2037).effectiveGrossIncome).toBe(0);
    expect(cf(m, 2037).cashFlow).toBeLessThan(0);
    expect(m.irr).toBeLessThan((computeDealMetrics(deal({}, { expiryAssumption: 'renew' })) as any).irr);
  });

  it('"relet" is a brief vacancy, then the old rent returns and keeps rising', () => {
    setExpiryDefaults({ leaseExpiryMode: 'relet', leaseExpiryVacancyMonths: 6 });
    const m: any = computeDealMetrics(deal());
    const renew: any = computeDealMetrics(deal({}, { expiryAssumption: 'renew' }));
    expect(cf(m, 2035).effectiveGrossIncome).toBeLessThan(cf(renew, 2035).effectiveGrossIncome); // the vacant months
    expect(cf(m, 2038).effectiveGrossIncome).toBeGreaterThan(cf(m, 2037).effectiveGrossIncome); // increases resume
    expect(m.irr).toBeLessThan(renew.irr);
    expect(m.irr).toBeGreaterThan((computeDealMetrics(deal({}, { expiryAssumption: 'vacant' })) as any).irr);
  });

  it('a lease with its own choice ignores the investor default', () => {
    setExpiryDefaults({ leaseExpiryMode: 'vacant' });
    const m: any = computeDealMetrics(deal({}, { expiryAssumption: 'renew' }));
    expect(cf(m, 2037).effectiveGrossIncome).toBeGreaterThan(0);
  });

  it('an explicit "none" stays vacant for old deals', () => {
    const m: any = computeDealMetrics(deal({}, { expiryAssumption: 'none' }));
    expect(cf(m, 2037).effectiveGrossIncome).toBe(0);
  });

  it('a shorter hold that ends inside the lease is unaffected by the setting', () => {
    const a: any = computeDealMetrics(deal({ exitYear: 10 }));
    setExpiryDefaults({ leaseExpiryMode: 'vacant' });
    const b: any = computeDealMetrics(deal({ exitYear: 10 }));
    expect(b.irr).toBe(a.irr);
  });

  it('says which assumption applies, and whether it came from the default', () => {
    const d = deal();
    const w: any[] = auditDealRisks('commercial', prepareEngineInputs(d), computeDealMetrics(d));
    const note = w.find((x) => x.title === 'Lease Expires Inside Hold Period');
    expect(note?.level).toBe('info');
    expect(note?.description).toMatch(/renews on current terms/);
    expect(note?.description).toMatch(/investor default/);
  });
});

describe('resolver', () => {
  it('normalizes junk preferences to the defaults', () => {
    expect(normalizeExpiryDefaults(undefined)).toEqual(DEFAULT_EXPIRY);
    expect(normalizeExpiryDefaults({ leaseExpiryMode: 'sideways', leaseExpiryVacancyMonths: 'x' })).toEqual(DEFAULT_EXPIRY);
    expect(normalizeExpiryDefaults({ leaseExpiryMode: 'relet', leaseExpiryVacancyMonths: 500 }).vacancyMonths).toBe(60);
  });

  it('fills only leases with no assumption of their own and does not mutate the input', () => {
    const inputs: any = { leases: [{ tenantName: 'A' }, { tenantName: 'B', expiryAssumption: 'vacant' }] };
    const out: any = applyLeaseExpiryDefaults(inputs, { mode: 'relet', vacancyMonths: 4 });
    expect(out.leases[0]).toMatchObject({ expiryAssumption: 'relet', reletVacancyMonths: 4, expirySource: 'default' });
    expect(out.leases[1].expiryAssumption).toBe('vacant');
    expect(inputs.leases[0].expiryAssumption).toBeUndefined();
  });

  it('lists only leases that end before the hold does', () => {
    const inputs = { leases: [{ tenantName: 'A', leaseEndDate: '2035-08-03' }, { tenantName: 'B', leaseEndDate: '2050-01-01' }] };
    expect(leaseExpiryNotices(inputs, 2040).map((n) => n.tenant)).toEqual(['A']);
  });
});
