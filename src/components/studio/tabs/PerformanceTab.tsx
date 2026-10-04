import React from 'react';
import type { DealMetrics, DealRecord } from '../../../lib/math/types';
import { PerformanceVsProforma } from '../PerformanceVsProforma';

interface Props {
  deal: DealRecord;
  metrics: DealMetrics;
}

/** Owned properties lead here: what was expected at purchase, today's outlook, and what is actually being collected. */
export const PerformanceTab: React.FC<Props> = ({ deal, metrics }) => (
  <div className="space-y-5">
    <div>
      <h2 className="text-base font-extrabold text-white">Performance</h2>
      <p className="text-xs text-slate-400 mt-0.5">How this property is doing against what was expected when you bought it.</p>
    </div>
    <PerformanceVsProforma deal={deal} metrics={metrics} />
  </div>
);
