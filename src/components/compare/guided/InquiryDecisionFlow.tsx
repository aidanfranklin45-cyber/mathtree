import React, { useState } from 'react';
import type { DealRecord } from '../../../lib/math/types';
import { resolveDealDisplayName } from '../../../lib/math/pointInTime';
import { formatCurrency } from '../../../lib/format';
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
  TrendingUp,
} from 'lucide-react';

interface InquiryDecisionFlowProps {
  deals: DealRecord[];
  activeDeal: DealRecord | null;
  activeQuestionId: GuidedQuestionId;
  isCustomMode: boolean;
  questions: typeof GUIDED_QUESTIONS;
  onSelectDeal: (dealId: string) => void;
  onSelectQuestion: (questionId: GuidedQuestionId) => void;
  onToggleCustomMode: (custom: boolean) => void;
  onExecuteCustom: (config: CustomInquiryConfig) => void;
}

export const InquiryDecisionFlow: React.FC<InquiryDecisionFlowProps> = ({
  deals,
  activeDeal,
  activeQuestionId,
  isCustomMode,
  questions,
  onSelectDeal,
  onSelectQuestion,
  onToggleCustomMode,
  onExecuteCustom,
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

  // Group questions into 3 plain-English inquiry goals
  const bankabilityQ = questions.find((q) => q.id === 'bankability_down_payment');
  const expenseQ = questions.find((q) => q.id === 'expense_ratio_bankability');
  const offerPriceQ = questions.find((q) => q.id === 'max_offer_irr') || questions.find((q) => q.id === 'max_offer_dscr');
  const leverageQ = questions.find((q) => q.id === 'financial_leverage');
  const stressQ = questions.find((q) => q.id === 'rate_and_vacancy_stress');

  const inquiryGoals = [
    {
      id: 'bankability_down_payment' as GuidedQuestionId,
      icon: ShieldCheck,
      badge: 'Lender Financing',
      title: 'Will a bank lend on this property?',
      description: 'Finds the exact down payment needed to satisfy the 1.25x debt coverage (DSCR) covenant.',
      accent: 'border-emerald-500/40 text-emerald-400 bg-emerald-950/20',
      activeRing: 'ring-emerald-500/50 bg-emerald-950/40 border-emerald-500',
    },
    {
      id: 'max_offer_irr' as GuidedQuestionId,
      icon: Tag,
      badge: 'Offer Price & Return',
      title: 'What price can I afford to pay?',
      description: 'Back-solves the maximum purchase price to guarantee your target hurdle return.',
      accent: 'border-cyan-500/40 text-cyan-400 bg-cyan-950/20',
      activeRing: 'ring-cyan-500/50 bg-cyan-950/40 border-cyan-500',
    },
    {
      id: 'rate_and_vacancy_stress' as GuidedQuestionId,
      icon: Activity,
      badge: 'Downside Defense',
      title: 'Can it survive a market shock?',
      description: 'Stress-tests interest rate hikes and vacant units to determine break-even occupancy.',
      accent: 'border-amber-500/40 text-amber-400 bg-amber-950/20',
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

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/95 shadow-2xl p-5 sm:p-6 space-y-6">
      {/* Step 1 in Single Deal Underwriting: Select the Property */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Step 1: Property Underwritten
            </span>
            <div className="flex items-center space-x-2 pt-0.5">
              <select
                value={activeDeal?.id || ''}
                onChange={(e) => onSelectDeal(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-sm font-black text-white hover:border-emerald-500 focus:outline-none cursor-pointer max-w-[280px] sm:max-w-[400px] truncate"
                aria-label="Select property being underwritten"
              >
                {deals.map((d) => (
                  <option key={d.id} value={d.id} className="bg-slate-900 text-white">
                    {resolveDealDisplayName(d)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Mode Toggle: Standard Discovery vs Advanced Custom Config */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 self-start sm:self-center">
          <button
            type="button"
            onClick={() => onToggleCustomMode(false)}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              !isCustomMode ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Underwriting Inquiries</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleCustomMode(true)}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              isCustomMode ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Custom Math Solver</span>
          </button>
        </div>
      </div>

      {/* Step 2: What are you trying to find out? */}
      {!isCustomMode ? (
        <div className="space-y-4">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Step 2: What are you trying to find out?
            </span>
            <h3 className="text-base font-extrabold text-white mt-0.5">
              Choose your underwriting objective:
            </h3>
          </div>

          {/* The 3 Core Primary Questions (Human Language) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {inquiryGoals.map((goal) => {
              const isSelected = activeQuestionId === goal.id;
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
                    <span>{isSelected ? 'Currently Analyzing' : 'Analyze This Question'}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Secondary Specific Inquiries Strip */}
          <div className="pt-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
              Specific Inquiries:
            </span>
            {secondaryInquiries.map((sec) => {
              const isSelected = activeQuestionId === sec.id;
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
        </div>
      ) : (
        /* Advanced Custom Sensitivity Solver */
        <div className="space-y-4 pt-1">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Step 2: Configure Custom Hypothesis
            </span>
            <p className="text-xs text-slate-400 mt-0.5">
              Target a specific loan covenant or return hurdle against any deal variable.
            </p>
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
