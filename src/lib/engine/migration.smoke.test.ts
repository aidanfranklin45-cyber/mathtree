import { describe, it, expect } from 'vitest';
import { computeDealMetrics } from './compute';
import { auditDealRisks } from './index';
import { calculateTaxAndDepreciation, calculateHoldingPeriodWealth, calculateRefinanceEvent } from './index';
import { seedForm, buildInputs } from '../../components/studio/modals/editInputsForm';
import { mapSupabaseDeal } from '../../stores/useDealStore';
import { diffInputs } from '../scenarios';

/**
 * Migration smoke test: pure in-memory fixtures only. No Supabase client, no edge functions, no
 * writes. Confirms the compute-on-the-fly core still produces coherent analysis.
 */
const FIXTURES: Record<string, any> = {
  commercial: {
    id: 'demo-comm', title: 'Demo Commercial', asset_class: 'commercial', status: 'prospect', purchase_price: 1850000,
    inputs: { purchasePrice: 1850000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30, grossRentAnnual: 200000, monthlyRent: 16667, vacancyRate: 5, rentGrowth: 3, targetCapRate: 6.5, expenseRatio: 30, exitYear: 10, closingCosts: 20000, rehabCosts: 0, leaseType: 'NNN', gla: 15000, closingDate: '2026-10-01', discountRate: 8 },
  },
  'single-family': {
    id: 'demo-sfr', title: 'Demo SFR', asset_class: 'single-family', status: 'prospect', purchase_price: 450000,
    inputs: { purchasePrice: 450000, downPaymentPercent: 20, interestRate: 6.5, loanTerm: 30, monthlyRent: 3200, vacancyRate: 4, rentGrowth: 3, appreciationRate: 3.5, expenseRatio: 30, exitYear: 10, closingCosts: 9000, rehabCosts: 20000, closingDate: '2026-10-01', discountRate: 8 },
  },
  'multi-unit': {
    id: 'demo-multi', title: 'Demo Multi', asset_class: 'multi-unit', status: 'prospect', purchase_price: 1200000,
    inputs: { purchasePrice: 1200000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30, unitCount: 8, monthlyRentPerUnit: 1400, vacancyRate: 5, rentGrowth: 3, appreciationRate: 3.5, expenseRatio: 40, exitYear: 10, closingCosts: 15000, closingDate: '2026-10-01', discountRate: 8 },
  },
  storage: {
    id: 'demo-storage', title: 'Demo Storage', asset_class: 'storage', status: 'prospect', purchase_price: 2000000,
    inputs: { purchasePrice: 2000000, downPaymentPercent: 30, interestRate: 6.75, loanTerm: 25, storageUnitCount: 100, unitCount: 100, storageRentPerUnit: 150, monthlyRentPerUnit: 150, vacancyRate: 10, rentGrowth: 3, targetCapRate: 6.5, expenseRatio: 35, exitYear: 10, closingCosts: 20000, closingDate: '2026-10-01', discountRate: 8 },
  },
};

describe.each(Object.entries(FIXTURES))('core analysis: %s', (_name, deal) => {
  const m: any = computeDealMetrics(deal);
  const p = m.projections;

  it('produces finite headline metrics and a full hold schedule', () => {
    expect(p.length).toBe(deal.inputs.exitYear);
    expect(Number.isFinite(m.irr)).toBe(true);
    expect(Number.isFinite(m.npv)).toBe(true);
    expect(m.initialCashInvested).toBeGreaterThan(0);
  });

  it('is internally consistent year over year', () => {
    for (const y of p) {
      expect(y.netOperatingIncome).toBeCloseTo(y.effectiveGrossIncome - y.operatingExpenses, 0);
      expect(y.cashFlow).toBeCloseTo(y.netOperatingIncome - y.debtService - (y.capexReserve || 0), 0);
      expect(y.loanBalanceRemaining).toBeGreaterThanOrEqual(0);
    }
    expect(p[p.length - 1].loanBalanceRemaining).toBeLessThan(p[0].loanBalanceRemaining);
  });

  it('is deterministic (compute on the fly, no hidden state)', () => {
    expect(computeDealMetrics(deal).irr).toBe(m.irr);
  });

  it('tax, wealth and refinance reconcile with the projections', () => {
    const inputs = { ...deal.inputs };
    const tax = calculateTaxAndDepreciation(deal.asset_class, inputs, m);
    const seg = calculateTaxAndDepreciation(deal.asset_class, { ...inputs, enableCostSeg: true }, m);
    expect(tax.yearlyTaxDetails.length).toBe(p.length);
    expect(seg.yearlyTaxDetails[0].depreciation).toBeGreaterThan(tax.yearlyTaxDetails[0].depreciation);

    const w = calculateHoldingPeriodWealth(inputs, p, m.amortizationSchedule, p.length);
    const last = p[p.length - 1];
    expect(w.totalNetEquity).toBeCloseTo(Math.max(0, last.propertyValue - last.loanBalanceRemaining), 0);
    expect(w.totalNetWealth).toBeCloseTo(w.totalNetEquity + w.cumulativeCashFlow, 0);

    const refi = calculateRefinanceEvent(deal.asset_class, inputs, 5, 75, 6.5, 30);
    expect(refi.netCashOut).toBeCloseTo(refi.newLoanAmount - refi.oldLoanBalance - refi.newLoanAmount * 0.02, 0);
  });

  it('Edit Inputs round-trip (seed then build) leaves the analysis unchanged', () => {
    const rebuilt = buildInputs(seedForm(deal), deal);
    const m2: any = computeDealMetrics(deal, rebuilt);
    expect(m2.irr).toBeCloseTo(m.irr, 2);
    expect(m2.npv).toBeCloseTo(m.npv, 0);
    expect(m2.projections[0].cashFlow).toBeCloseTo(p[0].cashFlow, 0);
  });
});

describe('facts only', () => {
  it('deal mapping never stores or fabricates analysis or defaults', () => {
    const row = { id: 'x', title: 'T', asset_type: 'commercial', purchase_price: 100000, inputs: { vacancyRate: 0 }, irr: 99, metrics: { a: 1 } };
    const d: any = mapSupabaseDeal(row);
    expect(d.inputs.vacancyRate).toBe(0);
    expect(d.inputs.vacancyRatePercent).toBeUndefined();
    expect(d.irr).toBeUndefined();
    expect(d.metrics).toBeUndefined();
  });

  it('a changed assumption shows up as an input diff, computed not stored', () => {
    const changed = { ...FIXTURES.commercial.inputs, interestRate: 7.5 };
    const diff: any = diffInputs(FIXTURES.commercial.inputs, changed);
    expect(JSON.stringify(diff)).toContain('interestRate');
    expect((computeDealMetrics(FIXTURES.commercial, changed) as any).irr).not.toBe((computeDealMetrics(FIXTURES.commercial) as any).irr);
  });
});

describe('mid-year closing (partial first year)', () => {
  const deal: any = {
    asset_class: 'commercial',
    inputs: { purchasePrice: 300000, downPaymentPercent: 0, interestRate: 4.53, loanTerm: 20, exitYear: 15, closingDate: '2025-07-15', closingCosts: 12000, grossRentAnnual: 31200, monthlyRent: 2600, vacancyRate: 1, expenseRatio: 1, targetCapRate: 7.5, leaseType: 'NNN', discountRate: 6 },
  };
  const m: any = computeDealMetrics(deal);

  it('fixed-rate debt service stays constant once full years begin (no re-amortization drift)', () => {
    const fullYearDs = m.monthlyMortgagePayment * 12;
    expect(m.projections[0].operatingMonths).toBeLessThan(12);
    for (const y of m.projections.slice(1, 10)) expect(y.debtService).toBeCloseTo(fullYearDs, 0);
  });

  it('headline DSCR is the first full year, not the stub year', () => {
    expect(m.dscr).toBeCloseTo(m.projections[1].dscr, 2);
  });
});

describe('lease expiry assumptions (case-by-case)', () => {
  const lease = { leaseType: 'NNN', annualRent: 31200, tenantName: 'Tenant', monthlyRent: 2600, leaseEndDate: '2035-08-03', escalationRate: 3, escalationType: 'Percentage Bump (%)', leaseStartDate: '2025-08-03', nextEscalationDate: '2026-08-03', escalationFrequency: 'Annual on Anniversary' };
  const build = (over: Record<string, any>) => ({
    asset_class: 'commercial',
    inputs: { purchasePrice: 300000, downPaymentPercent: 0, interestRate: 4.53, loanTerm: 20, exitYear: 15, closingDate: '2025-07-15', closingCosts: 12000, grossRentAnnual: 31200, monthlyRent: 2600, vacancyRate: 1, expenseRatio: 1, targetCapRate: 7.5, leaseType: 'NNN', discountRate: 6, leases: [{ ...lease, ...over }] },
  }) as any;
  const byYear = (m: any, cal: number) => m.projections.find((p: any) => p.calendarYear === cal);

  it('default (no assumption) keeps income at $0 after expiry and the auditor flags it', () => {
    const d = build({});
    const m: any = computeDealMetrics(d);
    expect(byYear(m, 2037).grossPotentialIncome).toBe(0);
    const warnings = auditDealRisks('commercial', d.inputs, m);
    expect(warnings.some((w: any) => w.title === 'Lease Expires Inside Hold Period')).toBe(true);
  });

  it('extension option keeps rent flowing, with an optional one-time rent step', () => {
    const plain: any = computeDealMetrics(build({ expiryAssumption: 'extend', extensionYears: 5 }));
    const stepped: any = computeDealMetrics(build({ expiryAssumption: 'extend', extensionYears: 5, extensionRentChangePct: 10 }));
    expect(byYear(plain, 2037).grossPotentialIncome).toBeGreaterThan(0);
    expect(byYear(plain, 2039).grossPotentialIncome).toBeGreaterThan(byYear(plain, 2037).grossPotentialIncome); // escalations continue
    expect(byYear(stepped, 2037).grossPotentialIncome).toBeCloseTo(byYear(plain, 2037).grossPotentialIncome * 1.1, 0);
    expect(auditDealRisks('commercial', build({ expiryAssumption: 'extend' }).inputs, plain).some((w: any) => w.title === 'Lease Expires Inside Hold Period')).toBe(false);
  });

  it('a short extension ends on schedule', () => {
    const m: any = computeDealMetrics(build({ expiryAssumption: 'extend', extensionYears: 1 }));
    expect(byYear(m, 2036).grossPotentialIncome).toBeGreaterThan(0);
    expect(byYear(m, 2038).grossPotentialIncome).toBe(0);
  });

  it('vacancy then re-let: downtime earns nothing and carries holding costs, then a new tenant starts', () => {
    const none: any = computeDealMetrics(build({}));
    const relet: any = computeDealMetrics(build({ expiryAssumption: 'relet', reletVacancyMonths: 12 }));
    // Lease ends Aug 2035 -> vacant Sep 2035 .. Aug 2036 -> new tenant Sep 2036
    expect(byYear(relet, 2036).grossPotentialIncome).toBeGreaterThan(0);
    expect(byYear(relet, 2036).grossPotentialIncome).toBeLessThan(byYear(relet, 2037).grossPotentialIncome / 2);
    expect(byYear(relet, 2037).grossPotentialIncome).toBeGreaterThan(0);
    expect(byYear(relet, 2036).operatingExpenses).toBeGreaterThan(byYear(relet, 2037).operatingExpenses * 2); // holding costs in vacant months
    expect(byYear(relet, 2037).netOperatingIncome).toBeGreaterThan(byYear(none, 2037).netOperatingIncome);
  });

  it('re-let rent change and one-time leasing costs apply', () => {
    const base: any = computeDealMetrics(build({ expiryAssumption: 'relet', reletVacancyMonths: 6 }));
    const up: any = computeDealMetrics(build({ expiryAssumption: 'relet', reletVacancyMonths: 6, reletRentChangePct: -10, reletCosts: 9000 }));
    expect(byYear(up, 2038).grossPotentialIncome).toBeCloseTo(byYear(base, 2038).grossPotentialIncome * 0.9, 0);
    // leasing cost lands in the year the new tenant starts (Feb 2036)
    expect(byYear(up, 2036).operatingExpenses - byYear(base, 2036).operatingExpenses).toBeGreaterThan(8000);
  });
});
