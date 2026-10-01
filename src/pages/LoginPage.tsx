import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { Lock, Mail, AlertCircle, CheckCircle2, Eye, EyeOff, Shield } from 'lucide-react';

declare global {
  interface Window {
    PasswordCredential?: any;
    MathTreeSession?: {
      resetSession?: () => void;
      startWatcher?: (client: unknown, options?: unknown) => void;
      isTimedOut?: (ms?: number) => boolean;
      logout?: (reason?: string, client?: unknown, redirectUrl?: string) => void;
    };
  }
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const nextUrl = searchParams.get('next') || '/dashboard';

  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // If already authenticated and not timed out, send to destination
  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      if (data.session && !window.MathTreeSession?.isTimedOut?.()) {
        navigate(nextUrl, { replace: true });
      }
    });
    return () => { live = false; };
  }, [navigate, nextUrl]);

  /**
   * Browser Credential Management API
   * Instructs Chrome, Edge, Android, and Chromium password managers
   * to immediately prompt to save or update the password in the user's password store.
   */
  const storeCredentialInBrowser = async (username: string, password: string) => {
    if (typeof window !== 'undefined' && 'PasswordCredential' in window && navigator.credentials) {
      try {
        const cred = new window.PasswordCredential({
          id: username,
          password: password,
          name: username,
        });
        await navigator.credentials.store(cred);
      } catch {
        // Silently continue if the browser disallows programmatic store (e.g. non-HTTPS dev or unsupported)
      }
    }
  };

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Read directly from form elements to support browser/password-manager auto-fill
    // without relying solely on React synthetic onChange events.
    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = (formData.get('username') as string || '').trim();
    const password = (formData.get('password') as string || '');

    if (!email || !password) {
      setErrorMsg('Please enter both institutional email and password.');
      return;
    }

    setLoading(true);
    try {
      if (window.MathTreeSession?.resetSession) {
        window.MathTreeSession.resetSession();
      }
      try {
        localStorage.removeItem('mathtree_demo_mode');
      } catch { /* storage safe */ }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        await storeCredentialInBrowser(email, password);
        if (window.MathTreeSession?.resetSession) {
          window.MathTreeSession.resetSession();
        }
        navigate(nextUrl, { replace: true });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred during sign in.');
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = (formData.get('username') as string || '').trim();
    const password = (formData.get('password') as string || '');

    if (!email || !password) {
      setErrorMsg('Please fill in all fields.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      if (window.MathTreeSession?.resetSession) {
        window.MathTreeSession.resetSession();
      }
      try {
        localStorage.removeItem('mathtree_demo_mode');
      } catch { /* storage safe */ }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        await storeCredentialInBrowser(email, password);
        if (window.MathTreeSession?.resetSession) {
          window.MathTreeSession.resetSession();
        }
        navigate(nextUrl, { replace: true });
      } else {
        // Confirmation email sent
        setLoading(false);
        setSuccessMsg('Verification link sent! Please check your institutional email to confirm your account.');
        // Prompt password manager to remember newly created password
        await storeCredentialInBrowser(email, password);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred during registration.');
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setLoading(true);
    if (window.MathTreeSession?.resetSession) {
      window.MathTreeSession.resetSession();
    }
    try {
      localStorage.removeItem('mathtree_demo_mode');
    } catch { /* storage safe */ }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + nextUrl,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
    }
  };

  const handleDemoMode = () => {
    try {
      localStorage.setItem('mathtree_demo_mode', JSON.stringify({
        demo: true,
        email: 'demo@mathtree.app',
        name: 'Demo Investor',
      }));
    } catch { /* storage safe */ }
    navigate('/dashboard?demo=true', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background ambient glowing gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[350px] bg-emerald-500/10 blur-[130px] pointer-events-none rounded-full" />
      <div className="absolute bottom-10 right-1/4 w-[400px] h-[300px] bg-emerald-600/5 blur-[120px] pointer-events-none rounded-full" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center space-x-3 group focus:outline-none">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-emerald-300 flex items-center justify-center text-slate-950 font-black text-base shadow-lg shadow-emerald-500/20 group-hover:scale-105 transition-transform">
              MT
            </div>
            <span className="font-extrabold text-2xl tracking-tight text-white">MathTree</span>
          </Link>
          <p className="mt-2 text-xs font-medium text-slate-400">
            Institutional Real Estate Underwriting &amp; Portfolio Management
          </p>
        </div>

        {/* Card Container */}
        <div className="bg-[#0D111A] border border-[#1E2230] rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* OAuth Continue with Google */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl border border-[#2A3042] bg-[#121622] hover:bg-[#1A2030] hover:border-slate-600 text-slate-100 font-bold text-xs transition shadow-sm cursor-pointer disabled:opacity-50"
          >
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="relative flex items-center justify-center my-2">
            <div className="border-t border-[#1E2230] w-full" />
            <span className="bg-[#0D111A] px-3 text-[10px] text-slate-500 uppercase tracking-wider font-bold whitespace-nowrap">
              or credentials
            </span>
            <div className="border-t border-[#1E2230] w-full" />
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex bg-[#090A0F] rounded-xl p-1 gap-1 border border-[#1E2230]">
            <button
              type="button"
              onClick={() => { setMode('signin'); setErrorMsg(null); setSuccessMsg(null); }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                mode === 'signin'
                  ? 'bg-[#131824] text-white shadow border border-[#1E2230]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setErrorMsg(null); setSuccessMsg(null); }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                mode === 'signup'
                  ? 'bg-[#131824] text-white shadow border border-[#1E2230]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Feedback Alerts */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* ========================================================
              PASSWORD MANAGER OPTIMIZED FORMS
              1. Uses standard <form> tag with method="post" and action="/login"
              2. Explicit name="username" and autoComplete="username"
              3. Explicit name="password" and autoComplete="current-password" / "new-password"
              4. Standard <button type="submit"> for native submit capture
              ======================================================== */}
          {mode === 'signin' ? (
            <form
              id="form-signin"
              method="post"
              action="/login"
              onSubmit={handleSignIn}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="signin-username"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Institutional Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Mail className="h-4 w-4" />
                  </div>
                  <input
                    id="signin-username"
                    name="username"
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="investor@mathtree.app"
                    className="w-full bg-[#090A0F] border border-[#1E2230] text-slate-100 placeholder-slate-600 text-sm rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="signin-password"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Password
                  </label>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    id="signin-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    className="w-full bg-[#090A0F] border border-[#1E2230] text-slate-100 placeholder-slate-600 text-sm rounded-xl pl-10 pr-10 py-2.5 focus:outline-none focus:border-emerald-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl text-sm font-extrabold text-slate-950 bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 shadow-lg shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 rounded-full border-2 border-slate-950/30 border-t-slate-950 animate-spin" />
                ) : (
                  <span>Sign In →</span>
                )}
              </button>
            </form>
          ) : (
            <form
              id="form-signup"
              method="post"
              action="/login"
              onSubmit={handleSignUp}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="signup-username"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Institutional Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Mail className="h-4 w-4" />
                  </div>
                  <input
                    id="signup-username"
                    name="username"
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="investor@mathtree.app"
                    className="w-full bg-[#090A0F] border border-[#1E2230] text-slate-100 placeholder-slate-600 text-sm rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-password"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Password (min 6 characters)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    id="signup-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="Create strong password"
                    className="w-full bg-[#090A0F] border border-[#1E2230] text-slate-100 placeholder-slate-600 text-sm rounded-xl pl-10 pr-10 py-2.5 focus:outline-none focus:border-emerald-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl text-sm font-extrabold text-slate-950 bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 shadow-lg shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 rounded-full border-2 border-slate-950/30 border-t-slate-950 animate-spin" />
                ) : (
                  <span>Create Account →</span>
                )}
              </button>
            </form>
          )}

          {/* Sandbox Demo Quick Launch */}
          <div className="pt-2 text-center border-t border-[#1E2230]">
            <button
              type="button"
              onClick={handleDemoMode}
              className="text-xs text-emerald-400 hover:underline font-semibold cursor-pointer inline-flex items-center gap-1"
            >
              <span>Or test drive full app in Demo Sandbox</span>
              <span>→</span>
            </button>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 text-center">
            <Shield className="w-3.5 h-3.5 text-slate-600" />
            <span>Encrypted with institutional TLS &amp; standard password manager autofill support.</span>
          </div>
        </div>

        {/* Back to Home Link */}
        <div className="text-center mt-6">
          <Link to="/" className="text-xs text-slate-500 hover:text-slate-400 transition">
            ← Back to MathTree Homepage
          </Link>
        </div>
      </div>
    </div>
  );
};
