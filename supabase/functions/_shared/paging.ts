// PostgREST returns at most 1,000 rows per request, silently truncating anything larger. Pages through a query until a short page
// comes back so callers see every row. `page` must apply a stable order (e.g. by id) so pages don't overlap or skip rows.

export const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
