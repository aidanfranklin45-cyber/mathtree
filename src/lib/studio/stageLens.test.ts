import { describe, expect, it } from 'vitest';
import { getDealStage, getStageLens, resolveTab, summarizeOperate } from './stageLens';

const deal = (status: string, dealStage?: string) => ({ status, inputs: dealStage ? { dealStage } : {} }) as any;

describe('stage lenses', () => {
  it('reads the stage from status and inputs.dealStage', () => {
    expect(getDealStage(deal('owned', 'screening'))).toBe('owned');
    expect(getDealStage(deal('prospect', 'due_diligence'))).toBe('due_diligence');
    expect(getDealStage(deal('prospect'))).toBe('screening');
    expect(getDealStage(deal('prospect', 'nonsense'))).toBe('screening');
    expect(getDealStage(deal('prospect', 'owned'))).toBe('screening');
  });

  it('prospect stages show underwriting tabs and no operations', () => {
    for (const s of ['screening', 'loi', 'due_diligence', 'closing', 'disposition']) {
      const lens = getStageLens(deal('prospect', s));
      expect(lens.showOperations).toBe(false);
      expect(lens.tabs).toEqual(['overview', 'proforma', 'property', 'debt', 'diligence', 'sensitivity', 'tax']);
      expect(lens.tabs).not.toContain('performance');
      expect(lens.tabs).not.toContain('operate');
      expect(lens.defaultTab).toBe('overview');
    }
  });

  it('owned deals lead with performance and operate and drop diligence', () => {
    const lens = getStageLens(deal('owned'));
    expect(lens.showOperations).toBe(true);
    expect(lens.tabs.slice(0, 2)).toEqual(['performance', 'operate']);
    expect(lens.tabs).not.toContain('diligence');
    expect(lens.tabs).toEqual(expect.arrayContaining(['debt', 'sensitivity', 'tax', 'proforma']));
    expect(lens.defaultTab).toBe('performance');
  });

  it('falls back to the stage default for tabs the stage does not show', () => {
    const owned = getStageLens(deal('owned'));
    const prospect = getStageLens(deal('prospect'));
    expect(resolveTab(owned, undefined)).toBe('performance');
    expect(resolveTab(owned, 'diligence')).toBe('performance');
    expect(resolveTab(owned, 'debt')).toBe('debt');
    expect(resolveTab(prospect, 'operate')).toBe('overview');
    expect(resolveTab(prospect, 'performance')).toBe('overview');
    expect(resolveTab(prospect, 'tax')).toBe('tax');
  });

  it('summarizes leases and the latest recorded months', () => {
    const s = summarizeOperate(
      [{ monthly_rent: 1000, is_active: true }, { monthly_rent: 500, is_active: false }, { monthly_rent: 250, is_active: null }],
      [
        { period_month: '2026-07-01', amount_due: 1000, amount_paid: 1000 },
        { period_month: '2026-09-01', amount_due: 1000, amount_paid: 0 },
        { period_month: '2026-08-01', amount_due: 1000, amount_paid: 1000 },
        { period_month: '2026-10-01', amount_due: 1000, amount_paid: null },
        { period_month: '2026-10-01', amount_due: 200, amount_paid: 200 },
      ],
    );
    expect(s.activeLeases).toBe(2);
    expect(s.monthlyContractRent).toBe(1250);
    expect(s.recent.map((r) => r.month)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(s.recent[0]).toEqual({ month: '2026-10', due: 1200, paid: 200 });
  });
});
