import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';

declare global {
  interface Window {
    /** Loaded from /session.js (30-minute inactivity logout + warning modal), shared with the static login page. */
    MathTreeSession?: {
      isTimedOut: (ms?: number) => boolean;
      isValidSession: (session: unknown) => boolean;
      logout: (reason?: string, client?: unknown, redirectUrl?: string) => void;
      startWatcher: (client: unknown, options?: unknown) => void;
      clearSessionStorage: (options?: { authOnly?: boolean }) => void;
      clearAuthStorage: () => void;
    };
  }
}

const LOGIN_URL = import.meta.env.DEV ? '/index.html' : '/';

/** Circuit breaker: prevent redirect loops by detecting rapid repeated bounces to login. */
function checkRedirectLoop(): boolean {
  try {
    const key = 'mathtree_redirect_guard';
    const now = Date.now();
    const raw = sessionStorage.getItem(key);
    const data: { count: number; first: number } = raw ? JSON.parse(raw) : { count: 0, first: now };

    // Reset window after 10 seconds
    if (now - data.first > 10000) {
      sessionStorage.setItem(key, JSON.stringify({ count: 1, first: now }));
      return false;
    }

    data.count += 1;
    sessionStorage.setItem(key, JSON.stringify(data));

    if (data.count >= 3) {
      console.warn('MathTree: Redirect loop detected, clearing auth tokens and breaking loop.');
      sessionStorage.removeItem(key);
      const session = window.MathTreeSession;
      if (session?.clearAuthStorage) {
        session.clearAuthStorage();
      } else if (session?.clearSessionStorage) {
        session.clearSessionStorage({ authOnly: true });
      } else {
        try {
          localStorage.removeItem('mathtree_last_activity');
          localStorage.removeItem('mathtree_active_user');
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('sb-') && k.includes('-auth-token')) {
              localStorage.removeItem(k);
            }
          }
        } catch { /* storage unavailable */ }
      }
      return true;
    }
  } catch { /* storage unavailable */ }
  return false;
}

function isDemoVisit(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('demo') === 'true') {
      localStorage.setItem('mathtree_demo_mode', JSON.stringify({ demo: true, email: 'demo@mathtree.app', name: 'Demo Investor' }));
      return true;
    }
    const raw = localStorage.getItem('mathtree_demo_mode');
    if (raw && JSON.parse(raw)?.demo) return true;
    const user = localStorage.getItem('mathtree_active_user');
    if (user && JSON.parse(user)?.demo) return true;
  } catch { /* storage unavailable: treat as a normal visit */ }
  return false;
}

/**
 * Same guard the legacy pages ran: expired inactivity timer or no session sends the visitor to the login page.
 * Demo mode (?demo=true) is allowed through without a session, as before.
 */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    const session = window.MathTreeSession;

    if (session?.isTimedOut()) {
      const timeoutUrl = LOGIN_URL + (LOGIN_URL.includes('?') ? '&' : '?') + 'reason=timeout';
      session.logout('timeout', supabase, timeoutUrl);
      return;
    }

    if (isDemoVisit()) {
      session?.startWatcher(null);
      setReady(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      const s = data.session;
      const isValid = s && (
        session?.isValidSession
          ? session.isValidSession(s)
          : (typeof s.expires_at === 'number' ? s.expires_at > Math.floor(Date.now() / 1000) : true)
      );

      if (!isValid) {
        if (s) {
          // Token is stale or unusable: scrub auth storage and call signOut
          if (session?.clearAuthStorage) {
            session.clearAuthStorage();
          } else if (session?.clearSessionStorage) {
            session.clearSessionStorage({ authOnly: true });
          }
          supabase.auth.signOut().catch(() => {});
        }
        if (checkRedirectLoop()) {
          const loopUrl = LOGIN_URL + (LOGIN_URL.includes('?') ? '&' : '?') + 'reason=loop_detected';
          window.location.replace(loopUrl);
          return;
        }
        window.location.replace(LOGIN_URL);
        return;
      }
      try { sessionStorage.removeItem('mathtree_redirect_guard'); } catch {}
      session?.startWatcher(supabase);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT' || (!s && event !== 'INITIAL_SESSION')) {
        if (checkRedirectLoop()) {
          const loopUrl = LOGIN_URL + (LOGIN_URL.includes('?') ? '&' : '?') + 'reason=loop_detected';
          window.location.replace(loopUrl);
          return;
        }
        window.location.replace(LOGIN_URL);
      }
    });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin" />
      </div>
    );
  }
  return <>{children}</>;
};
