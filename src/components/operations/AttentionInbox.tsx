import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { INBOX_LABEL, type InboxBasis, type InboxItem, type InboxKind } from '../../lib/operations/attention';

interface Props {
  items: InboxItem[];
  /** Portfolio page: each item links to its property's Operate tab. On a property's own tab, items open the lease instead. */
  portfolio: boolean;
  onSelectLease: (leaseId: string) => void;
}

const MAX_SHOWN = 6;
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

const kindTone: Record<InboxKind, string> = {
  overdue: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
  recovery: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
  escalation: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  lease_expiring: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  missing_data: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  needs_review: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  due_soon: 'text-slate-300 bg-slate-800 border-slate-700',
};

const basisLabel: Record<Exclude<InboxBasis, null>, string> = { collected: 'Collected', contracted: 'Per lease', estimated: 'Estimated' };

const Chevron = () => (
  <span className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 bg-slate-800" aria-hidden="true">
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
  </span>
);

interface ListProps {
  items: InboxItem[];
  portfolio: boolean;
  onSelectLease?: (leaseId: string) => void;
  /** Called when a portfolio row is followed (the bell panel closes itself). */
  onNavigate?: () => void;
}

/** The rows of the inbox, shared by the Operations page and the bell panel. */
export const InboxList: React.FC<ListProps> = ({ items, portfolio, onSelectLease, onNavigate }) => (
  <ul className="divide-y divide-slate-800/60">
    {items.map((item) => {
      const body = (
        <>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[9px] font-extrabold uppercase tracking-wider ${kindTone[item.kind]}`}>{INBOX_LABEL[item.kind]}</span>
              <span className="text-xs font-bold text-white truncate">{item.headline}</span>
            </div>
            <div className="text-[11px] text-slate-400 truncate mt-0.5">
              {portfolio && <span className="font-semibold text-slate-300">{item.dealTitle} · </span>}{item.detail}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-3">
            {item.kind !== 'missing_data' && item.kind !== 'needs_review' && (
              <div className="text-right">
                <div className="text-xs font-mono font-bold text-white">{item.amount === null ? '—' : usd(item.amount)}</div>
                {item.basis && <div className="text-[9px] uppercase tracking-wider text-slate-500">{item.kind === 'lease_expiring' ? `Annual rent · ${basisLabel[item.basis]}` : basisLabel[item.basis]}</div>}
              </div>
            )}
            <Chevron />
          </div>
        </>
      );
      const row = 'px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition';
      return (
        <li key={item.id}>
          {portfolio ? (
            <Link to={item.link} onClick={onNavigate} className={row}>{body}</Link>
          ) : item.leaseId ? (
            <button type="button" onClick={() => onSelectLease?.(item.leaseId!)} className={`${row} w-full text-left cursor-pointer`}>{body}</button>
          ) : (
            <div className={row}>{body}</div>
          )}
        </li>
      );
    })}
  </ul>
);

/**
 * The attention inbox: everything that needs action, one line each, saying which property it is about and what its figure rests on.
 * The portfolio page and a property's Operate tab render the same items (the tab just has only that property's).
 */
export const AttentionInbox: React.FC<Props> = ({ items, portfolio, onSelectLease }) => {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl px-4 py-3 text-xs font-semibold text-emerald-300">
        ✓ All caught up — nothing needs your attention right now.
      </div>
    );
  }

  const shown = expanded ? items : items.slice(0, MAX_SHOWN);
  return (
    <div className="bg-slate-900/70 border border-amber-500/20 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-300">Needs attention · {items.length}</h3>
        {items.length > MAX_SHOWN && (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="text-[11px] font-semibold text-slate-400 hover:text-white transition">
            {expanded ? 'Show fewer' : `+${items.length - MAX_SHOWN} more →`}
          </button>
        )}
      </div>
      <InboxList items={shown} portfolio={portfolio} onSelectLease={onSelectLease} />
    </div>
  );
};
