import React, { useEffect, useState } from 'react';
import type { DealRecord } from '../../lib/math/types';
import type { InvestorProfile } from '../../lib/profile';
import { useInbox } from '../../lib/operations/useInbox';
import { AppHeader } from './AppHeader';
import { InvestorProfileModal } from './InvestorProfileModal';
import { InboxPanel } from './InboxPanel';
import { openPortfolioBrief } from '../../lib/export/pdfBrief';

interface Props {
  active: 'portfolio' | 'operations' | 'compare' | 'bank';
  /** Deals the page has loaded (owned + shared with me); used by the Investor Profile. */
  deals?: DealRecord[];
  onProfileSaved?: (profile: InvestorProfile) => void;
  /** Called when shares change, so the page can reload. */
  onDealsChanged?: () => void;
  extraActions?: React.ReactNode;
  /** Hide the account dropdown (Investor Profile, Alerts, Export) on pages that don't need it. */
  hideAccountMenu?: boolean;
}

/**
 * The shared page header plus everything it opens: the needs-attention inbox (bell), and Investor Profile.
 * Pages render this once instead of wiring the modals each.
 */
export const ConnectedHeader: React.FC<Props> = ({ active, deals = [], onProfileSaved, onDealsChanged, extraActions, hideAccountMenu }) => {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { items, loading, refresh } = useInbox();

  useEffect(() => {
    const handleOpenProfile = () => setProfileOpen(true);
    window.addEventListener('mathtree:open-profile', handleOpenProfile);
    return () => window.removeEventListener('mathtree:open-profile', handleOpenProfile);
  }, []);

  return (
    <>
      <AppHeader
        active={active}
        onOpenAlerts={() => { setAlertsOpen(true); void refresh(); }}
        onOpenProfile={() => setProfileOpen(true)}
        onExportPortfolio={openPortfolioBrief}
        alertCount={items.length > 9 ? 9 : items.length}
        extraActions={extraActions}
        hideAccountMenu={hideAccountMenu}
      />
      <InboxPanel
        isOpen={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        items={items}
        loading={loading}
        onRefresh={refresh}
      />
      <InvestorProfileModal
        isOpen={profileOpen}
        deals={deals}
        onClose={() => setProfileOpen(false)}
        onSaved={(p) => { onProfileSaved?.(p); onDealsChanged?.(); }}
      />
    </>
  );
};
