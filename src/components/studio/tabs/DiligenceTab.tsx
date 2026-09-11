import React, { useState } from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import { CheckSquare, Square, FileText } from 'lucide-react';

interface DiligenceTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
}

const INITIAL_CHECKLIST = [
  { id: '1', title: 'Preliminary Title Report & ALTA Survey Review', category: 'Legal & Title', completed: true },
  { id: '2', title: 'Phase I Environmental Site Assessment (ESA)', category: 'Environmental', completed: true },
  { id: '3', title: 'Commercial Lease Audit & Estoppel Certificates', category: 'Tenancy', completed: false },
  { id: '4', title: 'Property Condition Assessment (PCA) & Roof Inspection', category: 'Physical Asset', completed: false },
  { id: '5', title: 'County Property Tax Re-assessment Analysis', category: 'Tax & Municipal', completed: true },
  { id: '6', title: 'Zoning & Municipal Code Compliance Verification', category: 'Municipal', completed: true },
  { id: '7', title: 'Historical Utility Invoices & OpEx Reconciliation', category: 'Financial', completed: false },
];

export const DiligenceTab: React.FC<DiligenceTabProps> = ({ deal }) => {
  const [checklist, setChecklist] = useState(INITIAL_CHECKLIST);

  const toggleItem = (id: string) => {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item))
    );
  };

  const completedCount = checklist.filter((i) => i.completed).length;
  const progressPct = Math.round((completedCount / checklist.length) * 100);

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-white tracking-tight">Acquisition Due Diligence & Assumptions</h2>
          <p className="text-xs text-slate-400">Institutional closing checklist and risk validation</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-32 bg-slate-800 h-2.5 rounded-full overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="text-xs font-mono font-bold text-emerald-400">{progressPct}% Complete</span>
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-emerald-400" />
          <span>Underwriting Verification Tasks</span>
        </h3>

        <div className="divide-y divide-slate-800/60">
          {checklist.map((item) => (
            <div
              key={item.id}
              onClick={() => toggleItem(item.id)}
              className="py-3 flex items-center justify-between cursor-pointer hover:bg-slate-800/30 px-2 rounded-xl transition"
            >
              <div className="flex items-center gap-3">
                {item.completed ? (
                  <CheckSquare className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Square className="w-4 h-4 text-slate-500" />
                )}
                <span className={`text-xs ${item.completed ? 'text-slate-400 line-through' : 'text-slate-200 font-medium'}`}>
                  {item.title}
                </span>
              </div>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                {item.category}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
