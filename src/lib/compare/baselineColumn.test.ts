import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpdateBaselineModal } from '../../components/compare/UpdateBaselineModal';
import { buildBaselineDraft } from '../baselines/core';
import { extractComparisonSummary, mergeIdenticalColumns, getPresetOverrides, columnFingerprint, ComparisonColumn } from './compareTypes';
import { dealFromBaseline, baselineHeading, baselineEngineDriftNote, dealWithScenario } from './baselineColumn';

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

describe('updating the baseline from a scenario', () => {
  it('captures exactly what the column showed, and the new baseline round-trips through the baseline column', () => {
    const deal = owned(acquisitionInputs);
    for (const type of ['bull', 'bear'] as const) {
      const overrides = getPresetOverrides(type, deal.inputs);
      const shown = extractComparisonSummary(deal, overrides).summary;
      const adopted = dealWithScenario(deal, overrides);
      const captured = extractComparisonSummary(adopted, {}).summary;
      expect(captured.irr).toBeCloseTo(shown.irr, 6);
      expect(captured.noi).toBeCloseTo(shown.noi, 6);
      expect(captured.cashFlowYear1).toBeCloseTo(shown.cashFlowYear1, 6);

      // record it as the baseline, then read it back the way the compare page does
      const back = extractComparisonSummary(dealFromBaseline(deal, rowFrom(adopted)), {}).summary;
      expect(back.irr).toBeCloseTo(shown.irr, 6);
      expect(back.noi).toBeCloseTo(shown.noi, 6);
    }
  });

  it('drops undefined overrides instead of blanking fields', () => {
    const deal = owned(acquisitionInputs);
    const next = dealWithScenario(deal, { monthlyRent: undefined, vacancyRate: 9 } as any);
    expect(next.inputs.monthlyRent).toBe(2000);
    expect(next.inputs.vacancyRate).toBe(9);
    expect(deal.inputs.vacancyRate).toBe(5); // original untouched
  });
});

describe('UpdateBaselineModal', () => {
  const render = async (props: Record<string, any>) => {
    return renderToStaticMarkup(React.createElement(UpdateBaselineModal, { isOpen: true, onClose: () => {}, dealTitle: 'Rental', busy: false, error: null, onConfirm: () => {}, ...props } as any));
  };

  it('offers the live model and scenarios, disables one that equals the current baseline, and says history is kept', async () => {
    const deal = owned(acquisitionInputs);
    const live = col(deal, 'live');
    const bull = { ...col(owned({ ...acquisitionInputs, monthlyRent: 2400, grossRentAnnual: 28800 }), 'bull'), scenarioName: 'Bull Case' };
    const html = await render({ candidates: [live, bull], baselineFingerprint: columnFingerprint(live), baselineCapturedAt: '2025-03-04T12:00:00Z', baselineIrr: 9.5 });
    expect(html).toContain('Update acquisition baseline');
    expect(html).toContain('Same results as the current baseline');
    expect(html).toContain('kept in history');
    expect(html).toContain('Mar 4, 2025');
    expect(html).toContain('Set as new baseline');
    expect(html).toContain('Bull Case');
  });

  it('with no baseline yet, offers to record one; busy and error states render', async () => {
    const live = col(owned(acquisitionInputs), 'live');
    const html = await render({ candidates: [live], baselineFingerprint: null, baselineCapturedAt: null, baselineIrr: null, busy: true, error: 'The baseline could not be saved' });
    expect(html).toContain('Record acquisition baseline');
    expect(html).toContain('Saving');
    expect(html).toContain('could not be saved');
    expect(html).not.toContain('kept in history');
  });

  it('renders nothing when closed', async () => {
    expect(await render({ isOpen: false, candidates: [], baselineFingerprint: null, baselineCapturedAt: null, baselineIrr: null })).toBe('');
  });
});
