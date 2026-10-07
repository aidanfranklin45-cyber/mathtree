import React from 'react';
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
    <div className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950 p-5 sm:p-7 shadow-2xl space-y-6">
      {/* Header with Badge & Promotion CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-sm backdrop-blur-md uppercase tracking-wider">
            <span className={`w-2 h-2 rounded-full ${badgeConfig.dot} animate-pulse`} />
            <span className={badgeConfig.bg.split(' ')[2]}>{verdictBadge.label}</span>
          </div>
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-cyan-400" /> Executive Underwriting Story
          </span>
        </div>

        {onPromoteToBoard && (
          <button
            type="button"
            onClick={onPromoteToBoard}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition ${
              isPromoted
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 cursor-default'
                : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 hover:text-white'
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
      <div className="space-y-2">
        <h3 className="text-lg sm:text-xl font-black text-white tracking-tight leading-snug">
          {headline}
        </h3>
      </div>

      {/* Key Takeaways Grid */}
      {keyTakeaways.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {keyTakeaways.map((takeaway, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3.5 text-xs text-slate-200 flex items-start space-x-2.5 shadow-sm"
            >
              <div className="w-5 h-5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <BadgeIcon className="w-3 h-3" />
              </div>
              <span className="leading-relaxed">{takeaway}</span>
            </div>
          ))}
        </div>
      )}

      {/* Narrative Synthesis Paragraphs */}
      {narrativeParagraphs.length > 0 && (
        <div className="space-y-3 text-xs sm:text-sm text-slate-300 leading-relaxed font-normal bg-slate-950/40 border border-slate-900 p-4 sm:p-5 rounded-2xl">
          {narrativeParagraphs.map((para, idx) => (
            <p key={idx}>{para}</p>
          ))}
        </div>
      )}

      {/* Action Recommendation Box */}
      {actionRecommendation && (
        <div className="rounded-2xl border border-cyan-900/50 bg-cyan-950/20 px-4 py-3.5 flex items-start space-x-3 text-xs text-cyan-200">
          <div className="w-6 h-6 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shrink-0 mt-0.5">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
          <div className="space-y-0.5">
            <span className="font-extrabold uppercase tracking-wider text-[10px] text-cyan-400">
              Underwriting Verdict & Action Recommendation
            </span>
            <p className="text-slate-200 leading-relaxed">{actionRecommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
};
