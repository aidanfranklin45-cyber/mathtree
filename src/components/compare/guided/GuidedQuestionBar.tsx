import React, { useState } from 'react';
import type { DealRecord } from '../../../lib/math/types';
import { resolveDealDisplayName } from '../../../lib/math/pointInTime';
import {
  QUESTION_FAMILIES,
  GUIDED_QUESTIONS,
  QuestionFamilyId,
  GuidedQuestionId,
  questionsForFamily,
} from '../../../lib/compare/guidedQuestions';
import {
  ShieldCheck,
  Tag,
  Activity,
  Layers,
  HelpCircle,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

interface GuidedQuestionBarProps {
  deals: DealRecord[];
  activeDealId: string;
  activeQuestionId: GuidedQuestionId;
  isCustomMode?: boolean;
  onSelectQuestion: (questionId: GuidedQuestionId) => void;
  onSelectDeal: (dealId: string) => void;
  onToggleCustomMode?: (enabled: boolean) => void;
}

const familyIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldCheck,
  Tag,
  Activity,
  Layers,
};

export const GuidedQuestionBar: React.FC<GuidedQuestionBarProps> = ({
  deals,
  activeDealId,
  activeQuestionId,
  isCustomMode = false,
  onSelectQuestion,
  onSelectDeal,
  onToggleCustomMode,
}) => {
  const currentQuestion = GUIDED_QUESTIONS.find((q) => q.id === activeQuestionId);
  const [activeFamily, setActiveFamily] = useState<QuestionFamilyId>(
    currentQuestion?.familyId || 'financing'
  );

  const familyQuestions = questionsForFamily(activeFamily);
  const activeDeal = deals.find((d) => d.id === activeDealId) || deals[0];

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6 space-y-5 shadow-xl">
      {/* Top Bar: Inquiry Mode Title + Deal Selector + Custom Config Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <HelpCircle className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white flex items-center space-x-2">
              <span>Guided Underwriting Inquiry</span>
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                Question Playbook
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Select an underwriting inquiry to evaluate ground-truth comparisons and generated executive stories
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onToggleCustomMode && (
            <button
              type="button"
              onClick={() => onToggleCustomMode(!isCustomMode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                isCustomMode
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-950/50'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-violet-300 border border-violet-500/30'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isCustomMode ? 'Playbook Mode' : 'Custom Configurator'}</span>
            </button>
          )}

          {/* Deal Picker */}
          {deals.length > 0 && currentQuestion?.targetScope !== 'multi_deal' && (
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Property:</span>
              <select
                value={activeDeal?.id || ''}
                onChange={(e) => onSelectDeal(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-emerald-500 transition max-w-[200px] truncate"
                aria-label="Select target property for underwriting inquiry"
              >
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {resolveDealDisplayName(d)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Decision Families Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {QUESTION_FAMILIES.map((family) => {
          const Icon = familyIcons[family.iconName] || HelpCircle;
          const isSelected = activeFamily === family.id;
          return (
            <button
              key={family.id}
              type="button"
              onClick={() => {
                setActiveFamily(family.id);
                const firstQ = questionsForFamily(family.id)[0];
                if (firstQ) onSelectQuestion(firstQ.id);
              }}
              className={`p-3 rounded-2xl border text-left transition flex flex-col space-y-1.5 ${
                isSelected
                  ? 'bg-slate-800/90 border-emerald-500/60 text-white shadow-md'
                  : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-bold truncate">{family.title}</span>
              </div>
              <p className="text-[10px] text-slate-400 line-clamp-1 leading-snug">{family.shortDesc}</p>
            </button>
          );
        })}
      </div>

      {/* Questions List within Selected Family */}
      <div className="space-y-2 pt-1">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
          Anticipated Questions ({familyQuestions.length}):
        </span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {familyQuestions.map((q) => {
            const isActive = activeQuestionId === q.id;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => onSelectQuestion(q.id)}
                className={`p-3.5 rounded-2xl border text-left transition flex items-start justify-between space-x-3 ${
                  isActive
                    ? 'bg-gradient-to-r from-emerald-950/40 to-slate-900 border-emerald-500/80 text-white shadow-lg ring-1 ring-emerald-500/30'
                    : 'bg-slate-950/60 border-slate-800/90 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    {isActive && <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    <h4 className="text-xs font-bold leading-tight">{q.question}</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">{q.explanation}</p>
                </div>
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    isActive ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
