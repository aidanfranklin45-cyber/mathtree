import React from 'react';
import { ConnectedHeader } from '../components/layout/ConnectedHeader';
import { OperationsWorkspace } from '../components/operations/OperationsWorkspace';

/**
 * The portfolio-wide Property Management page: every property, overdue rent, expiring leases. All the loading, actions and
 * tables live in OperationsWorkspace, which a deal's Operate tab also renders for just that one property, so a figure
 * is computed in one place.
 */
export const OperationsPage: React.FC = () => (
  <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
    <OperationsWorkspace
      renderHeader={({ deals, reload, actions }) => (
        <ConnectedHeader active="operations" deals={deals as any} hideAccountMenu onDealsChanged={reload} extraActions={actions} />
      )}
    />
  </div>
);
