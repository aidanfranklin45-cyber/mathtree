import React, { useState } from 'react';
import { ArrowRight, Bookmark, Layers, Scale, Rows3 } from 'lucide-react';
import type { DealRecord } from '../../lib/math/types';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import { formatCurrency } from '../../lib/format';
import { dealPrice } from '../../lib/compare/filters';

interface CompareStarterProps {
  loading: boolean;
  deals: DealRecord[];
  savedCount: number;
  readyMadeCount: number;
  /** The unsaved board from last time, if any. */
  draftSummary: string | null;
  onPickDeals: () => void;
  onPickScenarioDeal: (deal: DealRecord) => void;
  onOpenSaved: () => void;
  onContinueDraft: () => void;
  onOpenInquiry: () => void;
}

const card = 'text-left rounded-2xl border p-5 transition flex flex-col gap-3 min-h-[148px]';

export const CompareStarter: React.FC<CompareStarterProps> = ({
  loading,
  deals,
  savedCount,
  readyMadeCount,
  draftSummary,
  onPickDeals,
  onPickScenarioDeal,
  onOpenSaved,
  onContinueDraft,
  onOpenInquiry,
}) => {
  const [choosing, setChoosing] = useState(false);
  const noDeals = !loading && deals.length === 0;

  return (
    <section className="rounded-3xl border border-slate-900 bg-gradient-to-b from-slate-900/70 to-slate-900/30 px-4 py-8 sm:px-8 sm:py-12 space-y-8">
      <div className="text-center space-y-2 max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mx-auto flex items-center justify-center">
          <Scale className="w-6 h-6" />
        </div>
        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">What do you want to compare?</h2>
        <p className="text-sm text-slate-400">
          Start with a guided underwriting inquiry to discover answers and comparative stories, or build a custom comparison board.
        </p>
      </div>

      {noDeals ? (
        <p className="text-center text-sm text-slate-400">You have no deals yet. Create a project from the portfolio page, then come back to compare.</p>
      ) : (
        <div className="space-y-4 max-w-5xl mx-auto">
          {/* Primary Featured Card: Guided Underwriting Inquiry */}
          <button
            type="button"
            disabled={loading}
            onClick={onOpenInquiry}
            className="w-full text-left rounded-3xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-slate-900/80 to-cyan-950/30 p-6 sm:p-7 transition hover:border-emerald-400/70 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
          >
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2.5 py-0.5 rounded-full">
                  Recommended · Guided Inquiries
                </span>
                <span className="text-xs text-slate-400">First-Principles Question Playbook</span>
              </div>
              <h3 className="text-lg sm:text-xl font-black text-white group-hover:text-emerald-300 transition">
                Answer an Underwriting Question & Read the Comparative Story
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                Anticipate lender covenants, find the down payment that makes a deal bankable, solve for maximum offer strike prices, and evaluate positive vs. negative leverage spreads.
              </p>
            </div>
            <div className="shrink-0 flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-xs group-hover:bg-emerald-400 transition">
              <span>Explore Inquiries</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </button>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
            <button type="button" disabled={loading} onClick={onPickDeals} className={`${card} border-slate-800 bg-slate-900/50 hover:border-emerald-600/60 disabled:opacity-50`}>
              <Layers className="w-6 h-6 text-emerald-400" />
              <span>
                <span className="block text-base font-extrabold text-white">Deals side by side</span>
                <span className="block text-xs text-slate-400 mt-1">Pick two or more properties and see their returns, financing and cash flow in one table.</span>
              </span>
              <span className="mt-auto text-xs font-bold text-emerald-400 flex items-center gap-1">Choose deals <ArrowRight className="w-3.5 h-3.5" /></span>
            </button>

            <div className={`${card} border-slate-800 bg-slate-900/50`}>
              <Rows3 className="w-6 h-6 text-cyan-400" />
              <span>
                <span className="block text-base font-extrabold text-white">One deal, different scenarios</span>
                <span className="block text-xs text-slate-400 mt-1">Live, bull and bear cases, saved runs, remodels and the acquisition baseline.</span>
              </span>
              {choosing ? (
                <select
                  autoFocus
                  defaultValue=""
                  onChange={(e) => { const d = deals.find((x) => x.id === e.target.value); if (d) onPickScenarioDeal(d); }}
                  className="mt-auto w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                  aria-label="Choose a deal"
                >
                  <option value="" disabled>Choose a deal…</option>
                  {deals.map((d) => <option key={d.id} value={d.id}>{resolveDealDisplayName(d)} · {formatCurrency(dealPrice(d))}</option>)}
                </select>
              ) : (
                <button type="button" disabled={loading} onClick={() => setChoosing(true)} className="mt-auto text-xs font-bold text-cyan-400 flex items-center gap-1 disabled:opacity-50 text-left">Choose a deal <ArrowRight className="w-3.5 h-3.5" /></button>
              )}
            </div>

            <button type="button" onClick={onOpenSaved} className={`${card} border-slate-800 bg-slate-900/50 hover:border-violet-600/50`}>
              <Bookmark className="w-6 h-6 text-violet-400" />
              <span>
                <span className="block text-base font-extrabold text-white">Open a saved comparison</span>
                <span className="block text-xs text-slate-400 mt-1">
                  {savedCount > 0 ? `${savedCount} saved, plus ` : ''}{readyMadeCount} ready-made {readyMadeCount === 1 ? 'view' : 'views'} like "Pipeline ranked by IRR".
                </span>
              </span>
              <span className="mt-auto text-xs font-bold text-violet-400 flex items-center gap-1">Browse <ArrowRight className="w-3.5 h-3.5" /></span>
            </button>
          </div>
        </div>
      )}

      {draftSummary && (
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
          <span className="text-xs text-slate-300">Continue where you left off: <strong className="text-white">{draftSummary}</strong></span>
          <button type="button" onClick={onContinueDraft} className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-100">Reopen</button>
        </div>
      )}
    </section>
  );
};
