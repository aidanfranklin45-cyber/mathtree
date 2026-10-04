import { useCallback, useSyncExternalStore } from 'react';
import { supabase } from '../supabase/client';
import { inboxMuteKey, inboxMuteLabel, type InboxItem } from './attention';

/** An item type the owner has muted for one property. Kept with its names so the muted list reads even when nothing is firing. */
export interface MutedEntry { key: string; dealTitle: string; label: string }

/**
 * Muted inbox items, per signed-in user, stored in `profiles.alert_preferences.inbox_muted` (an existing column, so no migration).
 * One shared store for the bell, the Operations page and each Operate tab, so a mute applies in all of them at once.
 */
let muted: MutedEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const isEntry = (e: unknown): e is MutedEntry =>
  !!e && typeof e === 'object' && typeof (e as MutedEntry).key === 'string' && typeof (e as MutedEntry).label === 'string';

async function load() {
  try {
    const { data: auth } = await supabase.auth.getSession();
    const uid = auth?.session?.user?.id;
    if (!uid) return;
    const { data } = await supabase.from('profiles').select('alert_preferences').eq('id', uid).maybeSingle();
    const list = (data?.alert_preferences as Record<string, unknown> | null)?.inbox_muted;
    muted = Array.isArray(list) ? list.filter(isEntry) : [];
    loaded = true;
    emit();
  } catch (err) {
    console.warn('[inbox] could not load muted items:', err);
  }
}

async function save(next: MutedEntry[]) {
  muted = next;
  emit();
  try {
    const { data: auth } = await supabase.auth.getSession();
    const uid = auth?.session?.user?.id;
    if (!uid) return;
    // Read-modify-write so the alert timing prefs stored in the same column are kept
    const { data } = await supabase.from('profiles').select('alert_preferences').eq('id', uid).maybeSingle();
    const cur = (data?.alert_preferences && typeof data.alert_preferences === 'object' ? data.alert_preferences : {}) as Record<string, unknown>;
    const { error } = await supabase.from('profiles').update({ alert_preferences: { ...cur, inbox_muted: next } as never, updated_at: new Date().toISOString() }).eq('id', uid);
    if (error) console.warn('[inbox] could not save muted items:', error);
  } catch (err) {
    console.warn('[inbox] could not save muted items:', err);
  }
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') { muted = []; loaded = false; emit(); }
  else if (event === 'SIGNED_IN') void load();
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  if (!loaded) void load();
  return () => { listeners.delete(l); };
};

export function useInboxMutes() {
  const entries = useSyncExternalStore(subscribe, () => muted);
  const mute = useCallback((item: InboxItem) => {
    const key = inboxMuteKey(item);
    if (!muted.some((m) => m.key === key)) void save([...muted, { key, dealTitle: item.dealTitle, label: inboxMuteLabel(item) }]);
  }, []);
  const unmute = useCallback((key: string) => { void save(muted.filter((m) => m.key !== key)); }, []);
  return { entries, keys: new Set(entries.map((m) => m.key)), mute, unmute };
}
