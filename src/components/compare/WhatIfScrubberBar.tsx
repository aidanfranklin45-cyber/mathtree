import React, { useState } from 'react';
import { DealRecord, DealInputs } from '../../lib/math/types';
import { formatCurrency } from '../../lib/format';
import { SlidersHorizontal, Plus, RotateCcw, Sparkles } from 'lucide-react';

interface WhatIfScrubberBarProps {
  deal: DealRecord;
  onAddWhatIfColumn: (overrides: Partial<DealInputs>, customName: string) => void;
}

export const WhatIfScrubberBar: React.FC<WhatIfScrubberBarProps> = ({ deal, onAddWhatIfColumn }) => {
  const [isOpen, setIsOpen] = useState(false);

  // The scrubber moves the deal's own stated figures; nothing here is assumed
  const basePrice = Number(deal.purchase_price || deal.inputs?.purchasePrice);
  const baseDownPct = Number(deal.inputs?.downPaymentPercent);
  const baseRate = Number(deal.inputs?.interestRate);
  const baseRent = Number(deal.inputs?.grossRentAnnual || (deal.inputs?.monthlyRent ? deal.inputs.monthlyRent * 12 : 0));
  const baseVacancy = Number(deal.inputs?.vacancyRate);

  const [price, setPrice] = useState(basePrice);
  const [downPaymentPct, setDownPaymentPct] = useState(baseDownPct);
  const [interestRate, setInterestRate] = useState(baseRate);
  const [rentDeltaPct, setRentDeltaPct] = useState(0);
  const [vacancyRate, setVacancyRate] = useState(baseVacancy);
  const [scenarioName, setScenarioName] = useState('What-If Custom Case');

  const resetToBaseline = () => {
    setPrice(basePrice);
    setDownPaymentPct(baseDownPct);
    setInterestRate(baseRate);
    setRentDeltaPct(0);
    setVacancyRate(baseVacancy);
    setScenarioName('What-If Custom Case');
  };

  const handleApply = () => {
    const adjustedRent = Math.round(baseRent * (1 + rentDeltaPct / 100));
    const overrides: Partial<DealInputs> = {
      purchasePrice: price,
      downPaymentPercent: downPaymentPct,
      interestRate,
      grossRentAnnual: adjustedRent,
      monthlyRent: Math.round(adjustedRent / 12),
      vacancyRate,
    };

    onAddWhatIfColumn(overrides, scenarioName.trim() || 'What-If Simulation');
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-lg transition">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 select-none"
      >
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-black text-white flex items-center space-x-2">
              <span>Interactive What-If Simulation Sandbox</span>
              <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.2 rounded-full">
                Pure In-Memory
              </span>
            </h4>
            <p className="text-[11px] text-slate-400">
              Dial in custom purchase price, interest rate, and rent assumptions without saving to the database
            </p>
          </div>
        </div>
        <button
          type="button"
          className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
        >
          {isOpen ? 'Collapse Controls ▴' : 'Expand Controls ▾'}
        </button>
      </div>

      {isOpen && (
        <div className="p-4 sm:p-5 border-t border-slate-800/80 bg-slate-950/60 space-y-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Purchase Basis Scrubber */}
            <div className="space-y-1.5 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-bold text-slate-400 uppercase tracking-wider">Purchase Price</span>
                <span className="font-mono font-bold text-emerald-400">{formatCurrency(price)}</span>
              </div>
              <input
                type="range"
                min={Math.round(basePrice * 0.5)}
                max={Math.round(basePrice * 1.5)}
                step={5000}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>-50%</span>
                <span>Base</span>
                <span>+50%</span>
              </div>
            </div>

            {/* Down Payment % Scrubber */}
            <div className="space-y-1.5 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-bold text-slate-400 uppercase tracking-wider">Down Payment %</span>
                <span className="font-mono font-bold text-cyan-400">{downPaymentPct.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={downPaymentPct}
                onChange={(e) => setDownPaymentPct(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>0% (100% Debt)</span>
                <span>50%</span>
              </div>
            </div>

            {/* Interest Rate % Scrubber */}
            <div className="space-y-1.5 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-bold text-slate-400 uppercase tracking-wider">Interest Rate</span>
                <span className="font-mono font-bold text-amber-400">{interestRate.toFixed(2)}%</span>
              </div>
              <input
                type="range"
                min={3.0}
                max={12.0}
                step={0.125}
                value={interestRate}
                onChange={(e) => setInterestRate(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>3.0%</span>
                <span>12.0%</span>
              </div>
            </div>

            {/* Rent Adjustment % Scrubber */}
            <div className="space-y-1.5 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-bold text-slate-400 uppercase tracking-wider">Rent Growth / Shock</span>
                <span className={`font-mono font-bold ${rentDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {rentDeltaPct >= 0 ? `+${rentDeltaPct}%` : `${rentDeltaPct}%`}
                </span>
              </div>
              <input
                type="range"
                min={-25}
                max={25}
                step={1}
                value={rentDeltaPct}
                onChange={(e) => setRentDeltaPct(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>-25%</span>
                <span>0%</span>
                <span>+25%</span>
              </div>
            </div>

            {/* Vacancy % Scrubber */}
            <div className="space-y-1.5 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-bold text-slate-400 uppercase tracking-wider">Vacancy Rate</span>
                <span className="font-mono font-bold text-violet-400">{vacancyRate.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={0.5}
                value={vacancyRate}
                onChange={(e) => setVacancyRate(Number(e.target.value))}
                className="w-full accent-violet-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>0%</span>
                <span>20%</span>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <label className="text-xs font-bold text-slate-400 whitespace-nowrap">Name:</label>
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="e.g. Higher Debt / Discount Case"
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 w-full sm:w-64"
              />
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={resetToBaseline}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex items-center space-x-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="flex-1 sm:flex-none justify-center px-4 py-1.5 rounded-xl text-xs font-black text-slate-950 bg-gradient-to-r from-emerald-400 to-teal-300 hover:from-emerald-300 hover:to-teal-200 transition flex items-center space-x-1.5 shadow-md shadow-emerald-500/20"
              >
                <Plus className="w-3.5 h-3.5" />
                <span><span className="sm:hidden">Add Column</span><span className="hidden sm:inline">Add as Comparison Column</span></span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
