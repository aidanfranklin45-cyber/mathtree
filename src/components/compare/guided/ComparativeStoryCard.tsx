import React, { useState } from 'react';
import type { ComparativeStory } from '../../../lib/compare/comparativeStories';
import {
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  FileCheck,
  FileText,
  Building,
  Info,
} from 'lucide-react';

interface ComparativeStoryCardProps {
  story: ComparativeStory;
  onPromoteToBoard?: () => void;
  isPromoted?: boolean;
}

export const ComparativeStoryCard: React.FC<ComparativeStoryCardProps> = ({
  story,
  onPromoteToBoard,
  isPromoted = false,
}) => {
  const [showLenderDefense, setShowLenderDefense] = useState(false);
  const { verdictBadge, headline, keyTakeaways, narrativeParagraphs, actionRecommendation, covenantData } = story;

  // Status visual mapping
  const badgeConfig = (() => {
    switch (verdictBadge.status) {
      case 'bankable':
      case 'accretive':
      case 'resilient':
        return {
          bg: 'bg-emerald-950/80 border-emerald-700/80 text-emerald-300',
          dot: 'bg-emerald-400',
          Icon: ShieldCheck,
        };
      case 'tight':
        return {
          bg: 'bg-amber-950/80 border-amber-700/80 text-amber-300',
          dot: 'bg-amber-400',
          Icon: AlertTriangle,
        };
      case 'unbankable':
      case 'dilutive':
      case 'vulnerable':
      default:
        return {
          bg: 'bg-rose-950/80 border-rose-700/80 text-rose-300',
          dot: 'bg-rose-400',
          Icon: AlertOctagon,
        };
    }
  })();

  const BadgeIcon = badgeConfig.Icon;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 sm:p-7 shadow-2xl space-y-5">
      {/* 1. Header: Status Tag + Board Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-black border shadow-sm uppercase tracking-wider">
            <span className={`w-2 h-2 rounded-full ${badgeConfig.dot}`} />
            <span className={badgeConfig.bg.split(' ')[2]}>{verdictBadge.label}</span>
          </div>
          <span className="text-xs font-semibold text-slate-400">
            Step 3: Underwriting Result
          </span>
        </div>

        {onPromoteToBoard && (
          <button
            type="button"
            onClick={onPromoteToBoard}
            className={`px-4 py-2 rounded-xl text-xs font-black flex items-center space-x-2 transition cursor-pointer shadow-md ${
              isPromoted
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 cursor-default'
                : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white'
            }`}
          >
            {isPromoted ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Loaded in Matrix Table</span>
              </>
            ) : (
              <>
                <span>Load in Matrix Table</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        )}
      </div>

      {/* 2. The Core Bottom-Line Answer (Bold, High Clarity) */}
      <div className="space-y-2">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
          Underwriting Bottom Line:
        </span>
        <h3 className="text-lg sm:text-xl font-black text-white tracking-tight leading-snug">
          {headline}
        </h3>
      </div>

      {/* 3. Key Takeaway Stat Strip (Bite-sized bullets) */}
      {keyTakeaways.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {keyTakeaways.map((takeaway, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs text-slate-200 flex items-start space-x-3"
            >
              <div className="w-5 h-5 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <BadgeIcon className="w-3.5 h-3.5" />
              </div>
              <span className="leading-relaxed font-medium">{takeaway}</span>
            </div>
          ))}
        </div>
      )}

      {/* 4. Action Recommendation Strip */}
      {actionRecommendation && (
        <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/30 px-4 py-3.5 flex items-start space-x-3 text-xs text-emerald-200">
          <div className="w-5 h-5 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
          <div className="space-y-0.5">
            <span className="font-extrabold uppercase tracking-wider text-[10px] text-emerald-400 block">
              Underwriter Recommendation
            </span>
            <p className="text-slate-100 leading-relaxed font-semibold">{actionRecommendation}</p>
          </div>
        </div>
      )}

      {/* 5. Lender Defense & Assumption Audit Trail (Progressive Disclosure) */}
      {story.assumptionAuditTrail && story.assumptionAuditTrail.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLenderDefense(!showLenderDefense)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-900/60 transition cursor-pointer select-none"
          >
            <div className="flex items-center space-x-3">
              <div className="w-7 h-7 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center shrink-0">
                <FileCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-black text-white">
                    Lender Underwriting Justification & Audit Trail
                  </span>
                  <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                    Defensible Math
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Verify ground truths, stated rent roll figures, debt formulas, and covenant calculations for lenders.
                </span>
              </div>
            </div>
            <span className="text-xs font-bold text-violet-300 shrink-0 ml-2">
              {showLenderDefense ? 'Hide Audit ▴' : 'Inspect Audit ▾'}
            </span>
          </button>

          {showLenderDefense && (
            <div className="p-5 border-t border-slate-800 space-y-4 animate-in fade-in duration-150">
              {/* Optional Narrative Synthesis for underwriter review */}
              {narrativeParagraphs.length > 0 && (
                <div className="space-y-2 text-xs text-slate-300 leading-relaxed bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center space-x-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <span>Executive Underwriting Narrative:</span>
                  </div>
                  {narrativeParagraphs.map((para, idx) => (
                    <p key={idx}>{para}</p>
                  ))}
                </div>
              )}

              {/* Verified Stated Assumptions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {story.assumptionAuditTrail.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-3.5 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-slate-200">{item.label}</span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          item.source === 'hypothesis'
                            ? 'bg-sky-950/80 border-sky-800/80 text-sky-300'
                            : item.source === 'document'
                              ? 'bg-cyan-950/80 border-cyan-800/80 text-cyan-300'
                              : item.source === 'profile'
                                ? 'bg-violet-950/80 border-violet-800/80 text-violet-300'
                                : item.source === 'county'
                                  ? 'bg-amber-950/80 border-amber-800/80 text-amber-300'
                                  : 'bg-emerald-950/80 border-emerald-800/80 text-emerald-300'
                        }`}
                      >
                        {item.sourceBadge}
                      </span>
                    </div>

                    <div className="flex items-baseline space-x-2 font-mono">
                      <span className="text-sm font-bold text-white">{item.currentValue}</span>
                      {item.baselineValue && (
                        <span className="text-[10px] text-slate-500 line-through">
                          Baseline: {item.baselineValue}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                      {item.rationale}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
