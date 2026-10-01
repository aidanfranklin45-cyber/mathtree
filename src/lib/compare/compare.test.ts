import { describe, it, expect } from 'vitest';
import {
  extractComparisonSummary,
  getPresetOverrides,
  evaluateWinners,
  ComparisonColumn,
  dealScope,
  filterDealsByScope,
  countDealsByScope,
  resolveInitialScope,
} from './compareTypes';
import { BENCHMARK_DEAL } from '../supabase/client';
import { mapSupabaseDeal } from '../../stores/useDealStore';

describe('Project Comparison Logic & Metrics', () => {
  const benchmarkDeal = mapSupabaseDeal(BENCHMARK_DEAL);

  it('extracts complete comparison summary with pure compute-on-the-fly math', () => {
    const { metrics, summary } = extractComparisonSummary(benchmarkDeal);

    expect(metrics).toBeDefined();
    expect(summary).toBeDefined();
    expect(summary.purchasePrice).toBeGreaterThan(0);
    expect(summary.initialCash).toBeGreaterThan(0);
    expect(summary.loanAmount).toBeGreaterThan(0);
    expect(summary.noi).toBeGreaterThan(0);
    expect(summary.cashFlowYear1).toBeGreaterThan(0);
    expect(summary.irr).toBeGreaterThan(0);
    expect(summary.equityMultiple).toBeGreaterThan(1);
    expect(summary.totalWealthCreated).toBeGreaterThan(0);
  });

  it('computes bull and bear case preset overrides correctly', () => {
    const inputs = {
      grossRentAnnual: 100000,
      monthlyRent: 8333,
      vacancyRate: 5,
      interestRate: 6.5,
    };

    const bull = getPresetOverrides('bull', inputs);
    expect(bull.grossRentAnnual).toBe(108000); // +8% rent
    expect(bull.vacancyRate).toBe(3.5); // -1.5% vacancy

    const bear = getPresetOverrides('bear', inputs);
    expect(bear.grossRentAnnual).toBe(92000); // -8% rent
    expect(bear.vacancyRate).toBe(8.0); // +3% vacancy
    expect(bear.interestRate).toBe(7.0); // +50bps rate
  });

  it('accurately identifies winning columns across IRR, cash flow, multiple, and DSCR', () => {
    const baseSummary = extractComparisonSummary(benchmarkDeal).summary;

    const col1: ComparisonColumn = {
      id: 'col-1',
      dealId: 'deal-1',
      dealTitle: 'Property Alpha',
      assetClass: 'commercial',
      status: 'owned',
      location: 'Yakima, WA',
      scenarioName: 'Live Model',
      scenarioType: 'live',
      deal: benchmarkDeal,
      metrics: {} as any,
      summary: {
        ...baseSummary,
        purchasePrice: 1500000,
        irr: 18.5,
        cashFlowYear1: 45000,
        equityMultiple: 2.2,
        dscr: 1.45,
        noi: 120000,
      },
    };

    const col2: ComparisonColumn = {
      id: 'col-2',
      dealId: 'deal-2',
      dealTitle: 'Property Beta',
      assetClass: 'multi-unit',
      status: 'prospect',
      location: 'Yakima, WA',
      scenarioName: 'Bull Case',
      scenarioType: 'bull',
      deal: benchmarkDeal,
      metrics: {} as any,
      summary: {
        ...baseSummary,
        purchasePrice: 1200000, // Lowest basis
        irr: 22.0, // Highest IRR
        cashFlowYear1: 38000,
        equityMultiple: 2.5, // Highest multiple
        dscr: 1.35,
        noi: 100000,
      },
    };

    const col3: ComparisonColumn = {
      id: 'col-3',
      dealId: 'deal-3',
      dealTitle: 'Property Gamma',
      assetClass: 'single-family',
      status: 'owned',
      location: 'Yakima, WA',
      scenarioName: 'Live Model',
      scenarioType: 'live',
      deal: benchmarkDeal,
      metrics: {} as any,
      summary: {
        ...baseSummary,
        purchasePrice: 1800000,
        irr: 14.0,
        cashFlowYear1: 65000, // Highest cash flow
        equityMultiple: 1.9,
        dscr: 1.65, // Highest DSCR
        noi: 140000, // Highest NOI
      },
    };

    const winners = evaluateWinners([col1, col2, col3]);

    expect(winners.maxIrrId).toBe('col-2');
    expect(winners.maxCashFlowId).toBe('col-3');
    expect(winners.maxMultipleId).toBe('col-2');
    expect(winners.maxDscrId).toBe('col-3');
    expect(winners.maxNoiId).toBe('col-3');
    expect(winners.minPriceId).toBe('col-2');
  });
});

describe('Compare scope (pipeline / owned / all)', () => {
  const d = (id: string, status: string): any => ({ id, status });
  const deals = [d('p1', 'prospect'), d('p2', 'pipeline'), d('o1', 'owned'), d('o2', 'owned'), d('a1', 'archived')];

  it('classifies owned vs pipeline, with archived only under All', () => {
    expect(dealScope(d('x', 'owned'))).toBe('owned');
    expect(dealScope(d('x', 'prospect'))).toBe('pipeline');
    expect(dealScope(d('x', 'pipeline'))).toBe('pipeline');
    expect(dealScope(d('x', 'archived'))).toBe('archived');
    expect(filterDealsByScope(deals, 'pipeline').map((x) => x.id)).toEqual(['p1', 'p2']);
    expect(filterDealsByScope(deals, 'owned').map((x) => x.id)).toEqual(['o1', 'o2']);
    expect(filterDealsByScope(deals, 'all')).toHaveLength(5);
    expect(countDealsByScope(deals)).toEqual({ pipeline: 2, owned: 2, all: 5 });
  });

  it('opens on Pipeline by default, All when there are no prospective deals', () => {
    expect(resolveInitialScope(deals, null)).toBe('pipeline');
    expect(resolveInitialScope([d('o1', 'owned')], null)).toBe('all');
    expect(resolveInitialScope(deals, 'owned')).toBe('owned');
    expect(resolveInitialScope(deals, 'nonsense')).toBe('pipeline');
  });

  it('never hides a deal that a link asked for', () => {
    // a shared link to an owned deal opens on All, not on an empty-looking Pipeline view
    expect(resolveInitialScope(deals, null, ['o1'])).toBe('all');
    expect(resolveInitialScope(deals, 'pipeline', ['p1', 'o2'])).toBe('all');
    expect(resolveInitialScope(deals, 'owned', ['o1'])).toBe('owned');
    expect(resolveInitialScope(deals, null, ['p1'])).toBe('pipeline');
  });
});
