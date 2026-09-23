import React from 'react';
import { DealRecord, DealMetrics, TaxMetrics } from '../../../lib/math/types';

interface TaxTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  tax: TaxMetrics;
}

export const TaxTab: React.FC<TaxTabProps> = ({ deal, tax }) => {
  const isResidential = deal.asset_class === 'residential' || deal.asset_class === 'multi_family';
  const improvementPct = Math.round((1 - tax.landAllocationPct) * 100);
  const taxRateDisplay = Math.round(tax.effectiveTaxRate * 100);

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800">
        <h2 className="text-base font-black text-white tracking-tight">Tax & Wealth Strategy Schedule</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          MACRS straight-line depreciation schedule ({tax.depYears} Years) and annual income tax shield
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Depreciable Basis</div>
          <div className="text-xl font-black text-white">${tax.depreciableBasis.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{improvementPct}% Improvements Basis</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">MACRS Recovery Period</div>
          <div className="text-xl font-black text-emerald-400">{tax.depYears} Years</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{isResidential ? 'Residential MACRS' : 'Commercial MACRS'}</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Annual Depreciation Deduction</div>
          <div className="text-xl font-black text-white">${tax.annualDepreciation.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Non-Cash Paper Loss</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Estimated Tax Shield</div>
          <div className="text-xl font-black text-emerald-400">${tax.annualTaxShield.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">At {taxRateDisplay}% Combined Bracket</div>
        </div>
      </div>
    </div>
  );
};
