import React, { useState } from 'react';
import type { DealRecord } from '../../../lib/math/types';
import { resolveDealDisplayName } from '../../../lib/math/pointInTime';
import { GUIDED_QUESTIONS, GuidedQuestionId } from '../../../lib/compare/guidedQuestions';
import {
  SENSITIVITY_VARIABLES,
  SensitivityVariableKey,
  TargetMetricKey,
  CustomInquiryConfig,
} from '../../../lib/compare/inquiryConfigurator';
import {
  HelpCircle,
  Sliders,
  Play,
  RotateCcw,
  CheckCircle2,
  ChevronDown,
  Building,
} from 'lucide-react';

interface InquiryCommandBarProps {
  deals: DealRecord[];
  activeDeal: DealRecord | null;
  activeQuestionId: GuidedQuestionId;
  isCustomMode: boolean;
  onSelectDeal: (dealId: string) => void;
  onSelectQuestion: (questionId: GuidedQuestionId) => void;
  onToggleCustomMode: (custom: boolean) => void;
  onExecuteCustom: (config: CustomInquiryConfig) => void;
}

export const InquiryCommandBar: React.FC<InquiryCommandBarProps> = ({
  deals,
  activeDeal,
  activeQuestionId,
  isCustomMode,
  onSelectDeal,
  onSelectQuestion,
  onToggleCustomMode,
  onExecuteCustom,
}) => {
  // Custom builder states
  const [variableKey, setVariableKey] = useState<SensitivityVariableKey>('expenseRatio');
  const [targetMetric, setTargetMetric] = useState<TargetMetricKey>('dscr');
  const [targetThreshold, setTargetThreshold] = useState<number>(1.25);
  const [customStepsText, setCustomStepsText] = useState<string>('');

  const currentQuestion = GUIDED_QUESTIONS.find((q) => q.id === activeQuestionId);

  const handleRunCustom = () => {
    if (!activeDeal) return;
    let customValues: number[] | undefined = undefined;
    if (customStepsText.trim()) {
      const parsed = customStepsText
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n) && n >= 0);
      if (parsed.length > 0) {
        customValues = parsed;
      }
    }
    onExecuteCustom({
      dealId: activeDeal.id,
      variableKey,
      targetMetric,
      targetThreshold,
      values: customValues,
    });
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl overflow-hidden divide-y divide-slate-800/80">
      {/* 1. Bar Header: Deal Selector + Mode Toggle */}
      <div className="px-4 py-3 sm:px-5 flex flex-wrap items-center justify-between gap-3 bg-slate-950/40">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Building className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              Target Property
            </span>
            <select
              value={activeDeal?.id || ''}
              onChange={(e) => onSelectDeal(e.target.value)}
              className="bg-transparent text-sm font-black text-white hover:text-emerald-300 focus:outline-none cursor-pointer max-w-[280px] sm:max-w-[360px] truncate"
              aria-label="Select target property for underwriting inquiry"
            >
              {deals.map((d) => (
                <option key={d.id} value={d.id} className="bg-slate-900 text-white">
                  {resolveDealDisplayName(d)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mode switcher: Playbook vs Custom */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => onToggleCustomMode(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              !isCustomMode
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Playbook Questions</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleCustomMode(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              isCustomMode
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Custom Question</span>
          </button>
        </div>
      </div>

      {/* 2. Control Row: Either Question Pill Carousel or Custom Configurator */}
      <div className="p-4 sm:p-5">
        {!isCustomMode ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Select Underwriting Inquiry:
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                {GUIDED_QUESTIONS.length} canonical questions
              </span>
            </div>

            {/* Clean Pill Carousel / Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {GUIDED_QUESTIONS.filter((q) => q.targetScope !== 'multi_deal').map((q) => {
                const isSelected = activeQuestionId === q.id;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => onSelectQuestion(q.id)}
                    className={`p-3 rounded-xl border text-left transition flex items-start justify-between space-x-2 ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-500/80 text-white shadow-md ring-1 ring-emerald-500/30'
                        : 'bg-slate-950/40 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-xs font-bold truncate">{q.shortPrompt}</div>
                      <p className="text-[11px] text-slate-400 line-clamp-1 leading-snug">{q.question}</p>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {/* Variable to test */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  1. Test Variable
                </label>
                <select
                  value={variableKey}
                  onChange={(e) => {
                    const k = e.target.value as SensitivityVariableKey;
                    setVariableKey(k);
                    if (k === 'expenseRatio' || k === 'downPaymentPercent') {
                      setTargetMetric('dscr');
                      setTargetThreshold(1.25);
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:border-emerald-500 transition"
                >
                  {Object.entries(SENSITIVITY_VARIABLES).map(([k, def]) => (
                    <option key={k} value={k}>
                      {def.label} ({def.unit})
                    </option>
                  ))}
                </select>
              </div>

              {/* Metric to protect */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  2. Hurdle / Covenant
                </label>
                <select
                  value={targetMetric}
                  onChange={(e) => {
                    const m = e.target.value as TargetMetricKey;
                    setTargetMetric(m);
                    if (m === 'dscr') setTargetThreshold(1.25);
                    else if (m === 'cash_on_cash') setTargetThreshold(8.0);
                    else if (m === 'irr') setTargetThreshold(15.0);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:border-emerald-500 transition"
                >
                  <option value="dscr">Debt Service Coverage (DSCR)</option>
                  <option value="cash_on_cash">Cash-on-Cash Return (%)</option>
                  <option value="irr">Hurdle IRR (%)</option>
                  <option value="cash_flow">Net Operating Cash Flow ($)</option>
                </select>
              </div>

              {/* Target Threshold */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  3. Target Level
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    step={targetMetric === 'dscr' ? '0.05' : '0.5'}
                    value={targetThreshold}
                    onChange={(e) => setTargetThreshold(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono font-semibold focus:outline-none focus:border-emerald-500 transition"
                  />
                  <span className="text-slate-400 font-mono font-bold text-xs">
                    {targetMetric === 'dscr' ? 'x' : targetMetric === 'cash_flow' ? '$' : '%'}
                  </span>
                </div>
              </div>
            </div>

            {/* Steps & Run CTA */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-slate-800/60">
              <div className="flex items-center space-x-2 flex-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0">
                  Steps (Optional):
                </span>
                <input
                  type="text"
                  placeholder="e.g. 15, 18, 22, 25 (leave blank for auto steps)"
                  value={customStepsText}
                  onChange={(e) => setCustomStepsText(e.target.value)}
                  className="w-full sm:max-w-xs bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <button
                type="button"
                onClick={handleRunCustom}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-md transition cursor-pointer shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Sensitivity Solver</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
