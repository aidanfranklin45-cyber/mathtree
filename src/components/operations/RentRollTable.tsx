import React from 'react';
import { isResidentialAsset } from '../../../supabase/functions/_shared/rentIncreaseRules';
import type { LeaseRecoverySummary } from '../../lib/operations/recoveries';
import { escalationNote, toneBadge, toneText, type RowHandlers, type RowView } from './rowStatus';
import type { Row } from '../../lib/operations/rentRoll';

interface Props {
  views: RowView[];
  loading: boolean;
  dealOf: (dealId: string) => Row | undefined;
  unitOf: (row: RowView['row']) => Row;
  handlers: RowHandlers;
  onSelect: (leaseId: string) => void;
  onAddFirstLease: () => void;
  /** NNN roll-up per opted-in lease, for the small status line under the tenant name. */
  recoverySummaries: Map<string, LeaseRecoverySummary>;
  /** Properties that have had at least one tenant, so a vacant unit only offers History when there is some. */
  historyDealIds: Set<string>;
  filtered: boolean;
}

const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** One arrow per row: opens the lease details (or, for a vacant unit, the add-tenant form). */
const RowArrow: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
    </button>
  </div>
);

const RentRollDesktop: React.FC<Props> = ({ views, loading, dealOf, unitOf, handlers, onSelect, onAddFirstLease, recoverySummaries, historyDealIds, filtered }) => (
  <table className="w-full text-left border-collapse">
    <thead>
      <tr className="border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 bg-slate-950/50">
        <th className="py-3 px-4">Property &amp; Unit</th>
        <th className="py-3 px-4">Tenant</th>
        <th className="py-3 px-4 text-right">Rent</th>
        <th className="py-3 px-4">Status</th>
        <th className="py-3 px-4">Next</th>
        <th className="py-3 px-4"><span className="sr-only">Actions</span></th>
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-800/60 text-xs">
      {loading && views.length === 0 ? (
        <tr><td colSpan={6} className="py-12 text-center text-slate-400"><div className="animate-pulse">Loading rent roll…</div></td></tr>
      ) : views.length === 0 ? (
        <tr>
          <td colSpan={6} className="py-10 text-center text-slate-400">
            {filtered ? (
              <p className="text-xs text-slate-500">Nothing matches this filter.</p>
            ) : (
              <div className="max-w-sm mx-auto space-y-3">
                <p className="font-bold text-white text-sm">No properties or leases in this view</p>
                <p className="text-xs text-slate-500">Add a lease to start tracking rent and escalations.</p>
                <button onClick={onAddFirstLease} className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">+ Add First Lease</button>
              </div>
            )}
          </td>
        </tr>
      ) : views.map((view) => {
        const { row, vacant } = view;
        const deal = dealOf(row.deal_id) || { id: row.deal_id, title: 'Unknown Asset' };
        const dealTitle = deal.title || deal.name;

        if (vacant) {
          return (
            <tr key={row.id} className="bg-slate-950/20 hover:bg-slate-800/30 transition">
              <td className="py-3 px-4">
                <span className="block font-bold text-white">{dealTitle}</span>
                <span className="block text-[11px] text-slate-400">{row.unit_number} <span className="text-slate-500">({row.unit_type})</span></span>
              </td>
              <td className="py-3 px-4 italic text-slate-500">Vacant</td>
              <td className="py-3 px-4 text-right font-mono text-slate-600">—</td>
              <td className="py-3 px-4"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${toneBadge.muted}`}>Vacant</span></td>
              <td className="py-3 px-4 text-slate-600">—</td>
              <td className="py-3 px-4">
                <div className="flex items-center justify-end gap-2">
                  {historyDealIds.has(deal.id) && (
                    <button type="button" onClick={() => handlers.history(row)} className="text-[11px] font-semibold text-slate-400 hover:text-white transition">History</button>
                  )}
                  <RowArrow label="Add a tenant to this property" onClick={() => handlers.addTenant(deal.id)} />
                </div>
              </td>
            </tr>
          );
        }

        const unit = unitOf(row);
        const note = escalationNote(view);
        const rent = (parseFloat(row.monthly_rent) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        return (
          <tr key={row.id} onClick={() => onSelect(row.id)} className="hover:bg-slate-800/40 transition cursor-pointer">
            <td className="py-3 px-4">
              <span className="block font-bold text-white">{dealTitle}</span>
              <span className="block text-[11px] text-emerald-400">{unit.unit_number} <span className="text-slate-500">({unit.unit_type || 'Commercial'})</span></span>
            </td>
            <td className="py-3 px-4">
              <span className="block font-semibold text-slate-200">{row.tenant_name}</span>
              <span className={`block text-[10px] ${row.lease_end_date ? 'text-slate-500' : 'text-amber-400/80'}`}>
                {row.lease_end_date ? `Lease ends ${row.lease_end_date}` : 'Month-to-month'}
              </span>
              {(() => {
                const rec = recoverySummaries.get(row.id);
                if (rec?.tracked) {
                  const late = rec.overdue > 0;
                  return <span className={`block text-[10px] font-semibold ${late ? 'text-rose-400' : rec.dueSoon > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
                    NNN costs: {late ? `${rec.overdue} overdue` : rec.dueSoon > 0 ? `${rec.dueSoon} due soon` : 'up to date'}
                  </span>;
                }
                // Real commercial leases that aren't tracking yet get a quiet pointer to where the feature lives
                return !view.derived && !isResidentialAsset(deal.asset_type)
                  ? <span className="block text-[10px] text-slate-500">Track NNN costs →</span>
                  : null;
              })()}
            </td>
            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">${rent}</td>
            <td className="py-3 px-4">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${toneBadge[view.tone]}`}>{view.statusLabel}</span>
            </td>
            <td className="py-3 px-4">
              <span className="block font-mono text-[11px] text-slate-300">{view.due ? `Due ${shortDate(view.due.nextDue)}` : '—'}</span>
              {note && <span className={`block text-[10px] ${toneText[note.tone]}`}>{note.text}</span>}
            </td>
            <td className="py-3 px-4"><RowArrow label="Open lease details" onClick={() => onSelect(row.id)} /></td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

/** Phone layout: one compact card per row (property, tenant, rent, status, next due) instead of a six-column table. */
const RentRollCards: React.FC<Props> = ({ views, loading, dealOf, unitOf, handlers, onSelect, onAddFirstLease, historyDealIds, filtered }) => {
  if (loading && views.length === 0) return <div className="py-10 text-center text-xs text-slate-400 animate-pulse">Loading rent roll…</div>;
  if (views.length === 0) {
    return filtered ? (
      <p className="py-8 text-center text-xs text-slate-500">Nothing matches this filter.</p>
    ) : (
      <div className="py-8 px-4 text-center space-y-3">
        <p className="font-bold text-white text-sm">No properties or leases in this view</p>
        <button onClick={onAddFirstLease} className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">+ Add First Lease</button>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-800/60">
      {views.map((view) => {
        const { row, vacant } = view;
        const deal = dealOf(row.deal_id) || { id: row.deal_id, title: 'Unknown Asset' };
        const dealTitle = deal.title || deal.name;
        if (vacant) {
          return (
            <li key={row.id} className="px-4 py-3 flex items-center justify-between gap-3 bg-slate-950/20">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{dealTitle}</p>
                <p className="text-[11px] text-slate-500 truncate">{row.unit_number} · Vacant</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {historyDealIds.has(deal.id) && (
                  <button type="button" onClick={() => handlers.history(row)} className="text-[11px] font-semibold text-slate-400">History</button>
                )}
                <RowArrow label="Add a tenant to this property" onClick={() => handlers.addTenant(deal.id)} />
              </div>
            </li>
          );
        }
        const unit = unitOf(row);
        const note = escalationNote(view);
        const rent = (parseFloat(row.monthly_rent) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        return (
          <li key={row.id} onClick={() => onSelect(row.id)} className="px-4 py-3 space-y-1.5 cursor-pointer active:bg-slate-800/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{row.tenant_name}</p>
                <p className="text-[11px] text-slate-400 truncate">{dealTitle} · <span className="text-emerald-400">{unit.unit_number}</span></p>
              </div>
              <span className="font-mono font-bold text-emerald-400 text-sm shrink-0">${rent}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${toneBadge[view.tone]}`}>{view.statusLabel}</span>
              <span className="text-[11px] text-slate-400 truncate">
                {view.due ? `Due ${shortDate(view.due.nextDue)}` : ''}
                {note && <span className={`ml-1.5 ${toneText[note.tone]}`}>{note.text}</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export const RentRollTable: React.FC<Props> = (props) => (
  <>
    <div className="md:hidden"><RentRollCards {...props} /></div>
    <div className="hidden md:block"><RentRollDesktop {...props} /></div>
  </>
);
