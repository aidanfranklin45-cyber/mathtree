import { supabase, BENCHMARK_DEAL } from '../supabase/client';
import { mapSupabaseDeal } from '../../stores/useDealStore';
import type { DealRecord } from '../math/types';

// Only select live columns that exist on the deals table (avoids PostgREST 400 errors)
export const DEAL_FIELDS = 'id, user_id, title, location, asset_type, status, purchase_price, is_demo, inputs, created_at, updated_at, entity_id';

/**
 * The deal set the dashboard shows: the signed-in user's own deals plus deals shared with them. A user with none gets the
 * demo deals, then the built-in benchmark deal. The dashboard and the portfolio brief both load through this.
 */
export async function loadPortfolioDeals(): Promise<{ deals: DealRecord[]; isSample: boolean }> {
  const sessionRes = await supabase.auth.getSession();
  const user = sessionRes.data?.session?.user;

  let dealsPromise: PromiseLike<any>;
  let sharesPromise: PromiseLike<any>;
  if (user) {
    dealsPromise = supabase.from('deals').select(DEAL_FIELDS).eq('user_id', user.id).order('created_at', { ascending: false });
    const emailFilter = user.email ? `,shared_with_email.ilike.${user.email}` : '';
    sharesPromise = supabase
      .from('deal_shares')
      .select(`id, deal_id, permission, owner_id, deals(${DEAL_FIELDS})`)
      .or(`shared_with_user_id.eq.${user.id}${emailFilter}`);
  } else {
    dealsPromise = Promise.resolve({ data: null, error: null });
    sharesPromise = Promise.resolve({ data: null, error: null });
  }

  const [dealsRes, sharesRes] = await Promise.all([dealsPromise, sharesPromise]);
  if (dealsRes.error) console.error('[portfolio] failed to load deals:', dealsRes.error);
  if (sharesRes.error) console.error('[portfolio] failed to load shared deals:', sharesRes.error);

  let list: DealRecord[] = [];
  if (dealsRes.data && dealsRes.data.length > 0) {
    list = (dealsRes.data as any[]).map(mapSupabaseDeal);
  }

  if (sharesRes.data && Array.isArray(sharesRes.data)) {
    const have = new Set(list.map((d) => d.id));
    (sharesRes.data as any[])
      .filter((sh) => sh.deals && !have.has(sh.deals.id))
      .forEach((sh) => {
        const mapped: any = mapSupabaseDeal(sh.deals);
        mapped.is_shared = true;
        mapped.shared_permission = sh.permission || 'viewer';
        mapped.shared_by = sh.owner_id;
        list.push(mapped);
      });
  }

  let isSample = false;
  // No personal deals: fall back to demo deals, then the benchmark deal
  if (list.length === 0) {
    const { data, error } = await supabase.from('deals').select(DEAL_FIELDS).order('created_at', { ascending: false }).limit(25);
    if (!error && data && data.length > 0) {
      list = (data as any[]).map(mapSupabaseDeal);
    } else {
      list = [mapSupabaseDeal(BENCHMARK_DEAL)];
      isSample = true;
    }
  }
  if (list.some((d) => !d.is_demo)) isSample = false;
  return { deals: list, isSample };
}
