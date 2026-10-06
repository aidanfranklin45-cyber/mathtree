import { describe, it, expect } from 'vitest';
import { buildBriefModel, type LeaseRow, type ParcelRow } from './buildBriefModel';
import { computeDealMetrics } from '../engine/testEngine';
import { withLegacyDefaults } from '../engine/testInputs';

const baseInputs = {
  purchasePrice: 1_000_000, downPaymentPercent: 30, interestRate: 6.5, loanTerm: 25,
  vacancyRate: 5, expenseRatio: 20, rentGrowth: 3, closingCosts: 20000, rehabCosts: 80000, exitYear: 10,
  monthlyRent: 9000,
};

const mkDeal = (inputs: Record<string, any>): any => ({
  id: 'fixture', title: 'Fixture Deal', asset_class: 'commercial', status: 'owned',
  purchase_price: 1_000_000, inputs: withLegacyDefaults('commercial', inputs),
});

const parcels: ParcelRow[] = [
  { apn: '1', formatted_apn: '10-0001', is_primary: true, included: true, market_land_val: 100000, market_imp_val: 400000, acres: 1 },
  { apn: '2', formatted_apn: '10-0002', is_primary: false, included: true, market_land_val: 50000, market_imp_val: 150000, acres: 0.5 },
  { apn: '3', formatted_apn: '10-0003', is_primary: false, included: false, market_land_val: 999999, market_imp_val: 1, acres: 9 },
];

const leases: LeaseRow[] = [
  { tenant_name: 'A', monthly_rent: 5000, lease_start_date: '2025-01-01', is_active: true },
  { tenant_name: 'B', monthly_rent: 4500, lease_start_date: '2025-01-01', is_active: true },
  { tenant_name: 'Old', monthly_rent: 7777, lease_start_date: '2020-01-01', is_active: false },
];

describe('buildBriefModel', () => {
  it('carries where each figure came from, so the printed brief can be stood behind', () => {
    const record = { documents: [{ name: 'OM.pdf', type: 'offering_memorandum' }], figures: [{ key: 'purchasePrice', label: 'Purchase price', value: 1_000_000, source: 'document', how: 'The list price', documentType: 'offering_memorandum' }] };
    const m = buildBriefModel(mkDeal({ ...baseInputs, intakeRecord: record }), [], []);
    const price = m.figureSources.find((r) => r.label === 'Purchase price')!;
    expect(price.source).toBe('From OM.pdf');
    expect(m.figureSources.every((r) => r.source.length > 0)).toBe(true);
    // a figure with nothing recorded is the owner's own entry, never left unattributed
    expect(m.figureSources.find((r) => r.label === 'Interest rate')!.source).toBe('Your entry for this property');
  });

  it('lists every included parcel and sums only those', () => {
    const m = buildBriefModel(mkDeal(baseInputs), leases, parcels);
    expect(m.parcels).toHaveLength(2);
    expect(m.parcels[0].isPrimary).toBe(true);
    expect(m.parcelTotals.assessed).toBe(700000);
    expect(m.parcelTotals.acres).toBeCloseTo(1.5, 4);
  });

  it('sums the active rent roll only and reports variance to underwritten rent', () => {
    const m = buildBriefModel(mkDeal(baseInputs), leases, parcels);
    expect(m.rentRoll).toHaveLength(2);
    expect(m.rentRollMonthly).toBe(9500);
    expect(m.rentVarianceMonthly).toBeCloseTo(9500 - m.monthlyRent, 6);
  });

  it.each(['out_of_pocket', 'roll_into_loan'] as const)('matches the engine for capital structure (%s)', (mode) => {
    const deal = mkDeal({ ...baseInputs, rehabFinancingMode: mode });
    const m = buildBriefModel(deal, leases, parcels);
    const e: any = computeDealMetrics(deal);
    expect(m.downPaymentAmt).toBe(e.downPaymentAmount);
    expect(m.loanAmt).toBe(e.loanAmount);
    expect(m.equity).toBe(e.initialCashInvested);
    expect(m.noi).toBe(e.noi);
    expect(m.irr).toBe(e.irr);
    expect(m.dscr).toBe(e.dscr);
    expect(m.downPaymentPct).toBeCloseTo(30, 6);
    expect(m.totalFinancedBasis).toBe(mode === 'roll_into_loan' ? 1_100_000 : 1_000_000);
  });

  it('never substitutes a 25% down payment or a made-up lease date when facts are missing', () => {
    const m = buildBriefModel(mkDeal({ purchasePrice: 500000, monthlyRent: 4000 }), [], []);
    expect(m.downPaymentPct).toBe(0);
    expect(m.downPaymentAmt).toBe(0);
    expect(m.rentRoll).toHaveLength(0);
    expect(m.rentVarianceMonthly).toBeNull();
    expect(m.parcels).toHaveLength(0);
    expect(m.underwritingLeases).toHaveLength(0);
    expect(m.gisBadge).toBe('Manual Underwriting Record');
    expect(m.principalPerMonth + m.interestPerMonth).toBeGreaterThanOrEqual(0);
  });

  it('falls back to inputs.parcels when the parcels table has no rows', () => {
    const m = buildBriefModel(
      mkDeal({ ...baseInputs, parcels: [{ apn: 'X1', marketLandValue: 10, marketImprovementValue: 20, acres: 1 }, { apn: 'X2', marketLandValue: 5, marketImprovementValue: 5, acres: 1 }] }),
      [], [],
    );
    expect(m.parcels).toHaveLength(2);
    expect(m.parcelTotals.assessed).toBe(40);
  });
});

describe('DealBrief render', () => {
  it('prints every included parcel, every active lease and the engine down payment', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DealBrief } = await import('../../components/brief/DealBrief');
    const m = buildBriefModel(mkDeal(baseInputs), leases, parcels);
    const html = renderToStaticMarkup(React.createElement(DealBrief, { model: m, monteCarlo: null }));
    expect(html).toContain('10-0001');
    expect(html).toContain('10-0002');
    expect(html).not.toContain('10-0003');
    expect(html).toContain('2-Parcel Package');
    expect(html).toContain('Total in-place rent roll');
    expect(html).not.toContain('Old');
    expect(html).toContain('$300,000 Down (30%)');
    expect(html).toContain('Not provided');
    // Methodology is fine print at the end, not a column in the assumptions
    expect(html).not.toContain('How Reached');
    expect(html).toContain('Methodology, Diligence Provenance');
  });

  it('explains the Monte Carlo: period, what was varied and by how many standard deviations', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DealBrief } = await import('../../components/brief/DealBrief');
    const { runMonteCarlo } = await import('../engine');
    const deal = mkDeal(baseInputs);
    const m = buildBriefModel(deal, leases, parcels);
    const mc = runMonteCarlo('commercial', m.monteCarloInputs, { runs: 200, seed: 7 });
    const html = renderToStaticMarkup(React.createElement(DealBrief, { model: m, monteCarlo: mc }));
    expect(html).toContain('What the simulation varied');
    expect(html).toContain('σ = 1.5 pts');
    expect(html).toContain('Net profit in dollars over the 10-year hold');
    expect(html).toContain('Break even $0');
    expect(html).toContain('Exit cap rate');
    expect(html).toContain('Tenant default');
    expect(mc.telemetry.volatility.holdYears).toBe(10);
  });
});

describe('stub first year', () => {
  it('reports the real monthly rent, not the stub year divided by 12', () => {
    const deal = mkDeal({
      purchasePrice: 300000, downPaymentPercent: 100, interestRate: 0, closingCosts: 12000, vacancyRate: 1, expenseRatio: 1, exitYear: 15,
      closingDate: '2025-07-15', prorateFirstYear: true, firstYearMonths: 6,
      leases: [{ tenantName: 'Tenant', monthlyRent: 2600, leaseType: 'NNN', leaseStartDate: '2025-07-15', leaseEndDate: '2036-07-31', escalationRate: 0 }],
    });
    const m = buildBriefModel(deal, [], []);
    expect(m.isProrated).toBe(true);
    expect(Number(m.p0.grossPotentialIncome)).toBeLessThan(m.annualRent);
    expect(m.monthlyRent).toBeGreaterThan(2500);
    expect(m.monthlyRent).toBeLessThan(2750);
    const roll = buildBriefModel(deal, [{ tenant_name: 'Tenant', monthly_rent: 2600, is_active: true }], []);
    expect(roll.warnings.some((w) => w.title === 'Rent Roll Differs From Underwriting')).toBe(false);
  });
});
