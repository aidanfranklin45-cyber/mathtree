import { describe, it, expect } from 'vitest';
import { buildBriefModel, type LeaseRow, type ParcelRow } from './buildBriefModel';
import { computeDealMetrics } from '../engine/compute';

const baseInputs = {
  purchasePrice: 1_000_000, downPaymentPercent: 30, interestRate: 6.5, loanTerm: 25,
  vacancyRate: 5, expenseRatio: 20, rentGrowth: 3, closingCosts: 20000, rehabCosts: 80000, exitYear: 10,
  monthlyRent: 9000,
};

const mkDeal = (inputs: Record<string, any>): any => ({
  id: 'fixture', title: 'Fixture Deal', asset_class: 'commercial', status: 'owned',
  purchase_price: 1_000_000, inputs,
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
  });
});
