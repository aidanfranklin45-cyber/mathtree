import React from 'react';
import { VARIANCE_DISCLOSURE } from '../../lib/ingestion/apply';

/**
 * How the assumptions work, at a high level, so they can be justified. Every statement describes what the app does; when the app's rules
 * change, change this text with them.
 */
const SECTIONS: Array<{ title: string; points: string[] }> = [
  {
    title: 'Where a figure comes from',
    points: [
      'Each figure says whether it came from a document, your own entry, your investor profile or the county record. Your own entry always wins.',
    ],
  },
  {
    title: 'Documents and your standards',
    points: [
      VARIANCE_DISCLOSURE,
      'Your standards are either copied onto a property when it is created, or followed live until the property states its own figure. Each line says which.',
    ],
  },
  {
    title: 'Automated reading',
    points: [
      'Documents are read automatically, which can miss or misread things. You reviewed and confirmed what it found before the project was created, and you are the one underwriting it.',
      "A seller's own claims, such as NOI or cap rate, are shown for comparison and never used.",
    ],
  },
  {
    title: 'County records and original files',
    points: [
      'County figures come from public records. A parcel held by a different owner than the primary parcel is flagged, and building area may overlap between the county\'s two building lists, so compare it with your offering memorandum.',
      'The original files are kept privately with the property.',
    ],
  },
];

export const DiligenceDisclosures: React.FC = () => (
  <section aria-label="Disclosures" className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
    <div>
      <h3 className="text-sm font-extrabold text-white">How our assumptions work</h3>
      <p className="text-xs text-slate-400 mt-0.5">What your figures rest on and what to check.</p>
    </div>
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
