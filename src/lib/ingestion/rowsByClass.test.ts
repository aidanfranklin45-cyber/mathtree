import { describe, expect, it } from 'vitest';
import { labelFor, ROW_SPECS, rowApplies } from './worksheet';

describe('rows belong to the classes that use them', () => {
  it('only single-family is valued by appreciation, the rest by exit cap', () => {
    expect(rowApplies('appreciationRate', 'single-family')).toBe(true);
    expect(rowApplies('targetCapRate', 'single-family')).toBe(false);
    for (const a of ['multi-unit', 'commercial', 'storage']) {
      expect(rowApplies('appreciationRate', a)).toBe(false);
      expect(rowApplies('targetCapRate', a)).toBe(true);
    }
  });
  it('units are for apartments and storage; payroll and marketing for storage', () => {
    expect(rowApplies('unitCount', 'commercial')).toBe(false);
    expect(rowApplies('unitCount', 'single-family')).toBe(false);
    expect(rowApplies('unitCount', 'storage')).toBe(true);
    expect(rowApplies('payrollMarketingPercent', 'multi-unit')).toBe(false);
    expect(rowApplies('payrollMarketingPercent', 'storage')).toBe(true);
  });
  it('an unknown class shows everything rather than hiding a question', () => {
    expect(rowApplies('unitCount', null)).toBe(true);
  });
  it('appreciation has a row, so it is sourced and asked like every other figure', () => {
    expect(ROW_SPECS.some((r) => r.key === 'appreciationRate')).toBe(true);
  });
  it('names the figure the way the class does', () => {
    expect(labelFor('squareFeet', 'Square feet', 'storage')).toBe('Rentable area');
    expect(labelFor('squareFeet', 'Square feet', 'commercial')).toBe('Gross leasable area');
    expect(labelFor('unitCount', 'Units', 'storage')).toBe('Storage units');
  });
});

import { liveAssumption } from './liveAssumptions';

describe('a blank field that the profile fills is said out loud', () => {
  const house = { asset_class: 'single-family', purchase_price: 415000, inputs: {} };
  it('names the figure that will apply and that it is the profile\'s', () => {
    const a = liveAssumption(house, 'appreciationRate');
    expect(a?.value).toBeTypeOf('number');
    expect(a?.text).toMatch(/Source:/);
    expect(a?.text).toContain(`${a?.value}%`);
  });
  it('says nothing once the property states its own figure', () => {
    expect(liveAssumption({ ...house, inputs: { appreciationRate: 2 } }, 'appreciationRate')).toBeNull();
  });
  it('does not speak for the expense ratio, which needs evidence of its own', () => {
    expect(liveAssumption(house, 'expenseRatio')).toBeNull();
  });
});

import { isStartingPointReason } from '@engine/underwritingAssumptions';

describe('a starting point is told apart from the owner\'s own setting', () => {
  it('knows the labels the starting points carry', () => {
    expect(isStartingPointReason('Common underwriting convention')).toBe(true);
    expect(isStartingPointReason('Set near market cap rates for the type; adjust per property')).toBe(true);
  });
  it('does not mistake the owner\'s reason for one', () => {
    expect(isStartingPointReason('My lender requires 1.30 coverage')).toBe(false);
    expect(isStartingPointReason(undefined)).toBe(false);
  });
  it('labels the area of an apartment building as rentable', () => {
    expect(labelFor('squareFeet', 'Square feet', 'multi-unit')).toBe('Rentable area');
  });
});
