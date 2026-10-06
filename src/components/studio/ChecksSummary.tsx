import React from 'react';
import { reviewSummary } from '../../lib/ingestion/reviewSummary';
import type { IntakeRecord } from '../../lib/ingestion/intakeRecord';

/**
 * Checks and balances for a property built from documents: the documents' own arithmetic, and whether this underwriting's net operating income
 * is close to the seller's. A gap is named, with what the owner changed, so a mistake is not left for the owner to find.
 */
export const ChecksSummary: React.FC<{ record: Partial<IntakeRecord> | undefined; ourNoi: number | null; selfManaged: boolean }> = ({ record, ourNoi, selfManaged }) => {
  const summary = reviewSummary({ record, ourNoi, selfManaged });
  if (summary.items.length === 0) return null;
  return (
    <section aria-label="Checks and balances" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">Checks and balances</h4>
        <span className={`text-[11px] font-semibold ${summary.toReview > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
          {summary.toReview > 0 ? `${summary.consistent} consistent, ${summary.toReview} to review` : `all ${summary.consistent} consistent`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {summary.items.map((i) => (
          <li key={i.label} className={`px-3 py-2 rounded-xl border text-[11px] leading-relaxed ${i.ok ? 'bg-slate-950/60 border-slate-800 text-slate-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-100'}`}>
            <span className={i.ok ? 'text-emerald-400' : 'text-amber-300'}>{i.ok ? '✓' : '⚠'}</span> <span className="font-bold">{i.label}.</span> <span className={i.ok ? 'text-slate-400' : 'text-amber-100/90'}>{i.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
