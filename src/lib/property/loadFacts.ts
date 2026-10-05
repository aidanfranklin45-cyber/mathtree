import { supabase } from '../supabase/client';
import type { DealRecord } from '../math/types';
import type { PropertyFacts } from './types';

/**
 * Loads the rent roll (leases, units) and rent payments for the owned, non-demo deals in `deals`, and attaches them as
 * `property_facts` so `resolvePointInTimeDealMetrics` reads actuals. Facts only, nothing computed or stored. A table that cannot be
 * read leaves that part blank rather than failing.
 */
export async function attachPropertyFacts(deals: DealRecord[]): Promise<DealRecord[]> {
  const ownedIds = deals.filter((d) => d.status === 'owned' && !d.is_demo).map((d) => d.id);
  if (ownedIds.length === 0) return deals;

  const read = async (table: string, columns: string): Promise<any[] | null> => {
    try {
      const { data, error } = await (supabase as any).from(table).select(columns).in('deal_id', ownedIds);
      return error ? null : (data as any[]);
    } catch {
      return null;
    }
  };
  const [leases, units, payments] = await Promise.all([
    read('leases', 'id, deal_id, unit_id, monthly_rent, lease_start_date, lease_end_date, term_type, is_active'),
    read('units', 'id, deal_id'),
    read('rent_payments', 'deal_id, lease_id, period_month, due_date, amount_due, amount_paid, status'),
  ]);
  // Without a rent roll or payments we know nothing about actuals: leave the deal on its forecast.
  if (!leases || !payments) return deals;

  return deals.map((d) => {
    if (!ownedIds.includes(d.id)) return d;
    const facts: PropertyFacts = {
      leases: leases.filter((l) => l.deal_id === d.id),
      units: (units ?? []).filter((u) => u.deal_id === d.id),
      payments: payments.filter((p) => p.deal_id === d.id),
    };
    return { ...d, property_facts: facts };
  });
}
