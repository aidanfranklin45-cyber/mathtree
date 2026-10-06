import React, { lazy } from 'react';

const RELOAD_GUARD_KEY = 'mathtree_chunk_reload_guard';
const RELOAD_WINDOW_MS = 15000;
const LAST_ETAG_KEY = 'mathtree_build_etag';

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
export function triggerChunkReload(targetUrl?: string): boolean {
  try {
    const now = Date.now();
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    const last = raw ? Number(raw) : 0;
    if (now - last > RELOAD_WINDOW_MS) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
      if (targetUrl && targetUrl !== window.location.href) {
        window.location.assign(targetUrl);
      } else {
        window.location.reload();
      }
      return true;
    }
  } catch {
    window.location.reload();
    return true;
  }
  return false;
}

/**
 * Checks if the deployment on the server has changed since this tab was opened.
 * Uses a lightweight HEAD request against /app.html (which is served with no-cache).
 */
export async function checkDeploymentFreshness(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const fetchFn = (window.fetch ? window.fetch.bind(window) : fetch);
    const res = await fetchFn('/app.html', {
      method: 'HEAD',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    const etag = res.headers.get('etag') || res.headers.get('last-modified');
    if (!etag) return false;

    const storage = window.sessionStorage;
    const previousEtag = storage ? storage.getItem(LAST_ETAG_KEY) : null;
    if (!previousEtag) {
      storage?.setItem(LAST_ETAG_KEY, etag);
      return false;
    }

    if (previousEtag !== etag) {
      console.info('[MathTree] Newer deployment detected on server. Old:', previousEtag, 'New:', etag);
      storage?.setItem(LAST_ETAG_KEY, etag);
      return true;
    }
  } catch {
    // Network offline or failed check, ignore
  }
  return false;
}

/** A small notice that a newer version is ready. Built without React so it works whatever state the page is in. */
function showUpdateBanner(): void {
  if (typeof document === 'undefined' || document.getElementById('mt-update-banner')) return;
  const el = document.createElement('div');
  el.id = 'mt-update-banner';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:100000;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:10px 14px;font:600 12px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);display:flex;gap:12px;align-items:center';
  const text = document.createElement('span');
  text.textContent = 'A newer version is available.';
  const button = document.createElement('button');
  button.textContent = 'Reload when you are ready';
  button.style.cssText = 'background:#10b981;color:#022c22;border:0;border-radius:8px;padding:5px 10px;font:700 12px system-ui,sans-serif;cursor:pointer';
  button.onclick = () => window.location.reload();
  el.append(text, button);
  document.body.appendChild(el);
}

// Global Self-Healing Listeners
if (typeof window !== 'undefined') {
  // 1. Vite preload errors (dispatched by Vite runtime when dynamic chunk or its mapDeps 404)
  window.addEventListener('vite:preloadError', (event) => {
    console.warn('[MathTree] Stale deployment chunk detected via vite:preloadError; self-healing session...');
    event?.preventDefault?.();
    triggerChunkReload();
  });

  // 2. Global unhandled promise rejection (catches rejected import() promises across any page or component)
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      console.warn('[MathTree] Dynamic module rejection caught; triggering self-healing reload...', event.reason);
      event.preventDefault();
      triggerChunkReload();
    }
  });

  // 3. Global resource error handler (captures failed script/modulepreload tags for /assets/)
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        const url = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || '';
        if (url.includes('/assets/')) {
          console.warn('[MathTree] Script asset failed to load from CDN:', url);
          triggerChunkReload();
        }
      }
    },
    true
  );

  // 4. Coming back to a tab that has been away a long while: if a newer version has gone out, say so. It never reloads the page by itself (that
  // would throw away whatever is open); reloading on a real failure is handled above, when a script file the page needs is actually missing.
  let lastVisibilityCheck = Date.now();
  const AWAY_BEFORE_CHECKING_MS = 10 * 60 * 1000;
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibilityCheck <= AWAY_BEFORE_CHECKING_MS) return;
      lastVisibilityCheck = now;
      checkDeploymentFreshness().then((isStale) => {
        if (isStale) showUpdateBanner();
      });
    });
  }
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
        console.warn('[MathTree] Dynamic module failed to load. Self-healing...', err);
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
