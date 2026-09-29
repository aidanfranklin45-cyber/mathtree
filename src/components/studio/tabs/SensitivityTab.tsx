import React, { useState } from 'react';
import { DealRecord, DealMetrics, SensitivityMatrix } from '../../../lib/math/types';
import { invokeSimulateMonteCarlo, MonteCarloResult } from '../../../lib/supabase/edgeFunctions';
import {
  Loader2,
  Play,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  ShieldAlert,
  Percent,
  RefreshCw,
  Sliders,
} from 'lucide-react';

interface SensitivityTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  sensitivity: SensitivityMatrix | null;
  sensitivityLoading?: boolean;
}

export const SensitivityTab: React.FC<SensitivityTabProps> = ({
  deal,
  sensitivity,
  sensitivityLoading,
}) => {
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcError, setMcError] = useState<string | null>(null);

  // Volatility assumptions
  const [rentGrowthVolPct, setRentGrowthVolPct] = useState(1.5);
  const [vacancyVolPct, setVacancyVolPct] = useState(2.5);
  const [exitCapSpreadBps, setExitCapSpreadBps] = useState(100);

  const handleRunMonteCarlo = async () => {
    setMcLoading(true);
    setMcError(null);
    try {
      const res = await invokeSimulateMonteCarlo(deal.inputs, deal.asset_class, {
        runs: 1000,
        rentGrowthVolPct,
        vacancyVolPct,
        exitCapSpreadBps,
      });
      setMcResult(res);
    } catch (err: any) {
      console.error('Monte Carlo invocation error:', err);
      setMcError(err.message || 'Failed to execute Monte Carlo simulation');
    } finally {
      setMcLoading(false);
    }
  };

  const maxBinCount = mcResult?.histogramBins?.length
    ? Math.max(...mcResult.histogramBins.map((b) => b.count), 1)
    : 1;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-white tracking-tight">Risk & Return Sensitivity Analysis</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            2-Way Cap vs Vacancy Matrix & Edge-Powered 1,000-Iteration Stochastic Monte Carlo Engine
          </p>
        </div>

        <button
          onClick={handleRunMonteCarlo}
          disabled={mcLoading}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center space-x-2 transition shadow-sm disabled:opacity-50"
        >
          {mcLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Simulating 1,000 Runs...</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run Monte Carlo Simulation</span>
            </>
          )}
        </button>
      </div>

      {/* SECTION 1: Monte Carlo Simulation Output */}
      {mcError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
          {mcError}
        </div>
      )}

      {mcResult && (
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-5 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Stochastic Distribution (1,000 Iterations)
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Gaussian Volatility: {rentGrowthVolPct}% Rent σ • {vacancyVolPct}% Vacancy σ • {exitCapSpreadBps}bps Cap Spread
            </span>
          </div>

          {/* Monte Carlo Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] uppercase font-bold text-slate-400">Expected Mean IRR</div>
              <div className="text-lg font-black text-emerald-400 font-mono mt-0.5">
                {mcResult.meanIrr.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Median: {mcResult.medianIrr.toFixed(1)}%</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] uppercase font-bold text-slate-400">Value-at-Risk (95% VaR)</div>
              <div className="text-lg font-black text-amber-400 font-mono mt-0.5">
                {mcResult.var95.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">5th percentile downside floor</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] uppercase font-bold text-slate-400">Probability of Profit</div>
              <div className="text-lg font-black text-emerald-300 font-mono mt-0.5">
                {mcResult.probabilityPositive.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Runs with IRR &gt; 0%</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] uppercase font-bold text-slate-400">Dispersion (Std Dev)</div>
              <div className="text-lg font-black text-white font-mono mt-0.5">
                ±{mcResult.stdDev.toFixed(2)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Range: {mcResult.minIrr.toFixed(1)}% to {mcResult.maxIrr.toFixed(1)}%</div>
            </div>
          </div>

          {/* Adaptive Histogram Chart */}
          <div className="pt-2">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              IRR Frequency Distribution
            </div>
            <div className="h-44 flex items-end gap-1.5 pt-4 pb-1 px-2 bg-slate-950 rounded-xl border border-slate-800">
              {mcResult.histogramBins.map((bin, idx) => {
                const heightPct = Math.round((bin.count / maxBinCount) * 100);
                const isDownside = bin.binEnd < 10;
                return (
                  <div key={idx} className="flex-1 h-full flex flex-col items-center justify-end group relative">
                    {/* Hover Tooltip */}
                    <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] whitespace-nowrap z-20 shadow-lg pointer-events-none">
                      <span className="font-bold text-white">{bin.label}</span>
                      <span className="text-emerald-400">{bin.count} runs ({(bin.count / 10).toFixed(1)}%)</span>
                    </div>

                    <div
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                      className={`w-full rounded-t transition-all ${
                        isDownside
                          ? 'bg-rose-500/80 group-hover:bg-rose-400'
                          : 'bg-emerald-500/80 group-hover:bg-emerald-400'
                      }`}
                    />
                    <span className="text-[8px] font-mono text-slate-500 truncate w-full text-center mt-1">
                      {bin.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: 2D Matrix (Cap Rate vs Vacancy) */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 overflow-x-auto shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            10-Year Forecast IRR Matrix (Exit Cap Rate vs Market Vacancy)
          </h3>
          {sensitivityLoading && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span>Calculating server projections...</span>
            </div>
          )}
        </div>

        {!sensitivity ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin mb-2" />
            <span className="text-xs text-slate-400">Loading baseline sensitivity grid...</span>
          </div>
        ) : (
          <table className="w-full text-center text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                <th className="py-2.5 px-3 text-left">Exit Cap \ Vacancy</th>
                {sensitivity.vacancySteps.map((v) => (
                  <th key={v} className="py-2.5 px-3">
                    {v.toFixed(1)}% Vacancy
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {sensitivity.capRateSteps.map((cap, capIdx) => {
                const row = sensitivity.irrGrid[capIdx] || [];
                return (
                  <tr key={cap} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-3 text-left font-sans font-bold text-white">
                      {cap.toFixed(2)}% Cap Rate
                    </td>
                    {sensitivity.vacancySteps.map((vac, vacIdx) => {
                      const irrVal = row[vacIdx] ?? 0;
                      const isBase =
                        Math.abs(cap - (deal.inputs.exitCapRatePercent || 6.5)) < 0.01 &&
                        Math.abs(vac - (deal.inputs.vacancyRatePercent || 5.0)) < 0.01;

                      return (
                        <td
                          key={vac}
                          className={`py-3 px-3 font-bold ${
                            isBase
                              ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 rounded-lg'
                              : irrVal >= 15
                              ? 'text-emerald-400'
                              : irrVal >= 10
                              ? 'text-white'
                              : 'text-rose-400'
                          }`}
                        >
                          {irrVal.toFixed(1)}%
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
