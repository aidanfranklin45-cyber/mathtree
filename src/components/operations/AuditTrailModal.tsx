import React from 'react';

type Row = Record<string, any>;

interface Props {
  /** A lease id, or "vacant-<dealId>" for an unleased property row. Null closes the modal. */
  leaseId: string | null;
  deals: Row[];
  leases: Row[];
  units: Row[];
  increases: Row[];
  /** Derived (deal-input) leases that aren't in the leases table. */
  derivedLeases?: Row[];
  onClose: () => void;
}

const money2 = (v: number) => v.toFixed(2);

export const AuditTrailModal: React.FC<Props> = ({ leaseId, deals, leases, units, increases, derivedLeases = [], onClose }) => {
  if (!leaseId) return null;

  const isVacant = leaseId.startsWith('vacant-');
  const lease = isVacant ? null : [...leases, ...derivedLeases].find((l) => l.id === leaseId) || null;
  const deal = isVacant
    ? deals.find((d) => String(d.id) === leaseId.replace('vacant-', ''))
    : deals.find((d) => d.id === lease?.deal_id);
  const unit = lease ? units.find((u) => u.id === lease.unit_id) : null;

  const info = isVacant
    ? `${deal ? deal.title : 'Asset'} • Main Parcel — Vacant (No Active Lease)`
    : `${deal ? deal.title : 'Asset'} • ${unit ? unit.unit_number : lease?.derived_unit_number || 'Unit'} — ${lease?.tenant_name ?? ''}`;

  const records = isVacant
    ? []
    : increases.filter((inc) => inc.lease_id === leaseId).sort((a, b) => +new Date(a.effective_date) - +new Date(b.effective_date));

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl p-6 relative">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <h3 className="text-base font-bold text-white flex items-center space-x-2"><span className="text-blue-400">📜</span><span>Escalation History &amp; Audit Trail</span></h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg" aria-label="Close">✕</button>
        </div>

        <div className="text-xs text-slate-400 mb-3 font-medium">{info}</div>

        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-[10px] uppercase font-bold text-slate-400">
              <tr>
                <th className="py-2.5 px-3">Effective</th>
                <th className="py-2.5 px-3">Prior Rent</th>
                <th className="py-2.5 px-3">New Rent</th>
                <th className="py-2.5 px-3 text-right">Adjustment</th>
                <th className="py-2.5 px-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {isVacant ? (
                <tr><td colSpan={5} className="py-6 text-center text-slate-400 italic">
                  This property is currently unleased with no active tenancy or scheduled rent escalations. Click &quot;+ Add Tenant&quot; to configure an active commercial lease.
                </td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={5} className="py-6 text-center text-slate-500 italic">
                  No historical or scheduled rent increases logged yet for this lease. Initial starting rent: ${(parseFloat(lease?.monthly_rent) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}.
                </td></tr>
              ) : records.map((r) => {
                const applied = r.is_applied !== false;
                const oldRent = parseFloat(r.old_rent) || 0;
                const newRent = parseFloat(r.new_rent) || 0;
                const diff = newRent - oldRent;
                const pct = r.percentage_change || (oldRent > 0 ? ((diff / oldRent) * 100).toFixed(1) : '0.0');
                return (
                  <tr key={r.id} className="hover:bg-slate-800/50">
                    <td className="py-2 px-3 font-mono text-slate-200">
                      <div className="flex items-center space-x-1.5">
                        <span>{r.effective_date}</span>
                        {applied
                          ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">✓ Applied</span>
                          : <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-500/30">📅 Scheduled</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-400">${money2(oldRent)}</td>
                    <td className="py-2 px-3 font-mono text-emerald-400 font-bold">${money2(newRent)}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-400">+{diff > 0 ? `$${money2(diff)}` : '$0.00'} (+{pct}%)</td>
                    <td className="py-2 px-3 text-slate-300 text-[11px]">{r.reason || (applied ? 'Historical Escalation' : 'Scheduled Escalation')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 text-right">
          <button type="button" onClick={onClose} className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition">Close</button>
        </div>
      </div>
    </div>
  );
};
