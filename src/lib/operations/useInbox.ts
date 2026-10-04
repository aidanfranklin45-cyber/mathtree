import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase/client';
import { normalizeRecoveryPrefs, type RecoveryPrefs } from './recoveries';
import { buildPortfolioInbox } from './portfolioInbox';
import type { InboxItem } from './attention';
import type { Row } from './rentRoll';

/**
 * The portfolio inbox for the bell: loads the facts it is derived from and runs the same `buildInboxItems` rules the
 * Operations page uses. Nothing is stored, so the list can only ever say what the data says right now.
 */
export function useInbox() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth?.session?.user?.id;
      if (!uid) return;
      const mine = (table: string, columns = '*') => supabase.from(table as never).select(columns).eq('user_id', uid);
      const [deals, leases, units, payments, increases, terms, recItems, prof] = await Promise.all([
        mine('deals'), mine('leases'), mine('units'), mine('rent_payments'), mine('rent_increases'),
        mine('lease_recovery_terms'), mine('lease_recovery_items'),
        supabase.from('profiles').select('alert_preferences').eq('id', uid).maybeSingle(),
      ]);
      const rows = (r: { data: unknown }): Row[] => (Array.isArray(r.data) ? (r.data as Row[]) : []);
      const recPrefs: RecoveryPrefs = normalizeRecoveryPrefs(prof.data?.alert_preferences as Record<string, unknown> | null);
      setItems(buildPortfolioInbox({
        deals: rows(deals), leases: rows(leases), units: rows(units), payments: rows(payments), increases: rows(increases),
        recTerms: rows(terms), recItems: rows(recItems), recPrefs,
      }));
    } catch (err) {
      console.warn('[inbox] refresh failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { items, loading, refresh };
}
