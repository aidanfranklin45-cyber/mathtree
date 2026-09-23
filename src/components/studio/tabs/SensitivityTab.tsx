import React from 'react';
import { DealRecord, DealMetrics, SensitivityMatrix } from '../../../lib/math/types';
import { Loader2 } from 'lucide-react';

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
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800">
        <h2 className="text-base font-black text-white tracking-tight">Risk & Returns Sensitivity Matrix</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Dynamic 2-way stress test of Exit Cap Rate vs. Market Vacancy Rate on 10-Year IRR
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 overflow-x-auto shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            10-Year Forecast IRR Matrix (Cap Rate vs Vacancy)
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
            <span className="text-xs text-slate-400">Generating sensitivity matrix on Edge Function...</span>
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
