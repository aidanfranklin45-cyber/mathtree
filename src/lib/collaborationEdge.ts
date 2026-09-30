import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase/client';

export interface DealShareRow {
  id: string;
  deal_id: string;
  permission: 'viewer' | 'editor';
  shared_with_email?: string | null;
  group_name?: string | null;
  collaborator_groups?: { name?: string } | null;
  created_at: string;
  deals?: { id: string; title?: string; name?: string } | null;
}

/** Calls the manage-collaboration edge function (same contract the legacy pages used). Null on failure. */
export async function invokeCollaboration<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token || SUPABASE_ANON_KEY;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-collaboration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ action, ...params }),
    });
    if (res.ok) return (await res.json()) as T;
    const err = await res.json().catch(() => null);
    return err as T | null;
  } catch (e) {
    console.warn('[manage-collaboration] request failed:', e);
    return null;
  }
}

/** Deals the signed-in user has shared out, newest first. */
export async function fetchOutgoingShares(ownerId: string): Promise<DealShareRow[]> {
  const { data, error } = await supabase
    .from('deal_shares')
    .select('id, deal_id, permission, shared_with_email, created_at, deals(id, title, name)')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as unknown as DealShareRow[];
}

/** Everyone a single deal is shared with. */
export async function fetchDealShares(dealId: string): Promise<DealShareRow[]> {
  const { data } = await supabase
    .from('deal_shares')
    .select('id, deal_id, permission, shared_with_email, created_at')
    .eq('deal_id', dealId);
  return (data || []) as unknown as DealShareRow[];
}
