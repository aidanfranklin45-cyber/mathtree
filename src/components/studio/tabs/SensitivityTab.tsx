import React from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import { calculateProjections } from '../../../lib/math/calculator';

interface SensitivityTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
}

const VACANCY_STEPS = [0, 2.5, 5.0, 7.5, 10.0];
const CAP_RATE_STEPS = [5.5, 6.0, 6.5, 7.0, 7.5];

export const SensitivityTab: React.FC<SensitivityTabProps> = ({ deal, metrics }) => {
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800">
        <h2 className="text-base font-black text-white tracking-tight">Risk & Returns Sensitivity Matrix</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Dynamic 2-way stress test of Exit Cap Rate vs. Market Vacancy Rate on 10-Year IRR
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 overflow-x-auto shadow-sm">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">
          10-Year Forecast IRR Matrix (Cap Rate vs Vacancy)
        </h3>

        <table className="w-full text-center text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
              <th className="py-2.5 px-3 text-left">Exit Cap \ Vacancy</th>
              {VACANCY_STEPS.map((v) => (
                <th key={v} className="py-2.5 px-3">
                  {v.toFixed(1)}% Vacancy
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {CAP_RATE_STEPS.map((cap) => {
              return (
                <tr key={cap} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-3 text-left font-sans font-bold text-white">
                    {cap.toFixed(2)}% Cap Rate
                  </td>
                  {VACANCY_STEPS.map((vac) => {
                    const simInputs = { ...deal.inputs, exitCapRatePercent: cap, vacancyRatePercent: vac };
                    const res = calculateProjections(deal.asset_class, simInputs);
                    const isBase =
                      Math.abs(cap - (deal.inputs.exitCapRatePercent || 6.5)) < 0.01 &&
                      Math.abs(vac - (deal.inputs.vacancyRatePercent || 5.0)) < 0.01;

                    return (
                      <td
                        key={vac}
                        className={`py-3 px-3 font-bold ${
                          isBase
                            ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 rounded-lg'
                            : res.irr >= 15
                            ? 'text-emerald-400'
                            : res.irr >= 10
                            ? 'text-white'
                            : 'text-rose-400'
                        }`}
                      >
                        {res.irr.toFixed(1)}%
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
