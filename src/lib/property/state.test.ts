import { describe, it, expect } from 'vitest';
import { resolvePropertyState } from './state';
import type { PropertyFacts } from './types';

const asOf = new Date('2026-10-15T12:00:00');
const estimate = { value: 1_100_000, noi: 90_000, operatingExpenses: 30_000, debtService: 50_000, cashFlow: 40_000 };
const deal = (over: Record<string, any> = {}) => ({ id: 'd1', status: 'owned', is_demo: false, inputs: {}, ...over });
const lease = (over: Record<string, any> = {}) => ({ id: 'l1', deal_id: 'd1', unit_id: 'u1', monthly_rent: 10_000, lease_start_date: '2025-01-01', lease_end_date: '2030-01-01', term_type: 'fixed', is_active: true, ...over });
const pay = (period: string, over: Record<string, any> = {}) => ({ deal_id: 'd1', lease_id: 'l1', period_month: period, due_date: period, amount_due: 10_000, amount_paid: 10_000, status: 'paid', ...over });
const months = (from: number, n: number) => Array.from({ length: n }, (_, i) => { const m = from + i; return `${2025 + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}-01`; });
// Nov 2025 .. Oct 2026 = 12 elapsed months
const year = months(11, 12).map((p) => pay(p));
const facts = (over: Partial<PropertyFacts> = {}): PropertyFacts => ({ leases: [lease()], units: [{ id: 'u1', deal_id: 'd1' }, { id: 'u2', deal_id: 'd1' }], payments: year, ...over });

describe('resolvePropertyState', () => {
  it('owned deal: NOI and cash flow come from collected rent, labelled blended', () => {
    const s = resolvePropertyState({ deal: deal(), facts: facts(), asOf, estimate });
    expect(s.collected).toMatchObject({ months: 12, total: 120_000, annualised: 120_000 });
    expect(s.noi).toMatchObject({ value: 90_000, basis: 'blended' }); // 120k - 30k forecast expenses
    expect(s.cashFlow).toMatchObject({ value: 40_000, basis: 'blended' }); // 90k - 50k debt service
    expect(s.value.basis).toBe('estimated');
  });

  it('actual rent below forecast lowers NOI (the point of reading payments)', () => {
    const half = months(11, 12).map((p, i) => pay(p, i % 2 ? { status: 'overdue', amount_paid: null } : {}));
    const s = resolvePropertyState({ deal: deal(), facts: facts({ payments: half }), asOf, estimate });
    expect(s.collected?.annualised).toBe(60_000);
    expect(s.noi.value).toBe(30_000);
  });

  it('too little history, no payments, or no facts: forecast, labelled estimated, collected blank', () => {
    const few = resolvePropertyState({ deal: deal(), facts: facts({ payments: months(21, 2).map((p) => pay(p)) }), asOf, estimate });
    expect(few.collected?.annualised).toBeNull();
    expect(few.noi).toMatchObject({ value: 90_000, basis: 'estimated' });
    const none = resolvePropertyState({ deal: deal(), facts: facts({ payments: [] }), asOf, estimate });
    expect(none.collected).toBeNull();
    expect(none.noi.basis).toBe('estimated');
    expect(resolvePropertyState({ deal: deal(), facts: null, asOf, estimate }).collected).toBeNull();
  });

  it('demo deals never use actuals', () => {
    const s = resolvePropertyState({ deal: deal({ is_demo: true }), facts: facts(), asOf, estimate });
    expect(s.collected).toBeNull();
    expect(s.noi.basis).toBe('estimated');
  });

  it('ignores other deals payments, future periods and periods older than 12 months', () => {
    const noise = [pay('2026-11-01'), pay('2024-01-01'), { ...pay('2026-09-01'), deal_id: 'other', amount_paid: 999_999 }];
    const s = resolvePropertyState({ deal: deal(), facts: facts({ payments: [...year, ...noise] }), asOf, estimate });
    expect(s.collected).toMatchObject({ months: 12, total: 120_000 });
  });

  it('a paid row with no recorded amount adds nothing (no guess)', () => {
    const s = resolvePropertyState({ deal: deal(), facts: facts({ payments: [...year.slice(0, 11), pay('2026-10-01', { amount_paid: null })] }), asOf, estimate });
    expect(s.collected?.total).toBe(110_000);
  });

  it('rent roll: tables only for owned (inputs leases are ignored), blank when there are none', () => {
    const withInputs = deal({ inputs: { leases: [{ tenantName: 'X', monthlyRent: 99_999 }] } });
    const none = resolvePropertyState({ deal: withInputs, facts: facts({ leases: [] }), asOf, estimate });
    expect(none.rentRoll).toEqual({ source: 'none', inForceCount: 0, monthlyRent: null });
    const s = resolvePropertyState({ deal: withInputs, facts: facts(), asOf, estimate });
    expect(s.rentRoll).toEqual({ source: 'tables', inForceCount: 1, monthlyRent: 10_000 });
  });

  it('rent roll excludes ended, not-started and inactive leases', () => {
    const leases = [lease(), lease({ id: 'a', lease_end_date: '2026-01-01' }), lease({ id: 'b', lease_start_date: '2027-01-01' }), lease({ id: 'c', is_active: false })];
    expect(resolvePropertyState({ deal: deal(), facts: facts({ leases }), asOf, estimate }).rentRoll.inForceCount).toBe(1);
  });

  it('occupancy counts units with a lease in force; blank without units', () => {
    const s = resolvePropertyState({ deal: deal(), facts: facts(), asOf, estimate });
    expect(s.occupancy).toMatchObject({ value: 50, basis: 'contracted', occupiedUnits: 1, totalUnits: 2 });
    expect(resolvePropertyState({ deal: deal(), facts: facts({ units: [] }), asOf, estimate }).occupancy.value).toBeNull();
  });

  it('prospect: assumptions only, no actuals, no occupancy', () => {
    const p = deal({ status: 'prospect', inputs: { leases: [{ tenantName: 'T', monthlyRent: 2_000 }] } });
    const s = resolvePropertyState({ deal: p, facts: facts(), asOf, estimate });
    expect(s.stage).toBe('prospect');
    expect(s.collected).toBeNull();
    expect(s.occupancy.value).toBeNull();
    expect(s.rentRoll).toEqual({ source: 'inputs', inForceCount: 1, monthlyRent: 2_000 });
    expect(s.noi.basis).toBe('estimated');
  });

  it('no expense figure from the engine: does not pair collected rent with a missing cost', () => {
    const s = resolvePropertyState({ deal: deal(), facts: facts(), asOf, estimate: { ...estimate, operatingExpenses: null } });
    expect(s.noi.basis).toBe('estimated');
  });
});
