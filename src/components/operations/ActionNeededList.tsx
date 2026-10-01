import React from 'react';
import type { AttentionKind, RowHandlers, RowView } from './rowStatus';

interface Props {
  views: RowView[];
  dealTitle: (dealId: string) => string;
  handlers: RowHandlers;
  onSelect: (leaseId: string) => void;
  onShowAll: () => void;
  /** One-line summary of a lease's late NNN items, for the 'recovery' attention kind. */
  recoveryNote?: (leaseId: string) => string;
}

const MAX_SHOWN = 5;
const ORDER: Record<AttentionKind, number> = { overdue: 0, recovery: 1, escalation: 2, due_soon: 3 };

interface Item { key: string; view: RowView; kind: AttentionKind }

/** "What needs me right now": overdue rent, escalations that have come due, and rent due within days. */
export const ActionNeededList: React.FC<Props> = ({ views, dealTitle, handlers, onSelect, onShowAll, recoveryNote }) => {
  const items: Item[] = views
    .flatMap((view) => view.attention.map((kind) => ({ key: `${view.row.id}:${kind}`, view, kind })))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);

  if (items.length === 0) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl px-4 py-3 text-xs font-semibold text-emerald-300">
        ✓ All caught up — nothing needs your attention right now.
      </div>
    );
  }

  const shown = items.slice(0, MAX_SHOWN);
  return (
    <div className="bg-slate-900/70 border border-amber-500/20 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-300">Needs attention · {items.length}</h3>
        {items.length > MAX_SHOWN && (
          <button type="button" onClick={onShowAll} className="text-[11px] font-semibold text-slate-400 hover:text-white transition">+{items.length - MAX_SHOWN} more →</button>
        )}
      </div>
      <ul className="divide-y divide-slate-800/60">
        {shown.map(({ key, view, kind }) => {
          const { row, due, esc } = view;
          const who = `${row.tenant_name || 'Tenant'} · ${dealTitle(row.deal_id)}`;
          const detail = kind === 'recovery'
            ? <span className="text-rose-400">{recoveryNote?.(row.id) || 'NNN charges overdue'}</span>
            : kind === 'overdue'
            ? <span className="text-rose-400">{due?.summary || 'Rent overdue'}</span>
            : kind === 'escalation'
              ? <span className="text-amber-300">Escalation due {esc?.nearestScheduled ? `${esc.nearestScheduled.effective_date} (${esc.scheduledValStr})` : ''}</span>
              : <span className="text-slate-400">{due?.summary || 'Rent due soon'}</span>;
          return (
            <li key={key} onClick={() => onSelect(row.id)} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/40 cursor-pointer transition">
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">{who}</div>
                <div className="text-[11px] truncate">{detail}</div>
              </div>
              <span className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 bg-slate-800" aria-hidden="true">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
