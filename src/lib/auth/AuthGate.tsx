import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';

declare global {
  interface Window {
    /** Loaded from /session.js (30-minute inactivity logout + warning modal), shared with the static login page. */
    MathTreeSession?: {
      isTimedOut: (ms?: number) => boolean;
      logout: (reason?: string, client?: unknown, redirectUrl?: string) => void;
      startWatcher: (client: unknown, options?: unknown) => void;
    };
  }
}

const LOGIN_URL = '/index.html';

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
      session.logout('timeout', supabase);
      return;
    }

    if (isDemoVisit()) {
      session?.startWatcher(null);
      setReady(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      if (!data.session) {
        window.location.replace(LOGIN_URL);
        return;
      }
      session?.startWatcher(supabase);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT' || (!s && event !== 'INITIAL_SESSION')) window.location.replace(LOGIN_URL);
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
