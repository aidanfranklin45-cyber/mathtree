import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DealRecord } from '../../../lib/math/types';
import { loadActuals } from '../../../lib/baselines/db';
import type { LeaseLite, PaymentLite } from '../../../lib/baselines/core';
import { summarizeOperate } from '../../../lib/studio/stageLens';
import { formatCurrency } from '../../../lib/format';
import { operationsPrefetchProps } from '../../../lib/prefetchRoutes';
import { supabase } from '../../../lib/supabase/client';
import { ExpenseLedger } from '../../operations/ExpenseLedger';

interface Props {
  deal: DealRecord;
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

/** A short look at this property's rent roll and recent collections, with links into Operations for the full tools. */
export const OperateTab: React.FC<Props> = ({ deal }) => {
  const [leases, setLeases] = useState<LeaseLite[]>([]);
  const [payments, setPayments] = useState<PaymentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUserId(data?.session?.user?.id ?? null));
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadActuals(deal.id, new Date().getFullYear() - 1).then((a) => {
      if (!live) return;
      setLeases(a.leases);
      setPayments(a.payments);
      setLoading(false);
    });
    return () => { live = false; };
  }, [deal.id]);

  const summary = useMemo(() => summarizeOperate(leases, payments), [leases, payments]);
  const btn = 'px-3 py-2 rounded-xl text-xs font-bold border transition';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-extrabold text-white">Operate</h2>
        <p className="text-xs text-slate-400 mt-0.5">Tenants and rent for this property. Log payments, edit leases and send notices in Operations.</p>
      </div>

      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl">
        {loading ? (
          <p className="text-xs text-slate-500">Loading rent roll…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div>
                <span className="block text-[10px] uppercase font-extrabold tracking-wider text-slate-400">Active leases</span>
                <span className="block text-2xl font-black text-white font-mono">{summary.activeLeases}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase font-extrabold tracking-wider text-slate-400">Contract rent / month</span>
                <span className="block text-2xl font-black text-white font-mono">{formatCurrency(summary.monthlyContractRent)}</span>
              </div>
            </div>

            <div className="mt-5">
              <span className="block text-[10px] uppercase font-extrabold tracking-wider text-slate-400 mb-2">Recent months with payment records</span>
              {summary.recent.length === 0 ? (
                <p className="text-xs text-slate-500">No payments recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-800/60 text-xs">
                  {summary.recent.map((r) => (
                    <li key={r.month} className="py-2 flex items-center justify-between">
                      <span className="font-semibold text-slate-200">{monthLabel(r.month)}</span>
                      <span className="font-mono text-slate-300">
                        {formatCurrency(r.paid)} <span className="text-slate-500">of {formatCurrency(r.due)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-3">
        <div>
          <h3 className="text-sm font-extrabold text-white">Expenses</h3>
          <p className="text-xs text-slate-400 mt-0.5">Record what this property actually costs to run (tax, insurance, repairs, utilities).</p>
        </div>
        {userId ? <ExpenseLedger dealId={deal.id} userId={userId} /> : <p className="text-xs text-slate-500">Sign in to record expenses.</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/operations" {...operationsPrefetchProps} className={`${btn} text-emerald-300 bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400/60`}>
          Open Operations
        </Link>
        <Link to={`/operations?action=add-lease&deal_id=${encodeURIComponent(deal.id)}`} {...operationsPrefetchProps} className={`${btn} text-slate-200 bg-slate-900 border-slate-800 hover:border-slate-700`}>
          Add a lease
        </Link>
      </div>
    </div>
  );
};
