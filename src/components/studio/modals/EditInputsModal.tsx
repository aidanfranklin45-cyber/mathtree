import React, { useState } from 'react';
import { DealRecord, DealInputs } from '../../../lib/math/types';
import { X, Save, Check } from 'lucide-react';

interface EditInputsModalProps {
  isOpen: boolean;
  deal: DealRecord;
  onClose: () => void;
  onUpdateInputs: (inputs: Partial<DealInputs>) => void;
  onSaveDeal: () => Promise<boolean>;
}

export const EditInputsModal: React.FC<EditInputsModalProps> = ({
  isOpen,
  deal,
  onClose,
  onUpdateInputs,
  onSaveDeal,
}) => {
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const inputs = deal.inputs;

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSaveDeal();
    setSaving(false);
    if (ok) {
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-sm flex justify-end transition-opacity">
      <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900/95 z-10">
          <div>
            <h3 className="text-sm font-black text-white">Edit Underwriting Assumptions</h3>
            <p className="text-xs text-slate-400">Live recalculation of pro-forma returns</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Inputs Body */}
        <div className="p-5 space-y-5 flex-1 text-xs">
          {/* Purchase Price */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-bold">
              <span className="text-slate-300">Purchase Price ($)</span>
              <span className="text-emerald-400">${inputs.purchasePrice.toLocaleString()}</span>
            </div>
            <input
              type="number"
              step="10000"
              value={inputs.purchasePrice}
              onChange={(e) => onUpdateInputs({ purchasePrice: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Down Payment % */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-bold">
              <span className="text-slate-300">Down Payment ({inputs.downPaymentPercent}%)</span>
              <span className="text-emerald-400">
                ${Math.round((inputs.purchasePrice * (inputs.downPaymentPercent || 25)) / 100).toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={inputs.downPaymentPercent || 25}
              onChange={(e) => onUpdateInputs({ downPaymentPercent: parseFloat(e.target.value) || 0 })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          {/* Interest Rate % */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-bold">
              <span className="text-slate-300">Interest Rate (%)</span>
              <span className="text-emerald-400">{(inputs.interestRate || 6.5).toFixed(2)}%</span>
            </div>
            <input
              type="number"
              step="0.05"
              value={inputs.interestRate || 6.5}
              onChange={(e) => onUpdateInputs({ interestRate: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Gross Monthly Rent */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-bold">
              <span className="text-slate-300">Gross Monthly Rent ($)</span>
              <span className="text-emerald-400">
                ${(inputs.monthlyRent || (inputs.grossRentAnnual ? inputs.grossRentAnnual / 12 : 0)).toLocaleString()}
              </span>
            </div>
            <input
              type="number"
              step="100"
              value={inputs.monthlyRent || (inputs.grossRentAnnual ? inputs.grossRentAnnual / 12 : 0)}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                onUpdateInputs({ monthlyRent: val, grossRentAnnual: val * 12 });
              }}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Operating Expenses */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-bold">
              <span className="text-slate-300">Annual OpEx ($)</span>
              <span className="text-rose-400">${(inputs.operatingExpensesAnnual || 0).toLocaleString()}</span>
            </div>
            <input
              type="number"
              step="500"
              value={inputs.operatingExpensesAnnual || 0}
              onChange={(e) => onUpdateInputs({ operatingExpensesAnnual: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Vacancy Rate % */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-bold">
              <span className="text-slate-300">Market Vacancy ({inputs.vacancyRatePercent}%)</span>
              <span className="text-slate-400">{inputs.vacancyRatePercent}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              step="0.5"
              value={inputs.vacancyRatePercent || 5.0}
              onChange={(e) => onUpdateInputs({ vacancyRatePercent: parseFloat(e.target.value) || 0 })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          {/* Exit Cap Rate % */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-bold">
              <span className="text-slate-300">Exit Cap Rate (%)</span>
              <span className="text-emerald-400">{inputs.exitCapRatePercent}%</span>
            </div>
            <input
              type="number"
              step="0.25"
              value={inputs.exitCapRatePercent || 6.5}
              onChange={(e) => onUpdateInputs({ exitCapRatePercent: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900 sticky bottom-0 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs transition"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shadow-sm ${
              savedSuccess
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950'
            }`}
          >
            {savedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Saved to Supabase!</span>
              </>
            ) : saving ? (
              <span>Saving...</span>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save to Cloud</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
