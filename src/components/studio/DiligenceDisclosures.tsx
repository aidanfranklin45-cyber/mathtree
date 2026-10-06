import React from 'react';
import { HOW_ASSUMPTIONS_WORK as SECTIONS } from '../../lib/assumptions/howAssumptionsWork';

export const DiligenceDisclosures: React.FC = () => (
  <section aria-label="Disclosures" className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
    <h3 className="text-sm font-extrabold text-white">How our assumptions work</h3>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {SECTIONS.map((section) => (
        <div key={section.title} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
          <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-200">{section.title}</h4>
          <ul className="space-y-1.5 list-disc pl-4">
            {section.points.map((p) => <li key={p} className="text-[11px] text-slate-400 leading-relaxed">{p}</li>)}
          </ul>
        </div>
      ))}
    </div>
  </section>
);
