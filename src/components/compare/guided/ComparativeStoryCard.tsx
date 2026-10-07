import React, { useState } from 'react';
import type { ComparativeStory } from '../../../lib/compare/comparativeStories';
import {
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  TrendingUp,
  TrendingDown,
  Activity,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  FileCheck,
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
  const [showAudit, setShowAudit] = useState(false);
  const { verdictBadge, headline, keyTakeaways, narrativeParagraphs, actionRecommendation } = story;

  // Status visual mapping
  const badgeConfig = (() => {
    switch (verdictBadge.status) {
      case 'bankable':
      case 'accretive':
      case 'resilient':
        return {
          bg: 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300',
          dot: 'bg-emerald-400',
          Icon: ShieldCheck,
        };
      case 'tight':
        return {
          bg: 'bg-amber-950/60 border-amber-800/60 text-amber-300',
          dot: 'bg-amber-400',
          Icon: AlertTriangle,
        };
      case 'unbankable':
      case 'dilutive':
      case 'vulnerable':
      default:
        return {
          bg: 'bg-rose-950/60 border-rose-800/60 text-rose-300',
          dot: 'bg-rose-400',
          Icon: AlertOctagon,
        };
    }
  })();

  const BadgeIcon = badgeConfig.Icon;

  return (
    <div className="rounded-2xl border border-slate-850 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-5">
      {/* Header with Badge & Promotion CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/60">
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-sm uppercase tracking-wider">
            <span className={`w-2 h-2 rounded-full ${badgeConfig.dot}`} />
            <span className={badgeConfig.bg.split(' ')[2]}>{verdictBadge.label}</span>
          </div>
          <span className="text-xs font-semibold text-slate-400">
            Executive Underwriting Brief
          </span>
        </div>

        {onPromoteToBoard && (
          <button
            type="button"
            onClick={onPromoteToBoard}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition ${
              isPromoted
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 cursor-default'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
            }`}
          >
            {isPromoted ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Loaded in Matrix Table</span>
              </>
            ) : (
              <>
                <span>Load in Matrix Table</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Headline */}
      <div className="space-y-1">
        <h3 className="text-base sm:text-lg font-black text-white tracking-tight leading-snug">
          {headline}
        </h3>
      </div>

      {/* Key Takeaways Grid */}
      {keyTakeaways.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {keyTakeaways.map((takeaway, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200 flex items-start space-x-2.5"
            >
              <div className="w-4 h-4 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <BadgeIcon className="w-3 h-3" />
              </div>
              <span className="leading-relaxed">{takeaway}</span>
            </div>
          ))}
        </div>
      )}

      {/* Narrative Synthesis Paragraphs */}
      {narrativeParagraphs.length > 0 && (
        <div className="space-y-2.5 text-xs text-slate-300 leading-relaxed bg-slate-950/50 border border-slate-800/80 p-4 rounded-xl">
          {narrativeParagraphs.map((para, idx) => (
            <p key={idx}>{para}</p>
          ))}
        </div>
      )}

      {/* Action Recommendation Box */}
      {actionRecommendation && (
        <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-4 py-3 flex items-start space-x-3 text-xs text-emerald-200">
          <div className="w-5 h-5 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
          <div className="space-y-0.5">
            <span className="font-extrabold uppercase tracking-wider text-[10px] text-emerald-400">
              Action Recommendation
            </span>
            <p className="text-slate-200 leading-relaxed">{actionRecommendation}</p>
          </div>
        </div>
      )}

      {/* Assumption Provenance & Audit Trail */}
      {story.assumptionAuditTrail && story.assumptionAuditTrail.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAudit(!showAudit)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-900/60 transition select-none"
          >
            <div className="flex items-center space-x-2.5">
              <div className="w-6 h-6 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center">
                <FileCheck className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-xs font-bold text-white block">
                  Assumption Audit & Provenance Trail
                </span>
                <span className="text-[10px] text-slate-400 block">
                  {story.assumptionAuditTrail.length} inputs verified · Ground-truth sources & hypothesis justifications
                </span>
              </div>
            </div>
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
              {showAudit ? 'Hide Audit ▴' : 'View Audit ▾'}
            </span>
          </button>

          {showAudit && (
            <div className="p-4 border-t border-slate-800 space-y-2.5 animate-in fade-in duration-150">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {story.assumptionAuditTrail.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-800/80 bg-slate-900/80 p-3 text-xs space-y-1.5"
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

                    <p className="text-[11px] text-slate-400 leading-normal font-sans">
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
