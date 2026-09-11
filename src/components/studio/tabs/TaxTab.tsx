import React from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';

interface TaxTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
}

export const TaxTab: React.FC<TaxTabProps> = ({ deal, metrics }) => {
  const isResidential = deal.asset_class === 'residential' || deal.asset_class === 'multi_family';
  const depYears = isResidential ? 27.5 : 39.0;
  const price = deal.inputs.purchasePrice || 0;
  const landPct = 0.20; // 20% land allocation
  const depreciableBasis = price * (1 - landPct);
  const annualDepreciation = depreciableBasis / depYears;
  const taxRate = 0.35; // combined effective federal & state rate
  const annualTaxShield = annualDepreciation * taxRate;

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800">
        <h2 className="text-base font-black text-white tracking-tight">Tax & Wealth Strategy Schedule</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          MACRS straight-line depreciation schedule ({depYears} Years) and annual income tax shield
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Depreciable Basis</div>
          <div className="text-xl font-black text-white">${Math.round(depreciableBasis).toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">80% Improvements Basis</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">MACRS Recovery Period</div>
          <div className="text-xl font-black text-emerald-400">{depYears} Years</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{isResidential ? 'Residential MACRS' : 'Commercial MACRS'}</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Annual Depreciation Deduction</div>
          <div className="text-xl font-black text-white">${Math.round(annualDepreciation).toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Non-Cash Paper Loss</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Estimated Tax Shield</div>
          <div className="text-xl font-black text-emerald-400">${Math.round(annualTaxShield).toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">At 35% Combined Bracket</div>
        </div>
      </div>
    </div>
  );
};
