import { describe, it, expect } from 'vitest';
import { buildBaselineDraft } from '../baselines/core';
import { extractComparisonSummary, mergeIdenticalColumns, ComparisonColumn } from './compareTypes';
import { dealFromBaseline, baselineHeading, baselineEngineDriftNote } from './baselineColumn';

const acquisitionInputs = {
  purchasePrice: 400000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 25, closingCosts: 5000,
  monthlyRent: 2000, grossRentAnnual: 24000, vacancyRate: 5, expenseRatio: 20, rentGrowth: 3, exitYear: 10,
  assessorData: { owner: 'Someone' }, parcels: [{ apn: '1' }],
};
const owned = (inputs: Record<string, any>): any => ({
  id: 'own1', title: 'Rental', asset_class: 'commercial', status: 'owned', purchase_price: 400000, inputs,
});
const col = (deal: any, type: any): ComparisonColumn => {
  const { metrics, summary } = extractComparisonSummary(deal, {});
  return { id: `${type}-${deal.id}`, dealId: deal.id, dealTitle: 'Rental', assetClass: 'commercial', status: 'owned', location: '', scenarioName: type, scenarioType: type, overrides: {}, deal, metrics, summary, isBenchmark: type === 'live' };
};
const rowFrom = (deal: any) => ({ ...buildBaselineDraft(deal, 'u1'), id: 'b1', captured_at: '2025-03-04T12:00:00Z' });

describe('real acquisition baseline (owned deals)', () => {
  it('re-runs the frozen acquisition inputs, so it differs from live once the owner changed something', () => {
    const atAcquisition = owned(acquisitionInputs);
    const row = rowFrom(atAcquisition);
    const live = owned({ ...acquisitionInputs, monthlyRent: 2600, grossRentAnnual: 31200 }); // rent was raised since buying
    const baseline = col(dealFromBaseline(live, row), 'baseline');
    const liveCol = col(live, 'live');
    const original = extractComparisonSummary(atAcquisition, {}).summary;

    expect(baseline.summary.noi).toBeCloseTo(original.noi, 2);          // baseline = what was underwritten at acquisition
    expect(baseline.summary.irr).toBeCloseTo(original.irr, 2);
    expect(liveCol.summary.noi).toBeGreaterThan(baseline.summary.noi);  // live reflects the raise
    expect(liveCol.summary.irr).toBeGreaterThan(baseline.summary.irr);
    const merged = mergeIdenticalColumns([liveCol, baseline]);
    expect(merged.columns).toHaveLength(2);                              // different results, so both stay
  });

  it('merges into the live model when nothing has changed since acquisition', () => {
    const live = owned(acquisitionInputs);
    const row = rowFrom(live);
    const merged = mergeIdenticalColumns([col(live, 'live'), col(dealFromBaseline(live, row), 'baseline')]);
    expect(merged.columns).toHaveLength(1);
    expect(merged.columns[0].scenarioName).toBe('Live Model = Acquisition Baseline');
  });

  it('builds the acquisition deal from the snapshot: price from the record, no parcels or assessor blobs', () => {
    const live = owned({ ...acquisitionInputs, purchasePrice: 999 });
    const row = { ...rowFrom(owned(acquisitionInputs)), purchase_price: 400000 };
    const d = dealFromBaseline({ ...live, purchase_price: 999 }, row);
    expect(d.id).toBe('own1');
    expect(d.purchase_price).toBe(400000);
    expect(d.inputs.purchasePrice).toBe(400000);
    expect(d.inputs.parcels).toEqual([]);
    expect(d.inputs.assessorData).toEqual({});
  });

  it('labels the capture date and flags an engine change instead of letting the two figures disagree silently', () => {
    expect(baselineHeading({ captured_at: '2025-03-04T12:00:00Z' })).toBe('Acquisition Baseline (Mar 4, 2025)');
    expect(baselineHeading({ captured_at: 'not a date' })).toBe('Acquisition Baseline');
    expect(baselineEngineDriftNote({ projected_irr: 12.34 }, 12.36)).toBeNull();
    expect(baselineEngineDriftNote({ projected_irr: null }, 12)).toBeNull();
    const note = baselineEngineDriftNote({ projected_irr: 10 }, 12.5);
    expect(note).toContain('12.5%');
    expect(note).toContain('10.0%');
  });
});
