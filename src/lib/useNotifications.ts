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

/**
 * Action Center data: evaluates the signed-in user's portfolio server-side (rpc_evaluate_deal_notifications),
 * keeps the list live through a realtime subscription, and exposes dismiss / sync-to-actuals actions.
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const userIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      let uid = userIdRef.current;
      if (!uid) {
        const { data } = await supabase.auth.getUser();
        uid = data?.user?.id ?? null;
        userIdRef.current = uid;
      }
      if (!uid || !UUID.test(uid)) return;
      const { data, error } = await supabase.rpc('rpc_evaluate_deal_notifications' as never, { p_user_id: uid } as never);
      // Revenue-variance alerts (old "sync pro-forma" prompts) are retired: the underwriting is never rewritten to match events
      if (!error && Array.isArray(data)) setNotifications((data as AppNotification[]).filter((n) => n.notif_type !== 'revenue_variance'));
    } catch (err) {
      console.warn('[notifications] refresh failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel(`mathtree-app-notifications-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_notifications' }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

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

    return { notifications, loading, refresh, dismiss };
}
