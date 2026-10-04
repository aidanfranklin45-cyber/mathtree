import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase/client';
import { operationsPrefetchProps, prefetchOperations } from '../../lib/prefetchRoutes';

interface AppHeaderProps {
  active: 'portfolio' | 'operations' | 'compare';
  /** Handlers for modal hubs and tools. */
  onOpenAlerts?: () => void;
  onOpenProfile?: () => void;
  onExportPortfolio?: () => void;
  alertCount?: number;
  /** Page-specific buttons rendered before the account dropdown (e.g. Operations' Alert Emails / Add Lease). */
  extraActions?: React.ReactNode;
  /** Hide the account/portfolio dropdown on pages where those tools are not needed (they live on the Dashboard). */
  hideAccountMenu?: boolean;
}

/** Clears local session residue then signs out (same keys the legacy pages cleared). */
export async function signOutOfMathTree(): Promise<void> {
  window.MathTreeSession.clearSessionStorage();
  try { await supabase.auth.signOut(); } catch { /* fall through to redirect */ }
  window.location.replace(window.MathTreeSession.getLoginUrl('logout'));
}

const navBase = 'px-3 py-1.5 rounded-lg text-xs transition';

export const AppHeader: React.FC<AppHeaderProps> = ({
  active,
  onOpenAlerts,
  onOpenProfile,
  onExportPortfolio,
  alertCount = 0,
  extraActions,
  hideAccountMenu = false,
}) => {
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const totalNotifications = alertCount > 0 ? alertCount : 0;

  // Close dropdown on outside click or Escape key
  // Fetch the Operations chunk once the browser is idle so the first click is instant
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(prefetchOperations) : window.setTimeout(prefetchOperations, 1500);
    return () => { if (!w.requestIdleCallback) window.clearTimeout(id); };
  }, []);

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAccountMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  const handleMenuAction = (action?: () => void) => {
    setIsAccountMenuOpen(false);
    triggerRef.current?.focus();
    action?.();
  };

  return (
    <header className="border-b border-emerald-950 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50">
      <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 min-h-16 h-auto py-2 sm:py-0 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand */}
        <Link to="/dashboard" className="flex items-center space-x-3 shrink-0">
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-gradient-to-tr from-brand-700 to-brand-400 flex items-center justify-center shadow-lg shadow-brand-500/20 relative group">
            <div className="absolute inset-0 rounded-xl bg-brand-400 blur-sm opacity-50 group-hover:opacity-75 transition-opacity" />
            <svg className="h-6 w-6 sm:h-7 sm:w-7 text-white relative z-10 filter drop-shadow-[0_0_4px_rgba(255,255,255,0.8)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 21V12" strokeLinecap="round" />
              <path d="M12 15C12 15 9 12 7 12M12 13C12 13 15 10 17 10" strokeLinecap="round" />
              <path d="M7 12C7 12 5 10 5 8M7 12C7 12 9 10 9 8" strokeLinecap="round" />
              <path d="M17 10C17 10 15 8 15 6M17 10C17 10 19 8 19 6" strokeLinecap="round" />
              <circle cx="5" cy="8" r="1.5" fill="currentColor" />
              <circle cx="9" cy="8" r="1.5" fill="currentColor" />
              <circle cx="15" cy="6" r="1.5" fill="currentColor" />
              <circle cx="19" cy="6" r="1.5" fill="currentColor" />
              <path d="M11.5 5h1M12 4.5v1" strokeWidth="1.2" />
            </svg>
          </div>
          <div>
            <span className="text-lg sm:text-xl font-black tracking-tight bg-gradient-to-r from-white via-emerald-100 to-emerald-400 bg-clip-text text-transparent">MathTree</span>
            <span className="text-[11px] sm:text-xs block text-emerald-400 font-bold uppercase tracking-wider">Portfolio &amp; Pipeline</span>
          </div>
        </Link>

        {/* Tri-hub switcher: Reordered to 1. Portfolio & Pipeline, 2. Property Management, 3. Compare */}
        <nav className="hidden md:flex items-center space-x-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <Link
            to="/"
            className={active === 'portfolio'
              ? `${navBase} font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 shadow-sm`
              : `${navBase} font-semibold text-slate-400 hover:text-white`}
          >
            Portfolio &amp; Pipeline
          </Link>
          <Link
            to="/operations"
            {...operationsPrefetchProps}
            className={active === 'operations'
              ? `${navBase} font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 shadow-sm flex items-center space-x-1.5`
              : `${navBase} font-semibold text-slate-400 hover:text-white flex items-center space-x-1.5`}
          >
            <span>Property Management</span>
            {active === 'portfolio' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
          </Link>
          <Link
            to="/compare"
            className={active === 'compare'
              ? `${navBase} font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 shadow-sm flex items-center space-x-1.5`
              : `${navBase} font-semibold text-slate-400 hover:text-white flex items-center space-x-1.5`}
          >
            <span>Compare</span>
            {active === 'compare' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </Link>
        </nav>

        {/* Actions & Consolidated Dropdown Menu */}
        <div className="flex items-center space-x-1.5 sm:space-x-2.5 min-w-0">
          {/* Mobile switcher pills: Property Management followed by Compare */}
          <Link
            to="/operations"
            {...operationsPrefetchProps}
            className={active === 'operations'
              ? "md:hidden flex items-center space-x-1 py-1.5 px-2 rounded-xl text-xs font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 transition"
              : "md:hidden flex items-center space-x-1 py-1.5 px-2 rounded-xl text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 transition"}
          >
            <span>Operations</span>
          </Link>
          <Link
            to="/compare"
            className={active === 'compare'
              ? "md:hidden flex items-center space-x-1 py-1.5 px-2 rounded-xl text-xs font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 transition"
              : "md:hidden flex items-center space-x-1 py-1.5 px-2 rounded-xl text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 transition"}
          >
            <span>Compare</span>
          </Link>

          {/* Page-specific actions (e.g. Operations settings) */}
          {extraActions}

          {/* Consolidated Menu Dropdown (right by the Exit tab) */}
          {!hideAccountMenu && (
          <div className="relative" ref={menuRef}>
            <button
              ref={triggerRef}
              onClick={() => setIsAccountMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={isAccountMenuOpen}
              aria-label="Account and Portfolio Menu"
              className={`relative flex items-center space-x-1.5 py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-semibold transition border ${
                isAccountMenuOpen
                  ? 'bg-slate-800 text-white border-emerald-500/50 shadow-md'
                  : 'text-slate-300 hover:text-white bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
              title="Account, Network & Portfolio Actions"
            >
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span className="hidden sm:inline">Menu</span>
              <svg className={`w-3 h-3 text-slate-400 transition-transform ${isAccountMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>

              {totalNotifications > 0 && (
                <span className="-top-1 -right-1 absolute flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-extrabold text-white animate-pulse">
                  {totalNotifications > 9 ? '9+' : totalNotifications}
                </span>
              )}
            </button>

            {isAccountMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-64 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
              >
                {onOpenProfile && (
                  <button
                    role="menuitem"
                    onClick={() => handleMenuAction(onOpenProfile)}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white flex items-center justify-between transition group"
                  >
                    <div className="flex items-center space-x-2.5">
                      <svg className="w-4 h-4 text-brand-400 shrink-0 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>Investor Profile</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">Hurdle</span>
                  </button>
                )}

                {onOpenAlerts && (
                  <button
                    role="menuitem"
                    onClick={() => handleMenuAction(onOpenAlerts)}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white flex items-center justify-between transition group"
                  >
                    <div className="flex items-center space-x-2.5">
                      <svg className="w-4 h-4 text-amber-400 shrink-0 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                      <span>Needs attention</span>
                    </div>
                    {alertCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-[9px] font-extrabold text-white animate-pulse">
                        {alertCount}
                      </span>
                    )}
                  </button>
                )}

                {onExportPortfolio && (
                  <button
                    role="menuitem"
                    onClick={() => handleMenuAction(onExportPortfolio)}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white flex items-center justify-between transition group"
                  >
                    <div className="flex items-center space-x-2.5">
                      <svg className="w-4 h-4 text-rose-400 shrink-0 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      <span>Export Portfolio</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">PDF Brief</span>
                  </button>
                )}
              </div>
            )}
          </div>
          )}

          {/* Exit / Sign Out Button (placed directly beside the dropdown menu) */}
          <button
            onClick={() => { void signOutOfMathTree(); }}
            className="py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/40 transition shrink-0"
            title="Sign Out of MathTree"
          >
            <span className="hidden xs:inline">Sign Out</span>
            <span className="xs:hidden">Exit</span>
          </button>
        </div>
      </div>
    </header>
  );
};
