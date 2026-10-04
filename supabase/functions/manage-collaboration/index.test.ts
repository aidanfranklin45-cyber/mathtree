import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake Supabase: records every query and answers from `tables`.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  upserts: [] as any[],
  orFilters: [] as string[],
  user: { id: 'attacker', email: 'attacker@example.com' } as { id: string; email: string },
}));

vi.mock('std/http/server.ts', () => ({ serve: () => {} }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_u: string, _k: string, opts?: any) => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => {
      const filters: Array<[string, any]> = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => (filters.push([c, v]), q),
        ilike: (c: string, v: any) => (filters.push([c, v]), q),
        or: (f: string) => (state.orFilters.push(f), q),
        delete: () => q,
        upsert: (row: any) => (state.upserts.push({ table, row }), q),
        update: () => q,
        insert: () => q,
        order: () => q,
        single: async () => ({ data: state.upserts.at(-1)?.row ?? null, error: null }),
        maybeSingle: async () => ({ data: (state.tables[table] || []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
        then: (res: any) => res({ data: (state.tables[table] || []).filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
      };
      return q;
    },
  }),
}));

import { handleRequest } from './index';

function call(body: Record<string, unknown>) {
  return handleRequest(new Request('https://x.test/fn', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => ({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's' } as any)[k] } });
  state.upserts = [];
  state.orFilters = [];
  state.user = { id: 'attacker', email: 'attacker@example.com' };
  state.tables = {
    deals: [{ id: 'victim-deal', user_id: 'victim', title: 'Secret' }, { id: 'my-deal', user_id: 'attacker', title: 'Mine' }],
    deal_shares: [{ id: 's1', deal_id: 'victim-deal', owner_id: 'victim', shared_with_email: 'partner@example.com' }],
  };
});

describe('manage-collaboration permissions', () => {
  it('refuses to share a deal the caller does not own', async () => {
    const res = await call({ action: 'share_deal', deal_id: 'victim-deal', share_type: 'email', target_id: 'me2@example.com', permission: 'editor' });
    expect(state.upserts).toHaveLength(0);
    expect(res.status).toBe(403);
  });

  it('refuses to list the shares of a deal the caller does not own', async () => {
    const res = await call({ action: 'get_deal_shares', deal_id: 'victim-deal' });
    expect(res.status).toBe(403);
  });

  it('refuses to share a deal with yourself', async () => {
    const res = await call({ action: 'share_deal', deal_id: 'my-deal', share_type: 'email', target_id: 'Attacker@Example.com' });
    expect(state.upserts).toHaveLength(0);
    expect(res.status).toBe(400);
  });

  it('does not let revoke target ids inject extra filter clauses', async () => {
    await call({ action: 'revoke_share', deal_id: 'my-deal', target_id: 'x),owner_id.neq.nobody,and(id.eq.1' });
    for (const f of state.orFilters) expect(f).not.toContain('owner_id.neq');
  });

  it('still shares an owned deal', async () => {
    const res = await call({ action: 'share_deal', deal_id: 'my-deal', share_type: 'email', target_id: 'friend@example.com' });
    expect(res.status).toBe(200);
    expect(state.upserts[0].row.shared_with_email).toBe('friend@example.com');
  });
});
