import { describe, it, expect, beforeEach, vi } from 'vitest';

// A minimal fake of the Supabase client that records every write, so the ordering and the failure path can be asserted
const h = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ table: string; op: string; payload: any; filters: Array<[string, unknown]> }>,
    previous: null as any,
    insertError: null as any,
    uid: 'u1' as string | null,
  };
  const builder = (table: string) => {
    const q: { op: string; payload: any; filters: Array<[string, unknown]> } = { op: 'select', payload: null, filters: [] };
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: state.previous, error: null }),
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      insert: (p: any) => { state.calls.push({ table, op: 'insert', payload: p, filters: [] }); return Promise.resolve({ error: state.insertError }); },
      then: (res: any, rej: any) => {
        if (q.op === 'update') state.calls.push({ table, op: 'update', payload: q.payload, filters: q.filters });
        return Promise.resolve({ error: null }).then(res, rej);
      },
    };
    return b;
  };
  const supabase = { from: builder, auth: { getUser: () => Promise.resolve({ data: { user: state.uid ? { id: state.uid } : null } }) } };
  return { state, supabase };
});
vi.mock('../supabase/client', () => ({ supabase: h.supabase, BENCHMARK_DEAL: {}, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }));

import { replaceBaseline, rebaseline, SUPERSEDED_PREFIX } from './db';
import { BASELINE_TYPE } from './core';

const DEAL_ID = '11111111-1111-1111-1111-111111111111';
const mkDeal = (over: Record<string, any> = {}): any => ({
  id: DEAL_ID, user_id: 'u1', status: 'owned', asset_class: 'commercial', purchase_price: 400000,
  inputs: { purchasePrice: 400000, downPaymentPercent: 25, interestRate: 6.5, loanTerm: 25, monthlyRent: 2600, grossRentAnnual: 31200, vacancyRate: 5, expenseRatio: 20, exitYear: 10 },
  ...over,
});

beforeEach(() => {
  h.state.calls = [];
  h.state.previous = null;
  h.state.insertError = null;
  h.state.uid = 'u1';
});

describe('replaceBaseline: update projections without losing the old baseline', () => {
  it('archives the old baseline by relabelling it, then inserts the new one (never deletes, never edits content)', async () => {
    h.state.previous = { id: 'old-1', deal_id: DEAL_ID, baseline_type: BASELINE_TYPE, captured_at: '2025-03-04T00:00:00Z' };
    expect(await replaceBaseline(mkDeal())).toBe('created');
    const ops = h.state.calls.map((c) => c.op);
    expect(ops).toEqual(['update', 'insert']);           // archive first (the table allows one live baseline), then insert
    const archive = h.state.calls[0];
    expect(Object.keys(archive.payload)).toEqual(['baseline_type']);   // content columns are frozen by a trigger; only the label changes
    expect(String(archive.payload.baseline_type).startsWith(SUPERSEDED_PREFIX)).toBe(true);
    expect(archive.filters).toEqual([['id', 'old-1']]);
    const inserted = h.state.calls[1].payload;
    expect(inserted.baseline_type).toBe(BASELINE_TYPE);
    expect(inserted.deal_id).toBe(DEAL_ID);
    expect(inserted.user_id).toBe('u1');
    expect(Number(inserted.projected_gross_rent_annual)).toBeGreaterThan(0);
    expect(h.state.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('puts the old baseline back if the new one cannot be saved, so a failure never leaves the deal with none', async () => {
    h.state.previous = { id: 'old-1', deal_id: DEAL_ID, baseline_type: BASELINE_TYPE, captured_at: '2025-03-04T00:00:00Z' };
    h.state.insertError = { message: 'boom' };
    expect(await replaceBaseline(mkDeal())).toBe('error');
    const updates = h.state.calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).toEqual({ baseline_type: BASELINE_TYPE });
    expect(updates[1].filters).toEqual([['id', 'old-1']]);
  });

  it('records a first baseline when none exists, with nothing to archive', async () => {
    expect(await replaceBaseline(mkDeal())).toBe('created');
    expect(h.state.calls.map((c) => c.op)).toEqual(['insert']);
  });

  it('does nothing for deals that are not the signed-in owner’s owned deals', async () => {
    expect(await replaceBaseline(mkDeal({ status: 'prospect' }))).toBe('skipped');
    expect(await replaceBaseline(mkDeal({ is_demo: true }))).toBe('skipped');
    expect(await replaceBaseline(mkDeal({ is_shared: true }))).toBe('skipped');
    expect(await replaceBaseline(mkDeal({ user_id: 'someone-else' }))).toBe('skipped');
    expect(await replaceBaseline(mkDeal({ id: 'not-a-uuid' }))).toBe('skipped');
    h.state.uid = null;
    expect(await replaceBaseline(mkDeal())).toBe('skipped');
    expect(h.state.calls).toHaveLength(0);
  });

  it('is what the Deal Studio’s Re-baseline now does (history kept instead of deleted)', async () => {
    h.state.previous = { id: 'old-2', deal_id: DEAL_ID, baseline_type: BASELINE_TYPE, captured_at: '2025-03-04T00:00:00Z' };
    expect(await rebaseline(mkDeal())).toBe('created');
    expect(h.state.calls.map((c) => c.op)).toEqual(['update', 'insert']);
  });
});
