import React, { Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DealRecord } from '../../../lib/math/types';
import { operationsPrefetchProps } from '../../../lib/prefetchRoutes';
import { supabase } from '../../../lib/supabase/client';
import { ExpenseLedger } from '../../operations/ExpenseLedger';

// Loaded on demand so the deal screen's main chunk stays small; it is the same workspace the Operations page runs.
const OperationsWorkspace = React.lazy(() => import('../../operations/OperationsWorkspace').then((m) => ({ default: m.OperationsWorkspace })));

interface Props {
  deal: DealRecord;
}

/**
 * Everything about running this one property: needs-attention items, rent roll, payments, rent increases, NNN recoveries and
 * lease expiries. It is the Operations workspace locked to this deal (same components, same numbers), so the portfolio-wide
 * Property Management page and this tab can never disagree.
 */
export const OperateTab: React.FC<Props> = ({ deal }) => {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUserId(data?.session?.user?.id ?? null));
  }, []);

  return (
  <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-extrabold text-white">Operate</h2>
        <p className="text-xs text-slate-400 mt-0.5">Tenants, rent and recoveries for this property.</p>
      </div>
      <Link to="/operations" {...operationsPrefetchProps} className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition">
        All properties in Property Management →
      </Link>
    </div>
    <Suspense fallback={<p className="text-xs text-slate-500">Loading rent roll…</p>}>
      <OperationsWorkspace lockedDealId={deal.id} />
    </Suspense>

    {/* Expenses live here, on the property's own page, and nowhere else */}
    <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-3">
      <div>
        <h3 className="text-sm font-extrabold text-white">Expenses</h3>
        <p className="text-xs text-slate-400 mt-0.5">Record what this property actually costs to run (tax, insurance, repairs, utilities).</p>
      </div>
      {userId ? <ExpenseLedger dealId={deal.id} userId={userId} /> : <p className="text-xs text-slate-500">Sign in to record expenses.</p>}
    </div>
  </div>
  );
};
