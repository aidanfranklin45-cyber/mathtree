import React, { Component, ErrorInfo, ReactNode } from 'react';
import { isChunkLoadError, triggerChunkReload } from '../../lib/lazyWithRetry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      isChunkError: false,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[MathTree] Uncaught application error:', error, errorInfo);
    if (isChunkLoadError(error)) {
      triggerChunkReload();
    }
  }

  handleReload = (): void => {
    try {
      sessionStorage.removeItem('mathtree_chunk_reload_guard');
    } catch {}
    window.location.reload();
  };

  handleGoDashboard = (): void => {
    window.location.href = '/dashboard';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const isChunk = this.state.isChunkError;

      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 selection:bg-brand-500/30 selection:text-brand-200">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl text-center space-y-5">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-2xl font-black">
              {isChunk ? '⚡' : '⚠️'}
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white tracking-tight">
                {isChunk ? 'New Version Available' : 'Something went wrong'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {isChunk
                  ? 'A new version of MathTree was published while your session was active. Please reload to load the latest application update.'
                  : 'An unexpected error occurred while loading this view. You can reload the page or return to the dashboard.'}
              </p>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/20"
              >
                Reload MathTree
              </button>
              <button
                type="button"
                onClick={this.handleGoDashboard}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition"
              >
                Go to Dashboard
              </button>
            </div>

            {this.state.error?.message && !isChunk && (
              <details className="text-left text-[11px] text-slate-500 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 cursor-pointer overflow-hidden">
                <summary className="font-mono text-slate-400 focus:outline-none">Technical Details</summary>
                <div className="mt-2 font-mono break-all text-rose-400">
                  {this.state.error.message}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
