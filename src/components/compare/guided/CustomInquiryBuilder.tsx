import React, { useState } from 'react';
import type { DealRecord } from '../../../lib/math/types';
import { resolveDealDisplayName } from '../../../lib/math/pointInTime';
import {
  SENSITIVITY_VARIABLES,
  SensitivityVariableKey,
  TargetMetricKey,
  CustomInquiryConfig,
} from '../../../lib/compare/inquiryConfigurator';
import { Sliders, Play, RotateCcw, Sparkles } from 'lucide-react';

interface CustomInquiryBuilderProps {
  deal: DealRecord;
  onExecute: (config: CustomInquiryConfig) => void;
  isBusy?: boolean;
}

export const CustomInquiryBuilder: React.FC<CustomInquiryBuilderProps> = ({
  deal,
  onExecute,
  isBusy = false,
}) => {
  const [variableKey, setVariableKey] = useState<SensitivityVariableKey>('expenseRatio');
  const [targetMetric, setTargetMetric] = useState<TargetMetricKey>('dscr');
  const [targetThreshold, setTargetThreshold] = useState<number>(1.25);
  const [customStepsText, setCustomStepsText] = useState<string>('');

  const currentVarDef = SENSITIVITY_VARIABLES[variableKey];

  const handleRun = () => {
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

    onExecute({
      dealId: deal.id,
      variableKey,
      targetMetric,
      targetThreshold,
      values: customValues,
    });
  };

  const handleResetToPresets = () => {
    setCustomStepsText('');
    if (variableKey === 'expenseRatio') {
      setTargetMetric('dscr');
      setTargetThreshold(1.25);
    } else if (variableKey === 'downPaymentPercent') {
      setTargetMetric('dscr');
      setTargetThreshold(1.25);
    } else {
      setTargetMetric('cash_on_cash');
      setTargetThreshold(8.0);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6 space-y-5 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center shrink-0">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-white flex items-center space-x-2">
              <span>Underwriting Inquiry Configurator</span>
              <span className="text-[10px] font-bold text-violet-400 bg-violet-950/60 border border-violet-800/40 px-2 py-0.5 rounded-full">
                Custom Question Solver
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Configure any hypothesis or sensitivity question against{' '}
              <span className="text-slate-200 font-semibold">{resolveDealDisplayName(deal)}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleResetToPresets}
          className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1.5 transition self-start sm:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Defaults</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        {/* 1. Variable to Test */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            1. Test Variable (Hypothesis)
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
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:border-violet-500 transition"
          >
            {Object.entries(SENSITIVITY_VARIABLES).map(([k, def]) => (
              <option key={k} value={k}>
                {def.label} ({def.unit})
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-400 leading-tight">{currentVarDef.description}</p>
        </div>

        {/* 2. Target Performance Metric */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            2. Target Decision Metric
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
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:border-violet-500 transition"
          >
            <option value="dscr">Debt Service Coverage (DSCR)</option>
            <option value="cash_on_cash">Year-1 Cash-on-Cash Return (%)</option>
            <option value="irr">Unlevered/Levered IRR (%)</option>
            <option value="cash_flow">Operating Net Cash Flow ($)</option>
          </select>
          <p className="text-[10px] text-slate-400 leading-tight">
            The benchmark covenant or return threshold being evaluated
          </p>
        </div>

        {/* 3. Covenant Threshold */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            3. Target Hurdle Threshold
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="number"
              step={targetMetric === 'dscr' ? '0.05' : '0.5'}
              value={targetThreshold}
              onChange={(e) => setTargetThreshold(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono font-semibold focus:outline-none focus:border-violet-500 transition"
            />
            <span className="text-slate-400 font-mono font-bold">
              {targetMetric === 'dscr' ? 'x' : targetMetric === 'cash_flow' ? '$' : '%'}
            </span>
          </div>
          <p className="text-[10px] text-slate-400 leading-tight">
            {targetMetric === 'dscr'
              ? 'Institutional lenders typically require 1.20x - 1.25x'
              : 'Target hurdle for equity underwriting'}
          </p>
        </div>
      </div>

      {/* Custom Values Override (Optional) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
        <div className="space-y-1 flex-1">
          <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
            Custom Step Values (Optional, comma-separated):
          </label>
          <input
            type="text"
            placeholder={`e.g. 15, 18, 22, 25, 30`}
            value={customStepsText}
            onChange={(e) => setCustomStepsText(e.target.value)}
            className="w-full sm:max-w-md bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500 font-mono"
          />
        </div>

        <button
          type="button"
          onClick={handleRun}
          disabled={isBusy}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white font-bold text-xs shadow-lg shadow-violet-900/30 flex items-center justify-center space-x-2 transition cursor-pointer"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Execute Inquiry Solver</span>
        </button>
      </div>
    </div>
  );
};
