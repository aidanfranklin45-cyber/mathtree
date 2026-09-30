import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';

declare global {
  interface Window {
    /** Loaded from /session.js (30-minute inactivity logout + warning modal), shared with the static login page. */
    MathTreeSession: {
      isTimedOut: (ms?: number) => boolean;
      isValidSession: (session: unknown) => boolean;
      getLoginUrl: (reason?: string) => string;
      logout: (reason?: string, client?: unknown, redirectUrl?: string) => void;
      startWatcher: (client: unknown, options?: unknown) => void;
      clearSessionStorage: (options?: { authOnly?: boolean }) => void;
      clearAuthStorage: () => void;
    };
  }
}

/** Circuit breaker: prevent redirect loops by detecting rapid repeated bounces to login. */
export function checkRedirectLoop(): boolean {
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
      window.MathTreeSession.clearAuthStorage();
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
 * Evaluates session and guards navigation.
 * Returns 'authenticated' if session is valid or demo visit,
 * or 'redirected' if invalid, timed out, or unauthenticated.
 */
export async function evaluateAuthSession(): Promise<'authenticated' | 'redirected'> {
  if (window.MathTreeSession.isTimedOut()) {
    window.MathTreeSession.logout('timeout', supabase, window.MathTreeSession.getLoginUrl('timeout'));
    return 'redirected';
  }

  if (isDemoVisit()) {
    window.MathTreeSession.startWatcher(null);
    return 'authenticated';
  }

  const { data } = await supabase.auth.getSession();
  const s = data.session;
  const isValid = s && window.MathTreeSession.isValidSession(s);

  if (!isValid) {
    if (s) {
      window.MathTreeSession.clearAuthStorage();
      await supabase.auth.signOut().catch(() => {});
    }
    if (checkRedirectLoop()) {
      window.location.replace(window.MathTreeSession.getLoginUrl('loop_detected'));
      return 'redirected';
    }
    window.location.replace(window.MathTreeSession.getLoginUrl());
    return 'redirected';
  }

  try { sessionStorage.removeItem('mathtree_redirect_guard'); } catch {}
  window.MathTreeSession.startWatcher(supabase);
  return 'authenticated';
}

/**
 * Same guard the legacy pages ran: expired inactivity timer or no session sends the visitor to the login page.
 * Demo mode (?demo=true) is allowed through without a session, as before.
 */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;

    evaluateAuthSession().then((status) => {
      if (live && status === 'authenticated') {
        setReady(true);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT' || (!s && event !== 'INITIAL_SESSION')) {
        if (checkRedirectLoop()) {
          window.location.replace(window.MathTreeSession.getLoginUrl('loop_detected'));
          return;
        }
        window.location.replace(window.MathTreeSession.getLoginUrl());
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
