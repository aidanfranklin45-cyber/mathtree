/**
 * The signed-in investor's "what happens after a lease ends" default (set in their profile). Held here, away from the
 * profile/network code, so the engine wrapper can read it synchronously and tests stay free of the Supabase client.
 */
import { DEFAULT_EXPIRY, normalizeExpiryDefaults, type ExpiryDefaults } from '../../../supabase/functions/_shared/leaseExpiry';

let current: ExpiryDefaults = { ...DEFAULT_EXPIRY };
let version = 0;
const listeners = new Set<() => void>();

export const getExpiryDefaults = (): ExpiryDefaults => current;
export const getExpiryDefaultsVersion = (): number => version;

export function setExpiryDefaults(p: Record<string, unknown> | null | undefined): void {
  const next = normalizeExpiryDefaults(p);
  if (next.mode === current.mode && next.vacancyMonths === current.vacancyMonths) return;
  current = next;
  version += 1;
  listeners.forEach((l) => l());
}

export function subscribeExpiryDefaults(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
