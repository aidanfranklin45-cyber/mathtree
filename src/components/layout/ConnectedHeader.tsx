import React, { useState } from 'react';
import type { DealRecord } from '../../lib/math/types';
import type { InvestorProfile } from '../../lib/profile';
import { useNotifications } from '../../lib/useNotifications';
import { AppHeader } from './AppHeader';
import { InvestorProfileModal } from './InvestorProfileModal';
import { NotificationHub } from './NotificationHub';
import { EntityManagerModal, type EntityTarget } from './EntityManagerModal';
import { openPortfolioBrief } from '../../lib/export/pdfBrief';

interface Props {
  active: 'portfolio' | 'operations' | 'compare';
  /** Deals the page has loaded (owned + shared with me); used by the Investor Profile. */
  deals?: DealRecord[];
  onProfileSaved?: (profile: InvestorProfile) => void;
  /** Called when shares change or a pro-forma sync rewrites deal inputs, so the page can reload. */
  onDealsChanged?: () => void;
  extraActions?: React.ReactNode;
  /** Hide the account dropdown (Investor Profile, Alerts, Export) on pages that don't need it. */
  hideAccountMenu?: boolean;
}

/**
 * The shared page header plus everything it opens: Action Center (alerts), and Investor Profile.
 * Pages render this once instead of wiring the modals each.
 */
export const ConnectedHeader: React.FC<Props> = ({ active, deals = [], onProfileSaved, onDealsChanged, extraActions, hideAccountMenu }) => {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [entitiesOpen, setEntitiesOpen] = useState(false);
  const [entityTarget, setEntityTarget] = useState<EntityTarget | null>(null);
  const [returnToProfile, setReturnToProfile] = useState(false);
  const { notifications, refresh, dismiss } = useNotifications();

  return (
    <>
      <AppHeader
        active={active}
        onOpenAlerts={() => { setAlertsOpen(true); void refresh(); }}
        onOpenProfile={() => setProfileOpen(true)}
        onExportPortfolio={openPortfolioBrief}
        alertCount={notifications.length > 9 ? 9 : notifications.length}
        extraActions={extraActions}
        hideAccountMenu={hideAccountMenu}
      />
      <NotificationHub
        isOpen={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        notifications={notifications}
        onRefresh={refresh}
        onDismiss={dismiss}
        onAssignEntity={(dealId, dealTitle) => { setEntityTarget({ dealId, dealTitle }); setReturnToProfile(false); setEntitiesOpen(true); }}
      />
      <InvestorProfileModal
        isOpen={profileOpen}
        deals={deals}
        onClose={() => setProfileOpen(false)}
        onSaved={(p) => { onProfileSaved?.(p); onDealsChanged?.(); }}
        onOpenEntities={() => { setProfileOpen(false); setEntityTarget(null); setReturnToProfile(true); setEntitiesOpen(true); }}
      />
      <EntityManagerModal
        isOpen={entitiesOpen}
        onClose={() => { setEntitiesOpen(false); setReturnToProfile(false); setEntityTarget(null); }}
        target={entityTarget}
        onClearTarget={() => setEntityTarget(null)}
        onBack={() => { setEntitiesOpen(false); setEntityTarget(null); if (returnToProfile) { setReturnToProfile(false); setProfileOpen(true); } }}
        onChanged={onDealsChanged}
      />
    </>
  );
};
