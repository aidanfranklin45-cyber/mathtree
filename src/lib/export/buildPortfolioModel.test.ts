import { describe, it, expect } from 'vitest';
import { buildPortfolioModel, type PortfolioParcelRow } from './buildPortfolioModel';
import { computePortfolioKpis } from '../portfolio/kpis';
import { computeDealMetrics } from '../engine/compute';
import { resolvePointInTimeDealMetrics } from '../math/pointInTime';

const inputs = (over: Record<string, any> = {}) => ({
  purchasePrice: 1_000_000, downPaymentPercent: 30, interestRate: 6.5, loanTerm: 25,
  monthlyRent: 9000, vacancyRate: 5, expenseRatio: 20, rentGrowth: 3, closingCosts: 20000, exitYear: 10, ...over,
});
const mk = (id: string, status: string, asset: string, over: Record<string, any> = {}, price = 1_000_000): any => ({
  id, title: `Deal ${id}`, location: `${id} Main St`, status, asset_class: asset, purchase_price: price,
  inputs: inputs({ purchasePrice: price, ...over }),
});

const deals = [
  mk('own1', 'owned', 'commercial', { closingDate: '2024-03-01' }),
  mk('own2', 'owned', 'residential', { closingDate: '2025-06-01', monthlyRent: 2500 }, 400_000),
  mk('pipe1', 'prospect', 'commercial', {}, 2_000_000),
  mk('pipe2', 'prospect', 'storage', { monthlyRent: 7000 }, 900_000),
];
const parcels: PortfolioParcelRow[] = [
  { deal_id: 'own1', apn: 'A1', formatted_apn: '10-0001', is_primary: true, included: true, market_land_val: 100000, market_imp_val: 400000, acres: 1 },
  { deal_id: 'own1', apn: 'A2', formatted_apn: '10-0002', is_primary: false, included: true, market_land_val: 50000, market_imp_val: 150000, acres: 0.5 },
  { deal_id: 'pipe1', apn: 'B1', formatted_apn: '20-0001', is_primary: true, included: true, market_land_val: 10, market_imp_val: 20, acres: 2 },
];
const now = new Date('2026-09-30T12:00:00Z');

describe('buildPortfolioModel', () => {
  it('headline tiles equal the dashboard KPI function and an independent point-in-time sum', () => {
    const m = buildPortfolioModel(deals, parcels, { now });
    expect(m.kpis).toEqual(computePortfolioKpis(deals, now));
    const owned = deals.filter((d) => d.status === 'owned').map((d) => resolvePointInTimeDealMetrics(d, now));
    expect(m.kpis.ownedVal).toBe(Math.round(owned.reduce((s, p) => s + p.currentVal, 0)));
    expect(m.kpis.ownedCashflow).toBe(Math.round(owned.reduce((s, p) => s + p.currentCashFlow, 0)));
    expect(m.kpis.pipelineCount).toBe(2);
    expect(m.kpis.pipelineVal).toBe(2_900_000);
  });

  it('keeps owned and pipeline rows on engine values and reconciles sector totals to total volume', () => {
    const m = buildPortfolioModel(deals, parcels, { now });
    expect(m.owned).toHaveLength(2);
    expect(m.pipeline).toHaveLength(2);
    const p1 = m.pipeline.find((r) => r.id === 'pipe1')!;
    const e: any = computeDealMetrics(deals[2]);
    expect(p1.equity).toBe(e.initialCashInvested);
    expect(p1.debt).toBe(e.loanAmount);
    expect(p1.irr).toBe(e.irr);
    expect(p1.cashFlow).toBe(e.year1Cashflow);
    const sectorSum = m.sectors.reduce((s, x) => s + x.value, 0);
    expect(Math.abs(sectorSum - m.totalVolume)).toBeLessThan(2);
    expect(m.totalDeals).toBe(4);
  });

  it('reports parcels per deal and flags the unlinked ones instead of inventing an APN or county', () => {
    const m = buildPortfolioModel(deals, parcels, { now });
    const own1 = m.owned.find((r) => r.id === 'own1')!;
    expect(own1.apn).toBe('10-0001 (+1)');
    expect(own1.assessed).toBe(700000);
    expect(own1.acres).toBeCloseTo(1.5, 4);
    const own2 = m.owned.find((r) => r.id === 'own2')!;
    expect(own2.apn).toBeNull();
    expect(own2.assessed).toBeNull();
    expect(m.flags.some((f) => f.title === 'Unlinked county parcels' && f.description.includes('2 of 4'))).toBe(true);
    // Footprint acres must only reflect owned holdings (1.5 ac from own1, not pipe1's 2.0 ac)
    expect(m.footprintAcres).toBeCloseTo(1.5, 4);
  });

  it('prints investor name only when provided, never a made-up one', () => {
    const m = buildPortfolioModel(deals, parcels, { now });
    expect(m.investorName).toBeNull();
    expect(m.hurdleRate).toBeNull();
  });

  it('correctly tags property status and defaults missing status to prospect', () => {
    const mixedDeals = [
      mk('d1', 'owned', 'commercial'),
      mk('d2', 'prospect', 'residential'),
      { ...mk('d3', '', 'storage'), status: undefined },
    ];
    const m = buildPortfolioModel(mixedDeals, [], { now });
    expect(m.owned).toHaveLength(1);
    expect(m.pipeline).toHaveLength(2);
    expect(m.owned[0].isOwned).toBe(true);
    expect(m.owned[0].status).toBe('owned');
    expect(m.owned[0].statusLabel).toBe('Owned Asset');
    expect(m.pipeline[0].isOwned).toBe(false);
    expect(m.pipeline[0].status).toBe('prospect');
    expect(m.pipeline[1].isOwned).toBe(false);
    expect(m.pipeline[1].status).toBe('prospect');
  });

  it('builds an aggregated portfolio pro-forma for owned operating holdings across the full holding period', () => {
    const m = buildPortfolioModel(deals, parcels, { now });
    expect(m.holdYears).toBe(10);
    expect(m.ownedProForma).toHaveLength(10);
    const yr1 = m.ownedProForma[0];
    expect(yr1.year).toBe(1);
    expect(yr1.calendarYear).toBeGreaterThanOrEqual(2024);
    expect(yr1.propertyValue).toBe(1_400_000); // 1,000,000 (own1) + 400,000 (own2)
    expect(yr1.grossIncome).toBeGreaterThan(0);
    expect(yr1.netOperatingIncome).toBeGreaterThan(0);
    expect(yr1.netCashFlow).toBeDefined();
    expect(yr1.endingEquity).toBeGreaterThan(0);
    const yr10 = m.ownedProForma[9];
    expect(yr10.year).toBe(10);
    expect(yr10.propertyValue).toBeGreaterThan(yr1.propertyValue);
  });

  it('detects staggered exits, populates dispositions, exit notes, and audit disclosures', () => {
    const staggeredDeals = [
      mk('own1', 'owned', 'commercial', { closingDate: '2024-03-01', exitYear: 5 }),
      mk('own2', 'owned', 'residential', { closingDate: '2024-03-01', exitYear: 10 }, 500_000),
    ];
    const m = buildPortfolioModel(staggeredDeals, [], { now });
    expect(m.holdYears).toBe(10);
    expect(m.ownedProForma).toHaveLength(10);
    expect(m.dispositions).toHaveLength(1);
    expect(m.dispositions[0].dealId).toBe('own1');
    expect(m.dispositions[0].exitYear).toBe(5);
    expect(m.dispositions[0].equityRealized).toBeGreaterThan(0);
    // Year 5 exit note
    expect(m.ownedProForma[4].exitNote).toContain('Exit: Deal own1');
    // Year 6 post-exit note
    expect(m.ownedProForma[5].exitNote).toContain('Post-exit in-place portfolio');
    // Year 5 book equity includes both; Year 6 reflects own2 only after capital proceeds realization
    expect(m.ownedProForma[4].propertyValue).toBeGreaterThan(m.ownedProForma[5].propertyValue);
    expect(m.flags.some((f) => f.title.includes('Scheduled Asset Disposition & Capital Realization'))).toBe(true);
  });
});

describe('PortfolioBrief render', () => {
  it('prints every deal, the engine tiles and Not provided for missing facts', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { PortfolioBrief } = await import('../../components/brief/PortfolioBrief');
    const m = buildPortfolioModel(deals, parcels, { now, investorName: 'Pat Investor', companyName: 'Pat Capital', hurdleRate: 9 });
    const html = renderToStaticMarkup(React.createElement(PortfolioBrief, { model: m }));
    for (const id of ['own1', 'own2', 'pipe1', 'pipe2']) expect(html).toContain(`Deal ${id}`);
    expect(html).toContain('10-0001 (+1)');
    expect(html).toContain('Pat Capital');
    expect(html).toContain('9.0% / yr');
    expect(html).toContain('Pending Link');
    expect(html).toContain('Not provided');
    expect(html).toContain('Unlinked county parcels');
    expect(html).not.toContain('Yakima');

    // Clear ownership status indicators
    expect(html).toContain('🏛️ Owned');
    expect(html).toContain('🏛️ Owned Asset');
    expect(html).toContain('🎯 Prospect');
    expect(html).toContain('🎯 Pipeline Prospect');
    expect(html).toContain('Portfolio Status');

    // Portfolio level pro-forma
    expect(html).toContain('Owned Portfolio 10-Year Operating Pro-Forma');
    expect(html).toContain('Full 10-Year Holding Period Performance Forecast');
    expect(html).toContain('Portfolio NOI');
  });

  it('renders capital realization disclosures when staggered property exits are present', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { PortfolioBrief } = await import('../../components/brief/PortfolioBrief');
    const staggeredDeals = [
      mk('own1', 'owned', 'commercial', { closingDate: '2024-03-01', exitYear: 5 }),
      mk('own2', 'owned', 'residential', { closingDate: '2024-03-01', exitYear: 10 }, 500_000),
    ];
    const m = buildPortfolioModel(staggeredDeals, [], { now });
    const html = renderToStaticMarkup(React.createElement(PortfolioBrief, { model: m }));
    expect(html).toContain('Capital Realization &amp; Staggered Disposition Disclosures');
    expect(html).toContain('Yr 5');
    expect(html).toContain('Scheduled investment exit');
    expect(html).toContain('Capital Realization &amp; Staggered Exits');
  });
});
