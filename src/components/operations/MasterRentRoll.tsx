import React, { useState, useMemo } from 'react';
import {
  DollarSign,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  Filter,
  CreditCard,
  Building,
} from 'lucide-react';
import { MonthlyRentReconciliationView, LeaseRow } from '../../lib/supabase/types';

interface MasterRentRollProps {
  items: MonthlyRentReconciliationView[];
  leases?: LeaseRow[];
  isLoading?: boolean;
  onLogPayment: (item: MonthlyRentReconciliationView) => void;
  onRentIncrease?: (item: MonthlyRentReconciliationView) => void;
  onAddLease?: () => void;
}

export const MasterRentRoll: React.FC<MasterRentRollProps> = ({
  items,
  leases = [],
  isLoading,
  onLogPayment,
  onRentIncrease,
  onAddLease,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Filter status
      const status = (item.payment_status || 'pending').toLowerCase();
      if (filterStatus !== 'all') {
        if (filterStatus === 'paid' && status !== 'paid') return false;
        if (filterStatus === 'partial' && status !== 'partial') return false;
        if (filterStatus === 'unpaid' && (status === 'paid' || status === 'partial')) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const tenant = (item.tenant_name || '').toLowerCase();
        const unit = (item.unit_number || '').toLowerCase();
        const deal = (item.deal_title || '').toLowerCase();
        if (!tenant.includes(q) && !unit.includes(q) && !deal.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [items, filterStatus, searchQuery]);

  // Aggregate stats from the authoritative reconciliation view
  const stats = useMemo(() => {
    const totalContractual = items.reduce((sum, item) => sum + Number(item.contractual_rent || 0), 0);
    const totalCollected = items.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
    const totalOutstanding = Math.max(0, totalContractual - totalCollected);
    const collectionRate = totalContractual > 0 ? Math.round((totalCollected / totalContractual) * 100) : 100;
    return {
      totalContractual,
      totalCollected,
      totalOutstanding,
      collectionRate,
    };
  }, [items]);

  if (isLoading) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 animate-pulse space-y-4">
        <div className="h-6 w-56 bg-slate-800 rounded"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="h-20 bg-slate-800/50 rounded-xl"></div>
          <div className="h-20 bg-slate-800/50 rounded-xl"></div>
          <div className="h-20 bg-slate-800/50 rounded-xl"></div>
          <div className="h-20 bg-slate-800/50 rounded-xl"></div>
        </div>
        <div className="h-64 bg-slate-800/20 rounded-xl"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Financial Reconciliation Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Contractual Billed</div>
          <div className="text-xl font-black font-mono text-white">
            ${Math.round(stats.totalContractual).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Active Leases Total</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Collected Month-To-Date</div>
          <div className="text-xl font-black font-mono text-emerald-400">
            ${Math.round(stats.totalCollected).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{stats.collectionRate}% Collection Rate</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Outstanding Receivables</div>
          <div className="text-xl font-black font-mono text-rose-400">
            ${Math.round(stats.totalOutstanding).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {stats.totalOutstanding > 0 ? 'Uncollected Balance' : '100% Reconciled'}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Active Leases</div>
          <div className="text-xl font-black font-mono text-cyan-400">{items.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Tenants on Roll</div>
        </div>
      </div>

      {/* Main Reconciliation Table Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {/* Controls / Filter Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950/40">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              Monthly Rent Reconciliation & Master Roll
            </h3>
            <p className="text-xs text-slate-400">
              Contractual receivables vs. verified payments recorded in PostgreSQL
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tenant, unit..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-950/80 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-xl p-1 text-xs">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1 rounded-lg transition font-semibold ${
                  filterStatus === 'all'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterStatus('paid')}
                className={`px-3 py-1 rounded-lg transition font-semibold ${
                  filterStatus === 'paid'
                    ? 'bg-emerald-500/20 text-emerald-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Paid
              </button>
              <button
                onClick={() => setFilterStatus('partial')}
                className={`px-3 py-1 rounded-lg transition font-semibold ${
                  filterStatus === 'partial'
                    ? 'bg-amber-500/20 text-amber-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Partial
              </button>
              <button
                onClick={() => setFilterStatus('unpaid')}
                className={`px-3 py-1 rounded-lg transition font-semibold ${
                  filterStatus === 'unpaid'
                    ? 'bg-rose-500/20 text-rose-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Unpaid
              </button>
            </div>

            {onAddLease && (
              <button
                type="button"
                onClick={onAddLease}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs transition shadow-sm flex items-center space-x-1 shrink-0"
              >
                <span>+</span>
                <span>Add Lease</span>
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px] bg-slate-950/30">
                <th className="py-3 px-4">Tenant / Unit</th>
                <th className="py-3 px-4">Deal / Property</th>
                <th className="py-3 px-4 text-right">Rent / Due</th>
                <th className="py-3 px-4">Lease Term</th>
                <th className="py-3 px-4">Escalations</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 text-slate-300">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 text-xs">
                    No lease reconciliation records matching your filter.
                  </td>
                </tr>
              ) : (
                filteredItems.map((row) => {
                  const contractual = Number(row.contractual_rent || 0);
                  const paid = Number(row.amount_paid || 0);
                  const balance = Math.max(0, contractual - paid);
                  const status = (row.payment_status || 'pending').toLowerCase();
                  const lease = leases.find((l) => l.id === row.lease_id);

                  let statusBadge = (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">
                      <Clock className="w-3 h-3" />
                      Pending
                    </span>
                  );

                  if (status === 'paid') {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        Paid
                      </span>
                    );
                  } else if (status === 'partial') {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/30">
                        <AlertTriangle className="w-3 h-3" />
                        Partial
                      </span>
                    );
                  } else if (status === 'snoozed') {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/30" title={row.snooze_until ? `Snoozed until ${row.snooze_until}` : 'Alert Snoozed'}>
                        <Clock className="w-3 h-3" />
                        Snoozed {row.snooze_until ? `(${row.snooze_until.slice(5)})` : ''}
                      </span>
                    );
                  } else if (status === 'overdue') {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/30">
                        <AlertTriangle className="w-3 h-3" />
                        Overdue
                      </span>
                    );
                  }

                  const hasNextEsc = Boolean(lease?.next_escalation_date);
                  const isEscDue = hasNextEsc && new Date(lease!.next_escalation_date!) <= new Date();

                  return (
                    <tr key={row.lease_id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-white">{row.tenant_name}</div>
                        <div className="text-[11px] text-slate-400">
                          {row.unit_number ? `Unit ${row.unit_number}` : 'Whole Facility'}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="text-slate-300 font-medium truncate max-w-[160px]">
                          {row.deal_title || 'Commercial Asset'}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          Period: {row.current_period || 'Current'}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right font-mono">
                        <div className="font-bold text-emerald-400">
                          ${Math.round(contractual).toLocaleString()}
                        </div>
                        {paid > 0 && (
                          <div className="text-[10px] text-slate-400">
                            Paid: ${Math.round(paid).toLocaleString()}
                          </div>
                        )}
                        {balance > 0 && (
                          <div className="text-[10px] text-rose-400 font-bold">
                            Bal: ${Math.round(balance).toLocaleString()}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono text-[11px]">
                        <div className="text-slate-200">
                          {lease?.lease_end_date ? lease.lease_end_date : <span className="text-amber-400/90 font-semibold font-sans">Month-to-Month</span>}
                        </div>
                        <div className="text-[10px] text-slate-500 font-sans">
                          Commenced: <span className="font-mono text-slate-400">{lease?.lease_start_date || 'N/A'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col space-y-0.5">
                          <div className="flex items-center space-x-1.5">
                            <span className="font-mono text-[11px] text-slate-300">
                              {lease?.last_rent_increase_date || lease?.lease_start_date || 'N/A'}
                            </span>
                            {isEscDue ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[9px] font-bold">
                                ⚠️ Escalation Due
                              </span>
                            ) : hasNextEsc ? (
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[9px] font-bold">
                                📈 Scheduled: +{lease?.escalation_rate || 3}%
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[9px] font-bold">
                                ⚠️ Review Due
                              </span>
                            )}
                          </div>
                          {hasNextEsc && (
                            <span className="text-[10px] text-slate-400">
                              {lease?.escalation_frequency || 'Annual'}: <strong className="text-slate-300">+{lease?.escalation_rate || 3}%</strong>
                              {' • Next: '}
                              <span className="font-mono text-slate-300">{lease?.next_escalation_date}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-center">{statusBadge}</td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          {onRentIncrease && (
                            <button
                              onClick={() => onRentIncrease(row)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-750 font-bold text-[11px] transition shadow-sm"
                              title="Record contractual rent escalation"
                            >
                              Escalate
                            </button>
                          )}
                          <button
                            onClick={() => onLogPayment(row)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 font-bold text-[11px] transition shadow-sm"
                          >
                            {row.payment_id ? 'Edit' : 'Log'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
