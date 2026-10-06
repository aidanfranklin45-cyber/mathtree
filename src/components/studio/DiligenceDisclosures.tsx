import React from 'react';
import { VARIANCE_DISCLOSURE } from '../../lib/ingestion/apply';

/**
 * How this property's numbers are made, in plain words, so each one can be justified to a lender, a partner or yourself. Every statement here
 * describes what the app does; when the app's rules change, change this text with them.
 */
const SECTIONS: Array<{ title: string; points: string[] }> = [
  {
    title: 'Where each figure comes from',
    points: [
      'Every figure in the Assumptions list above says where it came from: a document (named when it is the only one of its kind), your own entry, your investor profile, or the county record. Nothing is filled in without saying so.',
      'A figure you type yourself always replaces what a document or your profile would have supplied.',
      'Facts that only the property can state (purchase price, rent, loan terms, closing date) are taken from your documents or your entry. They are never filled in from a default; if one is missing, the property asks for it.',
    ],
  },
  {
    title: 'Documents against your global standards',
    points: [
      VARIANCE_DISCLOSURE,
      'This applies to assumptions and costs your investor profile has a standard for, such as vacancy, expense ratio, taxes, insurance, reserves and closing costs. Figures with no standard of yours, such as price or unit count, are taken from the document as stated.',
      'Your standards are either copied onto a property when it is created, after which they stay as they were, or followed live for as long as the property states no figure of its own. Each line in the list above says which.',
    ],
  },
  {
    title: 'What the automated reading can and cannot do',
    points: [
      'Documents are read by an automated reader. Names, phone numbers and emails are removed before anything is read. It can miss or misread things, so you reviewed what it found and confirmed it before the project was created. You are the one underwriting this property.',
      'Claims in a document, such as a seller\'s stated NOI or cap rate, are shown for comparison and are never used in the numbers.',
      'The original files are kept privately with the property, and whoever owns the property can open them above. A record of which figures were read from documents, and what you decided where sources disagreed, is saved with the property.',
    ],
  },
  {
    title: 'County records',
    points: [
      'The parcel number, owner of record, assessed value, land area and building details come from the county\'s public records, and the line in the list above says how the parcel was found.',
      'A property listed under several street numbers is looked up number by number. If more than one parcel is involved you choose which belong to the project, and a parcel held by a different owner of record than the primary parcel is flagged for you to check.',
      'Building area adds up the county\'s building records for the parcel. The county keeps a commercial list and a residential list that may describe the same buildings, so compare the total with the rentable area in your offering memorandum.',
    ],
  },
  {
    title: 'How the numbers are built',
    points: [
      'In a normal year operating costs are the expense ratio times gross rent. Taxes, insurance and upkeep are inside that ratio. Separate management fees apply only if you hire a manager, and that decision is yours.',
      'Utility reimbursements and tenant recoveries are taken off costs, and this assumes tenants keep paying them. Other income, such as pet fees, is counted as income, grows with rent and takes vacancy.',
      'Apartments, commercial and storage properties are valued at exit as net operating income divided by the exit cap rate you set, not by appreciation. Single-family homes are valued by appreciation. The amortized or day-one cap rate setting decides how the value moves toward the exit cap.',
      '"Cash back from operations" counts only cash the property has paid you. Equity is shown as value built, but it is not cash until a sale.',
    ],
  },
];

export const DiligenceDisclosures: React.FC = () => (
  <section aria-label="Disclosures" className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
    <div>
      <h3 className="text-sm font-extrabold text-white">How these numbers are made</h3>
      <p className="text-xs text-slate-400 mt-0.5">What the figures rest on and what to check, so each one can be justified.</p>
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
