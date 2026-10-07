import React from 'react';
import { ArrowRight, Bookmark, Layers, Building2, HelpCircle } from 'lucide-react';
import type { DealRecord } from '../../lib/math/types';

interface CompareStarterProps {
  loading: boolean;
  deals: DealRecord[];
  savedCount: number;
  readyMadeCount: number;
  draftSummary: string | null;
  onPickDeals: () => void;
  onUnderwriteOneDeal: () => void;
  onOpenSaved: () => void;
  onContinueDraft: () => void;
}

export const CompareStarter: React.FC<CompareStarterProps> = ({
  loading,
  deals,
  savedCount,
  readyMadeCount,
  draftSummary,
  onPickDeals,
  onUnderwriteOneDeal,
  onOpenSaved,
  onContinueDraft,
}) => {
  const noDeals = !loading && deals.length === 0;

  return (
    <section className="rounded-3xl border border-slate-900 bg-gradient-to-b from-slate-900/60 to-slate-900/20 px-4 py-8 sm:px-8 sm:py-12 space-y-8">
      <div className="text-center space-y-2 max-w-xl mx-auto">
        <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-3 py-1 rounded-full">
          Progressive Underwriting
        </span>
        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
          What are you analyzing today?
        </h2>
        <p className="text-xs sm:text-sm text-slate-400">
          Break down complex underwriting decisions into clear, bite-sized steps. Choose your path below:
        </p>
      </div>

      {noDeals ? (
        <div className="text-center py-8 text-sm text-slate-400 max-w-md mx-auto bg-slate-950/50 rounded-2xl border border-slate-800 p-6">
          <p>You have no deals yet. Create a project from the portfolio page, then come back to compare.</p>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* The Core 2-Way Fork */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Fork Option A: Compare Different Properties */}
            <button
              type="button"
              disabled={loading}
              onClick={onPickDeals}
              className="text-left rounded-3xl border border-slate-800 bg-slate-900/80 hover:border-emerald-500/60 hover:bg-slate-900 p-6 sm:p-7 transition shadow-xl group flex flex-col justify-between cursor-pointer space-y-5"
            >
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Layers className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                    Pipeline Allocation
                  </span>
                  <h3 className="text-lg font-black text-white group-hover:text-emerald-300 transition">
                    Compare Different Properties
                  </h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Pick two or more properties to rank side by side. See how they stack up on purchase price, stabilized NOI, cash yield, and IRR in a clean table.
                </p>
              </div>

              <div className="pt-2 flex items-center space-x-2 text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform">
                <span>Select Properties</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </button>

            {/* Fork Option B: Underwrite One Property */}
            <button
              type="button"
              disabled={loading}
              onClick={onUnderwriteOneDeal}
              className="text-left rounded-3xl border border-emerald-500/40 bg-gradient-to-b from-emerald-950/30 to-slate-900/90 hover:border-emerald-400 hover:bg-slate-900 p-6 sm:p-7 transition shadow-2xl group flex flex-col justify-between cursor-pointer space-y-5"
            >
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider block">
                    Defensible Inquiry & Covenants
                  </span>
                  <h3 className="text-lg font-black text-white group-hover:text-cyan-300 transition">
                    Underwrite One Property
                  </h3>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Explore one specific deal in depth. Determine what down payment satisfies bank covenants, back-solve maximum offer price, and verify audit integrity.
                </p>
              </div>

              <div className="pt-2 flex items-center space-x-2 text-xs font-bold text-cyan-300 group-hover:translate-x-1 transition-transform">
                <span>Solve Questions for a Property</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </button>
          </div>

          {/* Secondary Options: Saved Boards / Recent Draft */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-slate-400">
            <button
              type="button"
              onClick={onOpenSaved}
              className="hover:text-white flex items-center space-x-2 transition px-3 py-1.5 rounded-xl hover:bg-slate-800"
            >
              <Bookmark className="w-3.5 h-3.5 text-violet-400" />
              <span>
                Saved comparisons ({savedCount}) · Ready-made presets ({readyMadeCount})
              </span>
            </button>

            {draftSummary && (
              <div className="flex items-center space-x-2">
                <span className="text-slate-500">Unsaved draft:</span>
                <button
                  type="button"
                  onClick={onContinueDraft}
                  className="font-bold text-emerald-400 hover:text-emerald-300 underline"
                >
                  Continue ({draftSummary})
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
