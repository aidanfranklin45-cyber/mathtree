import React, { lazy } from 'react';

const RELOAD_GUARD_KEY = 'mathtree_chunk_reload_guard';
const RELOAD_WINDOW_MS = 15000;

/** Check if an error indicates a stale chunk or failed dynamic script fetch. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error as Error)?.message || String(error);
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error resolving module specifier')
  );
}

/**
 * Trigger a page reload to pull down the latest deployed assets.
 * Guarded against infinite reload loops using a short sessionStorage timestamp window.
 */
export function triggerChunkReload(): boolean {
  try {
    const now = Date.now();
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    const last = raw ? Number(raw) : 0;
    if (now - last > RELOAD_WINDOW_MS) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
      window.location.reload();
      return true;
    }
  } catch {
    window.location.reload();
    return true;
  }
  return false;
}

// Vite emits `vite:preloadError` when a dynamic import fails due to a new deployment
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    console.warn('[MathTree] Stale deployment chunk detected via vite:preloadError; reloading latest application...');
    // Prevent default error popups where supported
    event?.preventDefault?.();
    triggerChunkReload();
  });
}

/**
 * Resilient wrapper around React.lazy() that automatically handles stale deployment chunks.
 * When a deployment replaces chunks on the CDN, any active client navigating to a lazy route
 * will automatically refresh the application once to load the newest bundle.
 */
export function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await importer();
    } catch (err) {
      if (isChunkLoadError(err)) {
        console.warn('[MathTree] Dynamic module failed to load. Checking for updated version...', err);
        const reloaded = triggerChunkReload();
        if (reloaded) {
          // Keep promise pending so React does not crash during the brief window before page reloads
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw err;
    }
  });
}
