import React, { useState } from 'react';
import type { DealRecord } from '../../../lib/math/types';
import { resolveDealDisplayName } from '../../../lib/math/pointInTime';
import { formatCurrency } from '../../../lib/format';
import { dealPrice } from '../../../lib/compare/filters';
import { GUIDED_QUESTIONS, GuidedQuestionId } from '../../../lib/compare/guidedQuestions';
import {
  SENSITIVITY_VARIABLES,
  SensitivityVariableKey,
  TargetMetricKey,
  CustomInquiryConfig,
} from '../../../lib/compare/inquiryConfigurator';
import {
  ShieldCheck,
  Tag,
  Activity,
  Sliders,
  Play,
  CheckCircle2,
  Building2,
  ChevronRight,
  ArrowRight,
  HelpCircle,
  Sparkles,
} from 'lucide-react';

interface InquiryDecisionFlowProps {
  deals: DealRecord[];
  activeDeal: DealRecord | null;
  activeQuestionId: GuidedQuestionId;
  isCustomMode: boolean;
  selectedDealId: string | null;
  selectedQuestionId: GuidedQuestionId | null;
  questions: typeof GUIDED_QUESTIONS;
  onSelectDeal: (dealId: string) => void;
  onSelectQuestion: (questionId: GuidedQuestionId) => void;
  onToggleCustomMode: (custom: boolean) => void;
  onExecuteCustom: (config: CustomInquiryConfig) => void;
  onOpenCustomCompareBoard: () => void;
}

export const InquiryDecisionFlow: React.FC<InquiryDecisionFlowProps> = ({
  deals,
  activeDeal,
  activeQuestionId,
  isCustomMode,
  selectedDealId,
  selectedQuestionId,
  questions,
  onSelectDeal,
  onSelectQuestion,
  onToggleCustomMode,
  onExecuteCustom,
  onOpenCustomCompareBoard,
}) => {
  // Custom sensitivity builder state
  const [variableKey, setVariableKey] = useState<SensitivityVariableKey>('expenseRatio');
  const [targetMetric, setTargetMetric] = useState<TargetMetricKey>('dscr');
  const [targetThreshold, setTargetThreshold] = useState<number>(1.25);
  const [customStepsText, setCustomStepsText] = useState<string>('');

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

  const inquiryGoals = [
    {
      id: 'bankability_down_payment' as GuidedQuestionId,
      icon: ShieldCheck,
      badge: 'Lender Financing',
      title: 'Will a bank lend on this property?',
      description: 'Finds the exact down payment needed to satisfy the 1.25x debt coverage (DSCR) covenant.',
      activeRing: 'ring-emerald-500/50 bg-emerald-950/40 border-emerald-500',
    },
    {
      id: 'max_offer_irr' as GuidedQuestionId,
      icon: Tag,
      badge: 'Offer Price & Return',
      title: 'What price can I afford to pay?',
      description: 'Back-solves the maximum purchase price to guarantee your target hurdle return.',
      activeRing: 'ring-cyan-500/50 bg-cyan-950/40 border-cyan-500',
    },
    {
      id: 'rate_and_vacancy_stress' as GuidedQuestionId,
      icon: Activity,
      badge: 'Downside Defense',
      title: 'Can it survive a market shock?',
      description: 'Stress-tests interest rate hikes and vacant units to determine break-even occupancy.',
      activeRing: 'ring-amber-500/50 bg-amber-950/40 border-amber-500',
    },
  ];

  const secondaryInquiries = [
    {
      id: 'expense_ratio_bankability' as GuidedQuestionId,
      label: 'Expense inflation vs. bankability',
    },
    {
      id: 'financial_leverage' as GuidedQuestionId,
      label: 'Is borrowing helping or hurting return? (Leverage spread)',
    },
    {
      id: 'max_offer_dscr' as GuidedQuestionId,
      label: 'Max price to satisfy 1.25x DSCR',
    },
  ];

  // Stage 1: Ask which property they want to look at
  if (!selectedDealId) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900/95 shadow-2xl p-6 sm:p-8 space-y-6 max-w-4xl mx-auto">
        <div className="space-y-1.5 text-center sm:text-left">
          <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-3 py-0.5 rounded-full">
            Underwrite One Property · Step 1
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Which property do you want to look at?
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Select the property you want to underwrite from your active deals:
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-2">
          {deals.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelectDeal(d.id)}
              className="p-5 rounded-2xl border border-slate-800 bg-slate-950/60 hover:border-emerald-500/60 hover:bg-slate-950 transition text-left flex flex-col justify-between space-y-3 group cursor-pointer"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase text-slate-400 block">
                  {d.status || 'Active Project'} · {d.asset_class || d.assetType || 'Commercial'}
                </span>
                <h4 className="text-sm font-black text-white group-hover:text-emerald-300 transition truncate">
                  {resolveDealDisplayName(d)}
                </h4>
                <p className="text-xs font-mono font-bold text-slate-300">
                  Basis: {formatCurrency(dealPrice(d))}
                </p>
              </div>

              <div className="flex items-center space-x-1 text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform pt-1">
                <span>Select this property</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Stage 2: What question are you trying to ask yourself?
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/95 shadow-2xl p-5 sm:p-6 space-y-6">
      {/* Property banner with change button */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              Property Underwritten:
            </span>
            <div className="text-sm font-black text-white truncate max-w-[280px] sm:max-w-[420px]">
              {activeDeal ? resolveDealDisplayName(activeDeal) : 'Select Property'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSelectDeal('')}
          className="text-xs font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950 transition cursor-pointer"
        >
          Change Property
        </button>
      </div>

      {/* The Question Selector */}
      {!isCustomMode ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider block">
                Step 2: Underwriting Query
              </span>
              <h3 className="text-base font-extrabold text-white mt-0.5">
                What question are you trying to ask yourself?
              </h3>
            </div>

            <button
              type="button"
              onClick={() => onToggleCustomMode(true)}
              className="text-xs font-bold text-slate-400 hover:text-slate-200 flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-950 transition cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Sensitivity Solver</span>
            </button>
          </div>

          {/* 3 Core Primary Questions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {inquiryGoals.map((goal) => {
              const isSelected = activeQuestionId === goal.id && selectedQuestionId !== null;
              const Icon = goal.icon;
              return (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => onSelectQuestion(goal.id)}
                  className={`text-left rounded-2xl border p-4 sm:p-5 transition flex flex-col justify-between space-y-3 cursor-pointer ${
                    isSelected
                      ? `${goal.activeRing} ring-2 text-white shadow-lg`
                      : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-slate-900 border-slate-800 text-slate-300">
                        {goal.badge}
                      </span>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <div className="text-sm font-black text-white leading-snug">{goal.title}</div>
                    <p className="text-xs text-slate-400 leading-relaxed">{goal.description}</p>
                  </div>

                  <div className="text-[11px] font-bold text-emerald-400 flex items-center space-x-1 pt-1">
                    <span>{isSelected ? 'Currently Viewing' : 'Select Question'}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Secondary Inquiries & Custom Compare Escape Hatch */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
                Other inquiries:
              </span>
              {secondaryInquiries.map((sec) => {
                const isSelected = activeQuestionId === sec.id && selectedQuestionId !== null;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => onSelectQuestion(sec.id)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
                      isSelected
                        ? 'bg-emerald-950/70 border-emerald-500 text-emerald-200'
                        : 'bg-slate-950/40 border-slate-850 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                    <span>{sec.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Custom compare escape hatch if query doesn't fit */}
            <button
              type="button"
              onClick={onOpenCustomCompareBoard}
              className="text-xs font-semibold text-slate-400 hover:text-white flex items-center space-x-1.5 transition underline cursor-pointer"
            >
              <span>Question doesn't fit? Build custom comparison board</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : (
        /* Advanced Sensitivity Solver */
        <div className="space-y-4 pt-1">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Custom Sensitivity Solver
              </span>
              <p className="text-xs text-slate-400 mt-0.5">
                Stress-test any variable against a loan covenant or hurdle return.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onToggleCustomMode(false)}
              className="text-xs font-bold text-slate-400 hover:text-white px-3 py-1 rounded-lg border border-slate-800 bg-slate-950"
            >
              Back to Standard Questions
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
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
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:border-emerald-500"
              >
                {Object.entries(SENSITIVITY_VARIABLES).map(([k, def]) => (
                  <option key={k} value={k}>
                    {def.label} ({def.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                2. Target Covenant / Hurdle
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
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:border-emerald-500"
              >
                <option value="dscr">Debt Service Coverage (DSCR)</option>
                <option value="cash_on_cash">Cash-on-Cash Return (%)</option>
                <option value="irr">Hurdle IRR (%)</option>
                <option value="cash_flow">Net Cash Flow ($)</option>
              </select>
            </div>

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
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono font-semibold focus:outline-none focus:border-emerald-500"
                />
                <span className="text-slate-400 font-mono font-bold text-xs">
                  {targetMetric === 'dscr' ? 'x' : targetMetric === 'cash_flow' ? '$' : '%'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex items-center space-x-2 flex-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0">
                Steps (Optional):
              </span>
              <input
                type="text"
                placeholder="e.g. 15, 18, 22, 25 (leave blank for auto)"
                value={customStepsText}
                onChange={(e) => setCustomStepsText(e.target.value)}
                className="w-full sm:max-w-xs bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <button
              type="button"
              onClick={handleRunCustom}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-md transition cursor-pointer shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run Sensitivity Solver</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
