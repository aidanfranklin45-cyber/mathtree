import React from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase/client';

interface AppHeaderProps {
  active: 'portfolio' | 'operations';
  /** Buttons render only when their handler exists, so nothing in the header is a dead control. */
  onOpenAlerts?: () => void;
  onOpenCollaborators?: () => void;
  onOpenProfile?: () => void;
  alertCount?: number;
  collaboratorInviteCount?: number;
  /** Page-specific buttons rendered after Alerts (e.g. Operations' Alert Emails / Add Lease). */
  extraActions?: React.ReactNode;
}

/** Clears local session residue then signs out (same keys the legacy pages cleared). */
export async function signOutOfMathTree(): Promise<void> {
  window.MathTreeSession.clearSessionStorage();
  try { await supabase.auth.signOut(); } catch { /* fall through to redirect */ }
  window.location.replace(window.MathTreeSession.getLoginUrl('logout'));
}

const navBase = 'px-3 py-1.5 rounded-lg text-xs transition';

export const AppHeader: React.FC<AppHeaderProps> = ({
  active, onOpenAlerts, onOpenCollaborators, onOpenProfile, alertCount = 0, collaboratorInviteCount = 0, extraActions,
}) => (
  <header className="border-b border-emerald-950 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50">
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-16 h-auto py-2 sm:py-0 flex items-center justify-between gap-2 sm:gap-4">
      {/* Brand */}
      <Link to="/dashboard" className="flex items-center space-x-2.5 sm:space-x-3 shrink-0">
        <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-gradient-to-tr from-brand-700 to-brand-400 flex items-center justify-center shadow-lg shadow-brand-500/20 relative group">
          <div className="absolute inset-0 rounded-xl bg-brand-400 blur-sm opacity-50 group-hover:opacity-75 transition-opacity" />
          <svg className="h-5 w-5 sm:h-6 sm:w-6 text-white relative z-10 filter drop-shadow-[0_0_4px_rgba(255,255,255,0.8)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          <span className="text-base sm:text-lg font-extrabold tracking-tight bg-gradient-to-r from-white via-emerald-100 to-emerald-400 bg-clip-text text-transparent">MathTree</span>
          <span className="text-[10px] sm:text-xs block text-emerald-500 font-semibold uppercase tracking-wider">Portfolio &amp; Pipeline</span>
        </div>
      </Link>

      {/* Dual hub switcher */}
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
          className={active === 'operations'
            ? `${navBase} font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 shadow-sm flex items-center space-x-1.5`
            : `${navBase} font-semibold text-slate-400 hover:text-white flex items-center space-x-1.5`}
        >
          <span>Property Management</span>
          {active !== 'operations' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </Link>
      </nav>

      {/* Account & actions */}
      <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
        <Link
          to="/operations"
          className="md:hidden flex items-center space-x-1 py-1.5 px-2 rounded-xl text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 transition"
        >
          <span>Operations</span>
        </Link>

        {onOpenAlerts && (
          <button
            onClick={onOpenAlerts}
            className="relative flex items-center space-x-1.5 py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition"
            title="Action Center &amp; Alerts"
          >
            <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span className="hidden sm:inline">Alerts</span>
            {alertCount > 0 && (
              <span className="-top-1 -right-1 absolute flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-extrabold text-white animate-pulse">{alertCount}</span>
            )}
          </button>
        )}

        {extraActions}

        {onOpenCollaborators && (
          <button
            onClick={onOpenCollaborators}
            aria-label="Collaborator Network & Deal Sharing"
            className="relative flex items-center space-x-1.5 py-1.5 px-2 sm:px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-cyan-500/50 transition"
            title="Collaborator Network & Deal Sharing"
          >
            <svg className="w-3.5 h-3.5 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span className="hidden sm:inline">Collaborators</span>
            {collaboratorInviteCount > 0 && (
              <span className="-top-1 -right-1 absolute flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-cyan-500 text-[9px] font-extrabold text-slate-950 animate-pulse">{collaboratorInviteCount}</span>
            )}
          </button>
        )}

        {onOpenProfile && (
          <button
            onClick={onOpenProfile}
            aria-label="Investor Profile & Underwriting Hurdle Rate"
            className="flex items-center space-x-1.5 py-1.5 px-2 sm:px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition"
            title="Investor Profile & Underwriting Hurdle Rate"
          >
            <svg className="w-3.5 h-3.5 text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="hidden sm:inline">Profile</span>
          </button>
        )}

        <button
          onClick={() => { void signOutOfMathTree(); }}
          className="py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/40 transition shrink-0"
        >
          <span className="hidden xs:inline">Sign Out</span>
          <span className="xs:hidden">Exit</span>
        </button>
      </div>
    </div>
  </header>
);
