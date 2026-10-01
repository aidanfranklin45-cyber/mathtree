import React from 'react';
import { RowActions } from './RowActions';
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
  filtered: boolean;
}

const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const RentRollTable: React.FC<Props> = ({ views, loading, dealOf, unitOf, handlers, onSelect, onAddFirstLease, filtered }) => (
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
              <td className="py-3 px-4"><RowActions view={view} dealId={deal.id} handlers={handlers} /></td>
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
            </td>
            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">${rent}</td>
            <td className="py-3 px-4">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${toneBadge[view.tone]}`}>{view.statusLabel}</span>
            </td>
            <td className="py-3 px-4">
              <span className="block font-mono text-[11px] text-slate-300">{view.due ? `Due ${shortDate(view.due.nextDue)}` : '—'}</span>
              {note && <span className={`block text-[10px] ${toneText[note.tone]}`}>{note.text}</span>}
            </td>
            <td className="py-3 px-4"><RowActions view={view} dealId={deal.id} handlers={handlers} /></td>
          </tr>
        );
      })}
    </tbody>
  </table>
);
