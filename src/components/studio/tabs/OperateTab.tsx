import React, { Suspense } from 'react';
import { Link } from 'react-router-dom';
import type { DealRecord } from '../../../lib/math/types';
import { operationsPrefetchProps } from '../../../lib/prefetchRoutes';

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
  </div>
  );
};
