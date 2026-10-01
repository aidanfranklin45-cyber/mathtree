import React, { useState } from 'react';
import type { DealRecord } from '../../lib/math/types';
import type { InvestorProfile } from '../../lib/profile';
import { useNotifications } from '../../lib/useNotifications';
import { AppHeader } from './AppHeader';
import { InvestorProfileModal } from './InvestorProfileModal';
import { NotificationHub } from './NotificationHub';
import { CollaboratorsHubModal } from '../collaboration/CollaboratorsHubModal';
import { EntityManagerModal, type EntityTarget } from './EntityManagerModal';

interface Props {
  active: 'portfolio' | 'operations';
  /** Deals the page has loaded (owned + shared with me); used by the Collaborators hub. */
  deals?: DealRecord[];
  onProfileSaved?: (profile: InvestorProfile) => void;
  /** Called when shares change or a pro-forma sync rewrites deal inputs, so the page can reload. */
  onDealsChanged?: () => void;
  extraActions?: React.ReactNode;
}

/**
 * The shared page header plus everything it opens: Action Center (alerts), Collaborators hub and
 * Investor Profile. Pages render this once instead of wiring three modals each.
 */
export const ConnectedHeader: React.FC<Props> = ({ active, deals = [], onProfileSaved, onDealsChanged, extraActions }) => {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [entitiesOpen, setEntitiesOpen] = useState(false);
  const [entityTarget, setEntityTarget] = useState<EntityTarget | null>(null);
  const [returnToProfile, setReturnToProfile] = useState(false);
  const { notifications, refresh, dismiss } = useNotifications();

  const sharedWithMe = deals.filter((d) => d.is_shared).length;

  return (
    <>
      <AppHeader
        active={active}
        onOpenAlerts={() => { setAlertsOpen(true); void refresh(); }}
        onOpenCollaborators={() => setCollabOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        alertCount={notifications.length > 9 ? 9 : notifications.length}
        collaboratorInviteCount={sharedWithMe}
        extraActions={extraActions}
      />
      <NotificationHub
        isOpen={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        notifications={notifications}
        onRefresh={refresh}
        onDismiss={dismiss}
        onAssignEntity={(dealId, dealTitle) => { setEntityTarget({ dealId, dealTitle }); setReturnToProfile(false); setEntitiesOpen(true); }}
      />
      <CollaboratorsHubModal isOpen={collabOpen} onClose={() => setCollabOpen(false)} deals={deals} onChanged={onDealsChanged} />
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
