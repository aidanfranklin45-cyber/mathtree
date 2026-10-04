import { supabase } from '../supabase/client';
import type { Json } from '../supabase/types';
import { CompareConfig, configSignature, normalizeConfig } from './config';

export interface SavedView {
  id: string;
  name: string;
  config: CompareConfig;
  updated_at: string;
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; error: string };

const COLUMNS = 'id, name, config, updated_at';
const toView = (row: any): SavedView => ({ id: row.id, name: row.name, config: normalizeConfig(row.config), updated_at: row.updated_at });

export async function listSavedViews(): Promise<SavedView[]> {
  const { data, error } = await supabase.from('compare_views').select(COLUMNS).order('updated_at', { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map(toView);
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

export async function createSavedView(name: string, config: CompareConfig): Promise<SaveResult<SavedView>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to save comparisons.' };
  const { data, error } = await supabase
    .from('compare_views')
    .insert({ user_id: userId, name: name.trim().slice(0, 80) || 'Untitled comparison', config: config as unknown as Json })
    .select(COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: 'The comparison could not be saved. Try again.' };
  return { ok: true, value: toView(data) };
}

export async function updateSavedView(id: string, patch: { name?: string; config?: CompareConfig }): Promise<SaveResult<SavedView>> {
  const body: { name?: string; config?: Json; updated_at: string } = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) body.name = patch.name.trim().slice(0, 80) || 'Untitled comparison';
  if (patch.config) body.config = patch.config as unknown as Json;
  const { data, error } = await supabase.from('compare_views').update(body).eq('id', id).select(COLUMNS).single();
  if (error || !data) return { ok: false, error: 'The comparison could not be updated. Try again.' };
  return { ok: true, value: toView(data) };
}

export async function deleteSavedView(id: string): Promise<boolean> {
  const { error } = await supabase.from('compare_views').delete().eq('id', id);
  return !error;
}

// ---------------------------------------------------------------------------
// Browser-only conveniences: the unsaved draft and the last few boards. Never required for anything to work.
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'mathtree_compare_draft';
const RECENT_KEY = 'mathtree_compare_recent';
export const MAX_RECENTS = 3;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window or full storage: the draft is a convenience only */
  }
}

export function loadDraft(): CompareConfig | null {
  const raw = readJson(DRAFT_KEY);
  if (!raw) return null;
  const cfg = normalizeConfig(raw);
  return cfg.entries.length > 0 ? cfg : null;
}

export function saveDraft(config: CompareConfig | null): void {
  writeJson(DRAFT_KEY, config && config.entries.length > 0 ? config : null);
}

export interface RecentBoard {
  config: CompareConfig;
  at: string;
}

export function loadRecents(): RecentBoard[] {
  const raw = readJson(RECENT_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => ({ config: normalizeConfig(r?.config), at: typeof r?.at === 'string' ? r.at : '' }))
    .filter((r) => r.config.entries.length > 0)
    .slice(0, MAX_RECENTS);
}

/** Remember a board that is about to be replaced or cleared. The same board is only kept once, newest first. */
export function pushRecent(config: CompareConfig, now: Date = new Date()): RecentBoard[] {
  if (config.entries.length === 0) return loadRecents();
  const sig = configSignature(config);
  const next = [{ config, at: now.toISOString() }, ...loadRecents().filter((r) => configSignature(r.config) !== sig)].slice(0, MAX_RECENTS);
  writeJson(RECENT_KEY, next);
  return next;
}
