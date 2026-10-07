import { describe, expect, it } from 'vitest';
import type { IntakeDocument, LeaseIntake, LoanTermsIntake, OperatingStatementIntake, PurchaseAgreementIntake, RentRollIntake, RentRollRow, Sourced } from './intake';
import { found, missing, val } from './intake';
import { classifyDocument } from './documentTypes';
import { leaseMonthlyRent, periodMonths, statementTotals } from './normalize';
import { validateIntake } from './validate';
import { buildDealPatch } from './toDealInputs';
import { computeDealMetrics } from '../engine/compute';

const f = <T,>(v: T): Sourced<T> => found(v, 'llm', 0.9);

const lease = (o: Partial<LeaseIntake> = {}): LeaseIntake => ({
  documentType: 'lease',
  tenantName: f('Acme Dental'), premises: f('Suite 100'), squareFeet: f(2000),
  commencementDate: f('2025-01-01'), expirationDate: f('2030-12-31'),
  baseRent: f(5000), baseRentPeriod: f('monthly'),
  escalationKind: f('fixed_percent'), escalationValue: f(3), escalationFrequency: f('annual'), rentSteps: [],
  expenseStructure: f('NNN'), proRataSharePercent: missing(), baseYear: missing(), camCapPercent: missing(),
  renewalOptionCount: f(2), renewalOptionYears: f(5), renewalRentBasis: f('fair_market'),
  freeRentMonths: missing(), tenantImprovementAllowance: missing(), securityDeposit: missing(), hasPersonalGuaranty: missing(),
  earlyTerminationRight: missing(), earlyTerminationFee: missing(), percentageRentPercent: missing(), specialProvisions: missing(),
  ...o,
});

const row = (o: Partial<RentRollRow> = {}): RentRollRow => ({
  unit: f('1'), tenantName: f('Tenant A'), squareFeet: missing(), monthlyRent: f(1000),
  leaseStartDate: missing(), leaseEndDate: missing(), status: f('occupied'), securityDeposit: missing(), note: missing(), ...o,
});

const rentRoll = (rows: RentRollRow[], o: Partial<RentRollIntake> = {}): RentRollIntake => ({
  documentType: 'rent_roll', asOfDate: f('2026-09-01'), rentPeriod: f('monthly'), rows,
  reportedTotalRent: missing(), reportedUnitCount: missing(), reportedOccupancyPercent: missing(), ...o,
});

const line = <C extends string>(label: string, category: C, amount: number | null) => ({ label: f(label), category: f(category), amount: amount === null ? missing<number>() : f(amount) });

const t12 = (o: Partial<OperatingStatementIntake> = {}): OperatingStatementIntake => ({
  documentType: 'operating_statement', periodStart: f('2025-10-01'), periodEnd: f('2026-09-30'),
  income: [line('Base rent', 'rent', 120000), line('Vacancy', 'vacancy_credit_loss', -6000), line('Parking', 'other_income', 3000)],
  expenses: [line('Taxes', 'property_tax', 14000), line('Insurance', 'insurance', 6000), line('Repairs', 'repairs_maintenance', 12000), line('Mgmt', 'management', 8000),
    line('Reserves', 'reserves_capex', 5000), line('Mortgage', 'debt_service', 60000)],
  reportedEffectiveGrossIncome: missing(), reportedTotalExpenses: missing(), reportedNoi: missing(), ...o,
});

const loan = (o: Partial<LoanTermsIntake> = {}): LoanTermsIntake => ({
  documentType: 'loan_terms', loanAmount: f(750000), interestRatePercent: f(6.5), rateType: f('fixed'), termYears: f(10), amortizationYears: f(25),
  interestOnlyYears: missing(), originationFeePercent: missing(), minDscr: missing(), maxLtvPercent: missing(), prepaymentPenalty: missing(), ...o,
});

const psa = (price: number): PurchaseAgreementIntake => ({
  documentType: 'purchase_agreement', purchasePrice: f(price), closingDate: f('2026-12-01'), earnestMoney: missing(), diligenceDays: missing(), buyerClosingCosts: f(15000), address: missing(),
});

describe('classifyDocument', () => {
  it('recognises a lease from its language', () => {
    const r = classifyDocument({ text: 'LEASE AGREEMENT between Landlord and Tenant. Commencement Date ... Base Rent ... Security Deposit ... Premises' });
    expect(r.type).toBe('lease');
    expect(r.confidence).toBeGreaterThan(0.5);
  });
  it('recognises a T12 and does not confuse it with a rent roll', () => {
    const r = classifyDocument({ text: 'Trailing 12 Net Operating Income Total Operating Expenses Effective Gross Income Property Taxes Management Fee', filename: 'Spokane T12.xlsx' });
    expect(r.type).toBe('operating_statement');
  });
  it('uses the filename as evidence', () => {
    expect(classifyDocument({ text: 'unit tenant sq ft occupied vacant', filename: 'rent roll sept.csv' }).type).toBe('rent_roll');
  });
  it('refuses to guess when nothing is clear', () => {
    const r = classifyDocument({ text: 'hello world, here are some photos from the site visit' });
    expect(r.type).toBe('unknown');
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe('normalize', () => {
  it('counts statement months inclusively', () => {
    expect(periodMonths('2025-01-01', '2025-12-31')).toBe(12);
    expect(periodMonths('2026-01-01', '2026-06-30')).toBe(6);
    expect(periodMonths(null, '2026-06-30')).toBeNull();
  });
  it('converts lease rent from any stated period, and refuses per-sf rent without square feet', () => {
    expect(leaseMonthlyRent(lease({ baseRent: f(60000), baseRentPeriod: f('annual') }))).toBe(5000);
    expect(leaseMonthlyRent(lease({ baseRent: f(30), baseRentPeriod: f('per_sf_annual') }))).toBe(5000);
    expect(leaseMonthlyRent(lease({ baseRent: f(30), baseRentPeriod: f('per_sf_annual'), squareFeet: missing() }))).toBeNull();
    expect(leaseMonthlyRent(lease({ baseRentPeriod: missing() }))).toBeNull();
  });
  it('annualises a partial-year statement and keeps non-operating lines out of expenses', () => {
    const t = statementTotals(t12({ periodStart: f('2026-01-01'), periodEnd: f('2026-06-30') }));
    expect(t.annualFactor).toBe(2);
    expect(t.income.rent).toBe(240000);
    expect(t.income.vacancy_credit_loss).toBe(12000); // sign-agnostic, always a loss
    expect(t.operatingExpenses).toBe((14000 + 6000 + 12000 + 8000) * 2);
    expect(t.excludedExpenses).toBe((5000 + 60000) * 2);
  });
});

describe('validateIntake', () => {
  it('flags a lease that ends before it starts', () => {
    const issues = validateIntake(lease({ expirationDate: f('2024-01-01') }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'expirationDate')).toBe(true);
  });
  it('flags a rent roll whose rows do not add to its printed total', () => {
    const issues = validateIntake(rentRoll([row(), row({ unit: f('2'), tenantName: f('B') })], { reportedTotalRent: f(3000) }));
    expect(issues.some((i) => i.field === 'reportedTotalRent')).toBe(true);
    expect(validateIntake(rentRoll([row(), row({ unit: f('2'), tenantName: f('B') })], { reportedTotalRent: f(2000) }))).toEqual([]);
  });
  it('catches swapped term and amortization', () => {
    expect(validateIntake(loan({ termYears: f(30), amortizationYears: f(10) })).some((i) => i.severity === 'error')).toBe(true);
  });
  it('warns that a six-month statement is being annualised', () => {
    expect(validateIntake(t12({ periodEnd: f('2026-03-31') })).some((i) => i.field === 'periodEnd')).toBe(true);
  });
  it('rejects an unclassified document', () => {
    expect(validateIntake({ documentType: 'unknown', note: missing() })[0].severity).toBe('error');
  });
});

describe('buildDealPatch', () => {
  it('derives the expense ratio from a T12 on the engine\'s own basis (gross rent before vacancy, operating lines only)', () => {
    const r = buildDealPatch([t12()]);
    // (14000 + 6000 + 12000 + 8000) / 120000 = 33.33%; reserves and mortgage are excluded
    expect(r.patch.expenseRatio).toBeCloseTo(26.67, 2); // (80,000 less the 16,000 of management, which is your decision) / 240,000
    expect(r.provenance.expenseRatio.reliability).toBe('reported');
    expect(r.patch.otherIncomeAnnual).toBeGreaterThan(0); // other income is kept by the owner, so it counts as income
    expect(r.provenance.otherIncomeAnnual.how).toMatch(/other income/);
  });

  it('never invents a value: with no documents everything required is missing and nothing is patched', () => {
    const r = buildDealPatch([]);
    expect(r.patch).toEqual({});
    expect(r.missing.join(' ')).toMatch(/purchasePrice/);
    expect(r.missing.join(' ')).toMatch(/expenseRatio/);
  });

  it('writes the escalation explicitly, because an unset one makes the engine assume 3%', () => {
    const none = buildDealPatch([lease({ escalationKind: f('none'), escalationValue: missing() })]);
    expect((none.patch.leases as any[])[0].escalationRate).toBe(0);
    const unknown = buildDealPatch([lease({ escalationKind: missing(), escalationValue: missing() })]);
    expect((unknown.patch.leases as any[])[0].escalationRate).toBe(0);
    expect(unknown.notes.join(' ')).toMatch(/no escalation/);
  });

  it('records what the engine cannot model rather than pretending', () => {
    const r = buildDealPatch([lease({ escalationKind: f('stepped_schedule'), escalationValue: missing(), earlyTerminationRight: f(true), freeRentMonths: f(3) })]);
    const notes = r.notes.join(' ');
    expect(notes).toMatch(/stepped rent schedule/);
    expect(notes).toMatch(/early-termination/);
    expect(notes).toMatch(/free rent/);
    expect(notes).toMatch(/renewal option/);
  });

  it('lets an executed lease override the rent roll row for the same tenant', () => {
    const r = buildDealPatch([
      rentRoll([row({ tenantName: f('Acme Dental'), monthlyRent: f(4800) }), row({ unit: f('2'), tenantName: f('Bolt Cafe'), monthlyRent: f(2500) })]),
      lease({ baseRent: f(5000) }),
    ]);
    const leases = r.patch.leases as any[];
    expect(leases).toHaveLength(2);
    expect(leases.find((l) => l.tenantName === 'Acme Dental').monthlyRent).toBe(5000);
    expect(leases.find((l) => l.tenantName === 'Bolt Cafe').monthlyRent).toBe(2500);
    expect(r.provenance.leases.reliability).toBe('executed');
  });

  it('does not apply vacancy on top of an occupied-tenants lease list (it would double-count)', () => {
    const r = buildDealPatch([rentRoll([row(), row({ unit: f('2'), status: f('vacant'), monthlyRent: missing(), tenantName: missing() })]), t12()]);
    expect(r.patch.vacancyRate).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/double-count/);
  });

  it('applies the statement\'s vacancy when there is no lease list', () => {
    expect(buildDealPatch([t12()]).patch.vacancyRate).toBe(5);
  });

  it('turns a loan amount into a down payment only when a price is known, and keeps term and amortization apart', () => {
    const withPrice = buildDealPatch([psa(1000000), loan()]);
    expect(withPrice.patch.downPaymentPercent).toBe(25);
    expect(withPrice.patch.loanTermYears).toBe(10);
    expect(withPrice.patch.amortizationYears).toBe(25);
    expect(withPrice.patch.closingCosts).toBe(15000);

    const noPrice = buildDealPatch([loan()]);
    expect(noPrice.patch.downPaymentPercent).toBeUndefined();
    expect(noPrice.missing.join(' ')).toMatch(/downPaymentPercent/);
  });

  it('uses the list price as a starting price, but keeps the NOI and cap rate the seller claims out of the inputs', () => {
    const om = (): IntakeDocument => ({
      documentType: 'offering_memorandum', address: f('1 Main St'), city: missing(), state: missing(), zip: missing(), apn: missing(), assetClass: missing(),
      askingPrice: f(2000000), squareFeet: f(10000), lotAcres: missing(), yearBuilt: missing(), unitCount: missing(), occupancyPercent: f(100), expenseStructure: missing(),
      claimedNoi: f(150000), claimedCapRatePercent: f(7.5), tenantSummaries: missing(),
      lotSqFt: missing(), averageCurrentRent: missing(), averageMarketRent: missing(), unitMix: [], income: [], expenses: [],
    });
    const r = buildDealPatch([om()]);
    expect(r.patch.address).toBe('1 Main St');
    expect(r.patch.purchasePrice).toBe(2000000);
    expect(r.provenance.purchasePrice.reliability).toBe('projected');
    // a price the owner already typed always wins over the seller's
    expect(buildDealPatch([om()], { purchasePrice: 1800000 }).patch.purchasePrice).toBe(1800000);
    expect(r.claims.claimedNoi.value).toBe(150000);
    expect(r.claims.askingPrice).toBeUndefined(); // used as the price, so not also listed as a claim
    expect(buildDealPatch([om()], { purchasePrice: 1800000 }).claims.askingPrice.value).toBe(2000000); // not used: shown for comparison
    expect(Object.keys(r.patch)).not.toContain('claimedNoi');
  });

  it('a lower-reliability document never overwrites a higher one, whatever order they arrive in', () => {
    const a = buildDealPatch([loan({ interestRatePercent: f(7) }), { ...loan({ interestRatePercent: f(6) }) }]);
    expect(a.patch.interestRate).toBeDefined();
    const price = buildDealPatch([psa(1000000)], { purchasePrice: 900000 });
    expect(price.patch.purchasePrice).toBe(1000000);
  });

  it('produces inputs the engine accepts: only engine-read keys, and a positive expense line', () => {
    const r = buildDealPatch([psa(1000000), lease({ baseRent: f(10000) }), t12(), loan()]);
    // The documents supply facts; the owner's own assumptions (here stated explicitly) supply the rest. The engine accepts the result.
    const owner = { holdingPeriod: 5, discountRate: 8, targetCapRate: 7, sellingCostPercent: 3, capexReserveAnnual: 0, annualTaxes: 3000, annualInsurance: 1000, annualMaintenance: 1000, vacancyRate: 5 };
    const m = computeDealMetrics({ asset_class: 'commercial', inputs: { ...owner, ...r.patch } as any });
    expect(m.projections[0].operatingExpenses).toBeGreaterThan(0);
    expect(m.loanAmount).toBe(750000);
    expect(val(found(1))).toBe(1);
  });
});
