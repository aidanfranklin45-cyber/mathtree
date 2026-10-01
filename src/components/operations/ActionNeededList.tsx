import React from 'react';
import type { AttentionKind, RowHandlers, RowView } from './rowStatus';

interface Props {
  views: RowView[];
  dealTitle: (dealId: string) => string;
  handlers: RowHandlers;
  onSelect: (leaseId: string) => void;
  onShowAll: () => void;
}

const MAX_SHOWN = 5;
const ORDER: Record<AttentionKind, number> = { overdue: 0, escalation: 1, due_soon: 2 };

interface Item { key: string; view: RowView; kind: AttentionKind }

/** "What needs me right now": overdue rent, escalations that have come due, and rent due within days. */
export const ActionNeededList: React.FC<Props> = ({ views, dealTitle, handlers, onSelect, onShowAll }) => {
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
          const detail = kind === 'overdue'
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
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                {kind === 'escalation' ? (
                  <button type="button" disabled={view.derived} onClick={() => handlers.escalate(row)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-blue-200 bg-blue-950/70 border border-blue-700 hover:bg-blue-700 disabled:opacity-40 transition">Escalate</button>
                ) : (
                  <button type="button" disabled={view.derived} onClick={() => handlers.pay(row)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-emerald-200 bg-emerald-950/80 border border-emerald-600 hover:bg-emerald-600 hover:text-white disabled:opacity-40 transition">✓ Mark Paid</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
