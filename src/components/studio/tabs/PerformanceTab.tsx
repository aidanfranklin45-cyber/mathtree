import React from 'react';
import type { DealMetrics, DealRecord } from '../../../lib/math/types';
import { PerformanceVsProforma } from '../PerformanceVsProforma';
import { PropertyStateCard } from '../../performance/PropertyStateCard';
import { AssumptionsSourcesTable } from '../../performance/AssumptionsSourcesTable';

interface Props {
  deal: DealRecord;
  metrics: DealMetrics;
}

/**
 * Performance Tab:
 * 1. Live Property State (resolvePropertyState): Contracted vs Collected vs Underwriting Forecast.
 * 2. Performance vs Pro-Forma: Expected at purchase vs today's outlook vs what is actually collected.
 * 3. Assumptions and Sources: Bankable lender audit trail of all underwriting assumptions and justifications.
 */
export const PerformanceTab: React.FC<Props> = ({ deal, metrics }) => (
  <div className="space-y-6">
    <div>
      <h2 className="text-base font-extrabold text-white">Performance &amp; Operational Verification</h2>
      <p className="text-xs text-slate-400 mt-0.5">
        Live operational facts, underwriting baseline comparisons, and documented assumptions for institutional review.
      </p>
    </div>

    {/* 1. Point-in-time property state resolved from contracts and payments */}
    <PropertyStateCard deal={deal} metrics={metrics} />

    {/* 2. Baseline comparison: acquisition expectations vs live outlook */}
    <PerformanceVsProforma deal={deal} metrics={metrics} />

    {/* 3. Underwriting assumptions and sources table for lender packages */}
    <AssumptionsSourcesTable deal={deal} />
  </div>
);

