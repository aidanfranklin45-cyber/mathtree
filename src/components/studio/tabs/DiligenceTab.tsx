import React from 'react';
import { DealRecord, DealMetrics, DealInputs } from '../../../lib/math/types';
import { AssumptionsLedger } from '../AssumptionsLedger';
import { DealDocumentsList } from '../DealDocumentsList';
import { DiligenceDisclosures } from '../DiligenceDisclosures';

interface DiligenceTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  onPatchDeal: (inputsPatch: Partial<DealInputs>) => Promise<boolean>;
  /** Opens Edit Inputs, where a figure is changed for this property only. */
  onOpenEdit: () => void;
  /** Opens the reader to add documents to this property. */
  onAddDocuments: () => void;
  /** Changes when original files are stored, so the list reads itself again. */
  docsVersion: number;
}

const CHECKLIST = [
  { id: 'assessor_records', label: 'County Assessor & Parcel Roll Records', detail: 'Assessed valuation, parcel boundary data, and tax history verified' },
  { id: 'rent_roll_leases', label: 'Rent Roll & Lease Agreement Terms', detail: 'Contractual rent rates, escalation clauses, and tenant lease structures' },
  { id: 'operating_history', label: 'Historical Operating Statements (T12)', detail: 'Operating revenues, utility histories, and expense reconciliations' },
  { id: 'debt_terms', label: 'Debt Financing & Capital Structure Terms', detail: 'Loan amortization schedule, interest rate, and DSCR covenants' },
  { id: 'physical_condition', label: 'Physical Asset Specs & Condition Assessment', detail: 'Building square footage, mechanical systems, and capital reserve needs' },
  { id: 'insurance_policy', label: 'Property & Casualty Insurance Coverage', detail: 'Hazard and liability coverage terms, replacement value, and annual premium' },
  { id: 'title_zoning', label: 'Zoning & Municipal Land Use Records', detail: 'Permitted land use codes, recorded easements, and legal description' },
  { id: 'tax_cost_seg', label: 'Tax Depreciation & Basis Allocation', detail: 'Land vs improvement basis split for annual cost recovery and deductions' },
];

export const DiligenceTab: React.FC<DiligenceTabProps> = ({ deal, metrics, onPatchDeal, onOpenEdit, onAddDocuments, docsVersion }) => {
  const inputs: Record<string, any> = deal.inputs || {};
  const checks: Record<string, boolean> = inputs.diligenceChecks || {};

  const done = CHECKLIST.filter((c) => checks[c.id]).length;
  const pct = Math.round((done / CHECKLIST.length) * 100);

  const toggle = (id: string) => { void onPatchDeal({ diligenceChecks: { ...checks, [id]: !checks[id] } } as Partial<DealInputs>); };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl">
        <DealDocumentsList dealId={deal.id} refreshKey={docsVersion} onAdd={onAddDocuments} />
      </div>

      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-5 transition duration-300">
        <div className="pb-3 border-b border-slate-900">
          <h3 className="text-sm font-bold text-white tracking-tight flex items-center space-x-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>Assumptions</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">Every figure this property's numbers rest on: what is specific to it, and where your global standards are doing the work. Customize any of them; the rest follow your profile.</p>
        </div>

        <AssumptionsLedger deal={deal} metrics={metrics} onOpenEdit={onOpenEdit} />

        <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
            <div className="flex items-center space-x-2">
              <span className="text-base">📋</span>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">Underwriting Records &amp; Verification Audit</h4>
                <p className="text-[11px] text-slate-400">Track documentation, historical records, and property data inputs used to evaluate the asset.</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Diligence Completion</span>
                <span className="text-xs font-black text-emerald-400">{pct}% ({done} of {CHECKLIST.length} Verified)</span>
              </div>
              <div className="w-24 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div className="bg-emerald-500 h-2 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {CHECKLIST.map((item) => {
              const isDone = !!checks[item.id];
              return (
                <label key={item.id}
                  className={`flex items-start space-x-2.5 p-2.5 rounded-xl border transition cursor-pointer ${isDone ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-200' : 'bg-slate-900/40 border-slate-900 text-slate-300 hover:bg-slate-900/70'}`}>
                  <input type="checkbox" checked={isDone} onChange={() => toggle(item.id)} className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-emerald-500 mt-0.5 h-3.5 w-3.5 cursor-pointer" />
                  <div className="flex-1">
                    <span className={`font-bold block ${isDone ? 'line-through text-emerald-300/80' : 'text-slate-200'}`}>{item.label}</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">{item.detail}</span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <DiligenceDisclosures />
    </div>
  );
};
