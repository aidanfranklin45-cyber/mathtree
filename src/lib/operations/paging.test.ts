import { describe, it, expect } from 'vitest';
import { fetchAllRows } from '../../../supabase/functions/_shared/paging';

// Fake table that, like PostgREST, serves at most `pageSize` rows per range request.
const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
const pager = (rows: Array<{ id: number }>, calls: Array<[number, number]> = []) => (from: number, to: number) => {
  calls.push([from, to]);
  return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
};

describe('fetchAllRows', () => {
  it('returns every row when the table is larger than one page (the 1,000-row cap case)', async () => {
    const rows = table(2350);
    const out = await fetchAllRows(pager(rows));
    expect(out).toHaveLength(2350);
    expect(out[2349]).toEqual({ id: 2349 });
  });

  it('stops after one request when the result fits in a page', async () => {
    const calls: Array<[number, number]> = [];
    expect(await fetchAllRows(pager(table(40), calls))).toHaveLength(40);
    expect(calls).toEqual([[0, 999]]);
  });

  it('handles an exact multiple of the page size and an empty table', async () => {
    expect(await fetchAllRows(pager(table(300)), 100)).toHaveLength(300);
    expect(await fetchAllRows(pager([]))).toEqual([]);
  });

  it('surfaces a query error instead of returning partial data', async () => {
    await expect(fetchAllRows(() => Promise.resolve({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom');
  });
});
