import React from 'react';
import type { TraceRow } from '../../lib/ingestion/lineage';

const money = (n: number | null): string => (n === null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

/**
 * The paper trail from the documents to the underwriting: every line the reader took from a document, as printed and where it sits, the category
 * the reader sorted it into, and what that category feeds. A line whose number is not in the document is marked, because the reader cannot have
 * read it as printed. This is how the reader's sorting can be checked by eye against the document.
 */
export const DocumentLineage: React.FC<{ rows: TraceRow[] | undefined; defaultOpen?: boolean }> = ({ rows, defaultOpen = false }) => {
  if (!rows || rows.length === 0) return null;
  const documents = [...new Set(rows.map((r) => r.document))];
  const notFound = rows.filter((r) => !r.found).length;
  return (
    <details open={defaultOpen} className="group rounded-xl bg-slate-950/50 border border-slate-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-slate-200 flex items-center justify-between gap-2">
        <span>Where each number went ({rows.length} lines read)</span>
        {notFound > 0 ? <span className="text-amber-300 font-semibold">{notFound} not found in the document</span> : <span className="text-emerald-300 font-semibold">every number is in the document</span>}
      </summary>
      <div className="px-3 pb-3 space-y-3 overflow-x-auto">
        <p className="text-[11px] text-slate-400">Check the sorting against the document. If a line is in the wrong category, enter the figure yourself in the form instead.</p>
        {documents.map((d) => (
          <div key={d} className="space-y-1">
            <p className="text-[11px] font-bold text-slate-300">{d}</p>
            <table className="w-full text-[11px] text-left border-collapse">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-1 pr-2 font-semibold">Line in the document</th>
                  <th className="py-1 pr-2 font-semibold text-right">Amount</th>
                  <th className="py-1 pr-2 font-semibold">Sorted into</th>
                  <th className="py-1 pr-2 font-semibold">Feeds</th>
                  <th className="py-1 font-semibold">Where</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((r) => r.document === d).map((r, i) => (
                  <tr key={`${r.section}-${r.label}-${i}`} className={`border-b border-slate-900 align-top ${r.found ? 'text-slate-300' : 'text-amber-200 bg-amber-500/5'}`}>
                    <td className="py-1 pr-2"><span className="text-slate-500">{r.section}: </span>{r.label}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{money(r.amount)}</td>
                    <td className="py-1 pr-2">{r.category ? r.category.replace(/_/g, ' ') : ''}</td>
                    <td className="py-1 pr-2">{r.feeds}</td>
                    <td className="py-1">{r.found ? `${r.page !== null ? `page ${r.page}, ` : ''}line ${r.line ?? '?'}${r.matches > 1 ? ` (1 of ${r.matches} places)` : ''}` : 'not found in the document'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </details>
  );
};
