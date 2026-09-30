import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase/client';

export interface AppNotification {
  notification_id: string;
  target_deal_id: string | null;
  notif_type: string;
  severity: 'critical' | 'warning' | 'info' | string;
  title: string;
  message: string;
  action_type: string | null;
  action_payload: Record<string, any> | null;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVAL_THROTTLE_MS = 60_000; // Evaluate at most once per minute unless explicitly forced
let globalLastEvalTimestamp = 0; // Session-wide module throttle that persists across page navigations

function mapNotificationRow(r: any): AppNotification {
  return {
    notification_id: r.notification_id || r.id,
    target_deal_id: r.target_deal_id || r.deal_id || null,
    notif_type: r.notif_type || r.type,
    severity: r.severity || 'info',
    title: r.title || '',
    message: r.message || '',
    action_type: r.action_type || null,
    action_payload: r.action_payload || null,
    is_read: !!r.is_read,
    is_dismissed: !!r.is_dismissed,
    created_at: r.created_at || new Date().toISOString(),
  };
}

/**
 * Action Center data: queries active notifications via fast indexed table scan,
 * keeps the list live through a realtime subscription (without infinite RPC loops),
 * and evaluates deal notifications on demand or throttled.
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const userIdRef = useRef<string | null>(null);

  const getUid = useCallback(async (): Promise<string | null> => {
    if (userIdRef.current) return userIdRef.current;
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id ?? null;
    userIdRef.current = uid;
    return uid;
  }, []);

  // Fast direct read of active notifications without heavy baseline recomputation
  const fetchActive = useCallback(async () => {
    try {
      const uid = await getUid();
      if (!uid || !UUID.test(uid)) return;
      const { data, error } = await supabase
        .from('app_notifications' as never)
        .select('*')
        .eq('user_id', uid)
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        setNotifications((data as any[]).map(mapNotificationRow));
      }
    } catch (err) {
      console.warn('[notifications] fetchActive failed:', err);
    }
  }, [getUid]);

  // Full server-side evaluation (runs on explicit user refresh or when drawer is opened)
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const uid = await getUid();
      if (!uid || !UUID.test(uid)) return;
      globalLastEvalTimestamp = Date.now();
      const { data, error } = await supabase.rpc('rpc_evaluate_deal_notifications' as never, { p_user_id: uid } as never);
      if (!error && Array.isArray(data)) {
        setNotifications((data as any[]).map(mapNotificationRow));
      } else {
        await fetchActive();
      }
    } catch (err) {
      console.warn('[notifications] refresh failed:', err);
      await fetchActive();
    } finally {
      setLoading(false);
    }
  }, [getUid, fetchActive]);

  useEffect(() => {
    // Initial load: fast fetch first to show badges instantly, then evaluate if never evaluated or throttle expired
    void fetchActive().then(() => {
      const now = Date.now();
      if (now - globalLastEvalTimestamp > EVAL_THROTTLE_MS) {
        void refresh();
      }
    });

    // Realtime channel: only re-fetch active rows, do NOT trigger recursive RPC evaluation!
    const channel = supabase
      .channel(`mathtree-app-notifications-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_notifications' }, () => {
        void fetchActive();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [fetchActive, refresh]);

  const dismiss = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('app_notifications' as never)
      .update({ is_dismissed: true, updated_at: new Date().toISOString() } as never)
      .eq('id', id);
    if (error) {
      console.warn('[notifications] dismiss failed:', error);
      return;
    }
    setNotifications((prev) => prev.filter((n) => n.notification_id !== id));
  }, []);

  /** Copies the live rent roll income into the deal's pro-forma inputs, then drops the variance alert. */
  const syncProFormaToActuals = useCallback(async (dealId: string, actualMonthlyRent: number): Promise<boolean> => {
    const { error } = await supabase.rpc('rpc_sync_proforma_to_actuals' as never, {
      p_deal_id: dealId,
      p_actual_monthly_rent: Number(actualMonthlyRent) || 0,
    } as never);
    if (error) {
      console.error('[notifications] sync failed:', error);
      return false;
    }
    setNotifications((prev) => prev.filter((n) => !(n.target_deal_id === dealId && n.notif_type === 'revenue_variance')));
    return true;
  }, []);

  return { notifications, loading, refresh, dismiss, syncProFormaToActuals };
}
