import { describe, expect, it } from 'vitest';
import { getDealStage, getStageLens, resolveTab } from './stageLens';

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
      expect(lens.tabs).toEqual(['overview', 'proforma', 'property', 'debt', 'diligence', 'sensitivity']);
      expect(lens.tabs).not.toContain('performance');
      expect(lens.tabs).not.toContain('operate');
      expect(lens.defaultTab).toBe('overview');
    }
  });

  it('owned deals open on overview, end with performance and drop diligence', () => {
    const lens = getStageLens(deal('owned'));
    expect(lens.showOperations).toBe(true);
    expect(lens.tabs.slice(0, 3)).toEqual(['overview', 'proforma', 'operate']);
    expect(lens.tabs[lens.tabs.length - 1]).toBe('performance');
    expect(lens.tabs).not.toContain('diligence');
    expect(lens.tabs).toEqual(expect.arrayContaining(['debt', 'sensitivity', 'proforma']));
    expect(lens.defaultTab).toBe('overview');
  });

  it('falls back to the stage default for tabs the stage does not show', () => {
    const owned = getStageLens(deal('owned'));
    const prospect = getStageLens(deal('prospect'));
    expect(resolveTab(owned, undefined)).toBe('overview');
    expect(resolveTab(owned, 'diligence')).toBe('overview');
    expect(resolveTab(owned, 'tax')).toBe('overview');
    expect(resolveTab(owned, 'performance')).toBe('performance');
    expect(resolveTab(owned, 'debt')).toBe('debt');
    expect(resolveTab(prospect, 'operate')).toBe('overview');
    expect(resolveTab(prospect, 'performance')).toBe('overview');
    expect(resolveTab(prospect, 'tax')).toBe('overview');
  });
});
