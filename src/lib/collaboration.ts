// src/lib/collaboration.ts
// MathTree Parameter History (scenario versioning) and Mutual Collaborator Deal Sharing Client Library

export type ScenarioCategory = 'financing' | 'valuation' | 'operations' | 'full_scenario';
export type SharePermission = 'viewer' | 'editor';

export interface ParameterSnapshot {
  id: string;
  deal_id: string;
  user_id: string;
  user_name?: string;
  name: string;
  category: ScenarioCategory;
  inputs: Record<string, any>;
  metrics: Record<string, any>;
  notes?: string | null;
  is_baseline: boolean;
  created_at: string;
  updated_at?: string;
}

export interface ActiveCollaborator {
  connection_id: string;
  collaborator_id: string;
  email: string;
  full_name: string;
  company_name: string;
  shared_deals_count: number;
  connected_at: string;
}

export interface IncomingCollaboratorInvitation {
  invitation_id: string;
  requester_id: string;
  requester_email: string;
  requester_name: string;
  requester_company: string;
  sent_at: string;
}

export interface OutgoingCollaboratorInvitation {
  invitation_id: string;
  recipient_email: string;
  sent_at: string;
  status: string;
}

export interface CollaboratorsHubPayload {
  active: ActiveCollaborator[];
  incoming: IncomingCollaboratorInvitation[];
  outgoing: OutgoingCollaboratorInvitation[];
}

export interface DealShareRecord {
  share_id: string;
  collaborator_id: string;
  collaborator_name: string;
  collaborator_email: string;
  collaborator_company: string;
  permission: SharePermission;
  can_view_scenarios: boolean;
  shared_at: string;
}

// LocalStorage Keys for Demo Mode fallback
const DEMO_SCENARIOS_KEY = 'mathtree_demo_scenarios';
const DEMO_COLLABORATORS_KEY = 'mathtree_demo_collaborators';
const DEMO_SHARES_KEY = 'mathtree_demo_shares';

export class CollaborationService {
  private get supabase(): any {
    return (window as any)._supabase || null;
  }

  private isDemo(): boolean {
    try {
      const demo = localStorage.getItem('mathtree_demo_mode');
      return !!demo;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // 1. PARAMETER HISTORY (SCENARIOS)
  // =========================================================================

  public async saveSnapshot(
    dealId: string,
    name: string,
    category: ScenarioCategory = 'financing',
    inputs?: Record<string, any>,
    notes?: string,
    isBaseline: boolean = false
  ): Promise<{ success: boolean; id?: string; error?: string; message?: string }> {
    if (!this.supabase || this.isDemo() || dealId.startsWith('demo-') || dealId.startsWith('proj-')) {
      return this.saveSnapshotDemo(dealId, name, category, inputs, notes, isBaseline);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_save_parameter_snapshot', {
        p_deal_id: dealId,
        p_name: name,
        p_category: category,
        p_inputs: inputs || null,
        p_notes: notes || null,
        p_is_baseline: isBaseline
      });

      if (error) throw error;
      return data;
    } catch (err: any) {
      console.warn('[CollaborationService] Error saving snapshot to Supabase, falling back to demo store:', err);
      return this.saveSnapshotDemo(dealId, name, category, inputs, notes, isBaseline);
    }
  }

  public async getSnapshots(dealId: string): Promise<ParameterSnapshot[]> {
    if (!this.supabase || this.isDemo() || dealId.startsWith('demo-') || dealId.startsWith('proj-')) {
      return this.getSnapshotsDemo(dealId);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_get_deal_parameter_history', {
        p_deal_id: dealId
      });

      if (error) throw error;
      return (data || []) as ParameterSnapshot[];
    } catch (err: any) {
      console.warn('[CollaborationService] Error getting snapshots from Supabase:', err);
      return this.getSnapshotsDemo(dealId);
    }
  }

  public async restoreSnapshot(historyId: string): Promise<{ success: boolean; error?: string; message?: string }> {
    if (!this.supabase || this.isDemo() || historyId.startsWith('demo-')) {
      return this.restoreSnapshotDemo(historyId);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_restore_parameter_snapshot', {
        p_history_id: historyId
      });

      if (error) throw error;
      return data;
    } catch (err: any) {
      console.warn('[CollaborationService] Error restoring snapshot:', err);
      return this.restoreSnapshotDemo(historyId);
    }
  }

  public async deleteSnapshot(historyId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.supabase || this.isDemo() || historyId.startsWith('demo-')) {
      return this.deleteSnapshotDemo(historyId);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_delete_parameter_snapshot', {
        p_history_id: historyId
      });

      if (error) throw error;
      return data;
    } catch (err: any) {
      console.warn('[CollaborationService] Error deleting snapshot:', err);
      return this.deleteSnapshotDemo(historyId);
    }
  }

  // =========================================================================
  // 2. COLLABORATOR NETWORK (MUTUAL CONNECTIONS)
  // =========================================================================

  public async getCollaboratorsHub(): Promise<CollaboratorsHubPayload> {
    if (!this.supabase || this.isDemo()) {
      return this.getCollaboratorsHubDemo();
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_get_user_collaborators');
      if (error) throw error;
      return {
        active: data?.active || [],
        incoming: data?.incoming || [],
        outgoing: data?.outgoing || []
      };
    } catch (err: any) {
      console.warn('[CollaborationService] Error getting collaborators hub:', err);
      return this.getCollaboratorsHubDemo();
    }
  }

  public async inviteCollaborator(recipientEmail: string): Promise<{ success: boolean; error?: string; message?: string }> {
    if (!this.supabase || this.isDemo()) {
      return this.inviteCollaboratorDemo(recipientEmail);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_invite_collaborator', {
        p_recipient_email: recipientEmail
      });
      if (error) throw error;
      return data;
    } catch (err: any) {
      console.warn('[CollaborationService] Error inviting collaborator:', err);
      return { success: false, error: err.message || 'Failed to send collaborator invitation.' };
    }
  }

  public async respondToInvitation(invitationId: string, action: 'accept' | 'decline'): Promise<{ success: boolean; error?: string; message?: string }> {
    if (!this.supabase || this.isDemo()) {
      return this.respondToInvitationDemo(invitationId, action);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_respond_collaborator_invite', {
        p_invitation_id: invitationId,
        p_action: action
      });
      if (error) throw error;
      return data;
    } catch (err: any) {
      console.warn('[CollaborationService] Error responding to invitation:', err);
      return { success: false, error: err.message || 'Failed to respond to invitation.' };
    }
  }

  // =========================================================================
  // 3. DEAL SHARING
  // =========================================================================

  public async shareDeal(
    dealId: string,
    collaboratorId: string,
    permission: SharePermission = 'viewer',
    canViewScenarios: boolean = true
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    if (!this.supabase || this.isDemo() || dealId.startsWith('demo-') || dealId.startsWith('proj-')) {
      return this.shareDealDemo(dealId, collaboratorId, permission, canViewScenarios);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_share_deal_with_collaborator', {
        p_deal_id: dealId,
        p_collaborator_id: collaboratorId,
        p_permission: permission,
        p_can_view_scenarios: canViewScenarios
      });
      if (error) throw error;
      return data;
    } catch (err: any) {
      console.warn('[CollaborationService] Error sharing deal:', err);
      return { success: false, error: err.message || 'Failed to share deal.' };
    }
  }

  public async revokeShare(dealId: string, collaboratorId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.supabase || this.isDemo() || dealId.startsWith('demo-') || dealId.startsWith('proj-')) {
      return this.revokeShareDemo(dealId, collaboratorId);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_revoke_deal_share', {
        p_deal_id: dealId,
        p_collaborator_id: collaboratorId
      });
      if (error) throw error;
      return data;
    } catch (err: any) {
      console.warn('[CollaborationService] Error revoking share:', err);
      return { success: false, error: err.message || 'Failed to revoke share.' };
    }
  }

  public async getDealShares(dealId: string): Promise<DealShareRecord[]> {
    if (!this.supabase || this.isDemo() || dealId.startsWith('demo-') || dealId.startsWith('proj-')) {
      return this.getDealSharesDemo(dealId);
    }

    try {
      const { data, error } = await this.supabase.rpc('rpc_get_deal_shares', {
        p_deal_id: dealId
      });
      if (error) throw error;
      return (data || []) as DealShareRecord[];
    } catch (err: any) {
      console.warn('[CollaborationService] Error fetching deal shares:', err);
      return this.getDealSharesDemo(dealId);
    }
  }

  // =========================================================================
  // DEMO MODE IN-MEMORY & LOCALSTORAGE IMPLEMENTATIONS
  // =========================================================================

  private getDemoScenarios(): Record<string, ParameterSnapshot[]> {
    try {
      const raw = localStorage.getItem(DEMO_SCENARIOS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private saveDemoScenarios(scenarios: Record<string, ParameterSnapshot[]>): void {
    try {
      localStorage.setItem(DEMO_SCENARIOS_KEY, JSON.stringify(scenarios));
    } catch {}
  }

  private saveSnapshotDemo(
    dealId: string,
    name: string,
    category: ScenarioCategory,
    inputs?: Record<string, any>,
    notes?: string,
    isBaseline: boolean = false
  ) {
    const all = this.getDemoScenarios();
    const dealList = all[dealId] || [];

    if (isBaseline) {
      dealList.forEach(s => { s.is_baseline = false; });
    }

    const newSnapshot: ParameterSnapshot = {
      id: `demo-snap-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      deal_id: dealId,
      user_id: 'demo-user',
      user_name: 'Demo Analyst',
      name: name.trim(),
      category,
      inputs: inputs || {},
      metrics: inputs?.metrics || {},
      notes: notes || null,
      is_baseline: isBaseline,
      created_at: new Date().toISOString()
    };

    dealList.unshift(newSnapshot);
    all[dealId] = dealList;
    this.saveDemoScenarios(all);

    return {
      success: true,
      id: newSnapshot.id,
      name: newSnapshot.name,
      category: newSnapshot.category,
      message: 'Demo parameter scenario snapshot saved.'
    };
  }

  private getSnapshotsDemo(dealId: string): ParameterSnapshot[] {
    const all = this.getDemoScenarios();
    const list = all[dealId] || [];
    if (list.length === 0) {
      // Provide default realistic sample snapshots for demo exploration
      const sampleSnapshots: ParameterSnapshot[] = [
        {
          id: `demo-default-1-${dealId}`,
          deal_id: dealId,
          user_id: 'demo-user',
          user_name: 'Lead Underwriter',
          name: 'Baseline 65% LTV Agency Fixed',
          category: 'financing',
          inputs: { downPaymentPercent: 35, interestRate: 6.25, loanTerm: 30, exitCapRate: 6.25 },
          metrics: { noi: 642000, dscr: 1.34, cashFlow: 162400, cashOnCash: 8.4, irr: 18.2 },
          notes: 'Standard Fannie Mae DUS loan quote with 30-year amortization.',
          is_baseline: true,
          created_at: new Date(Date.now() - 86400000 * 3).toISOString()
        },
        {
          id: `demo-default-2-${dealId}`,
          deal_id: dealId,
          user_id: 'demo-user',
          user_name: 'Lead Underwriter',
          name: 'Value-Add Bridge Loan (80% LTC @ 9.0% IO)',
          category: 'financing',
          inputs: { downPaymentPercent: 20, interestRate: 9.0, loanTerm: 24, rehabBudget: 350000, exitCapRate: 5.75 },
          metrics: { noi: 785000, dscr: 1.18, cashFlow: 198000, cashOnCash: 11.2, irr: 22.8 },
          notes: 'Bridge execution with $350k renovation facility and 2-year interest-only period.',
          is_baseline: false,
          created_at: new Date(Date.now() - 86400000).toISOString()
        }
      ];
      all[dealId] = sampleSnapshots;
      this.saveDemoScenarios(all);
      return sampleSnapshots;
    }
    return list;
  }

  private restoreSnapshotDemo(historyId: string) {
    const all = this.getDemoScenarios();
    for (const dId of Object.keys(all)) {
      const snap = all[dId].find(s => s.id === historyId);
      if (snap) {
        return {
          success: true,
          deal_id: dId,
          snapshot_id: snap.id,
          name: snap.name,
          message: 'Scenario restored in demo mode.'
        };
      }
    }
    return { success: false, error: 'Snapshot not found.' };
  }

  private deleteSnapshotDemo(historyId: string) {
    const all = this.getDemoScenarios();
    for (const dId of Object.keys(all)) {
      const idx = all[dId].findIndex(s => s.id === historyId);
      if (idx !== -1) {
        all[dId].splice(idx, 1);
        this.saveDemoScenarios(all);
        return { success: true };
      }
    }
    return { success: false, error: 'Snapshot not found.' };
  }

  private getCollaboratorsHubDemo(): CollaboratorsHubPayload {
    return {
      active: [
        {
          connection_id: 'demo-conn-1',
          collaborator_id: 'demo-partner-1',
          email: 'sarah.lin@apexcapital.internal',
          full_name: 'Sarah Lin',
          company_name: 'Apex Real Estate Partners',
          shared_deals_count: 2,
          connected_at: new Date(Date.now() - 86400000 * 14).toISOString()
        },
        {
          connection_id: 'demo-conn-2',
          collaborator_id: 'demo-partner-2',
          email: 'marcus.vance@cascadeinvest.internal',
          full_name: 'Marcus Vance',
          company_name: 'Cascade Property Holdings',
          shared_deals_count: 1,
          connected_at: new Date(Date.now() - 86400000 * 7).toISOString()
        }
      ],
      incoming: [
        {
          invitation_id: 'demo-invite-in-1',
          requester_id: 'demo-partner-3',
          requester_email: 'elena.rostova@meridianfund.internal',
          requester_name: 'Elena Rostova',
          requester_company: 'Meridian Capital Group',
          sent_at: new Date(Date.now() - 86400000 * 2).toISOString()
        }
      ],
      outgoing: []
    };
  }

  private inviteCollaboratorDemo(recipientEmail: string) {
    return {
      success: true,
      status: 'pending',
      message: `Demo invitation sent to ${recipientEmail}. (Demo Mode simulated).`
    };
  }

  private respondToInvitationDemo(invitationId: string, action: 'accept' | 'decline') {
    return {
      success: true,
      status: action === 'accept' ? 'accepted' : 'declined',
      message: `Demo invitation ${action}ed.`
    };
  }

  private shareDealDemo(dealId: string, collaboratorId: string, permission: SharePermission, canViewScenarios: boolean) {
    return {
      success: true,
      share_id: `demo-share-${Date.now()}`,
      deal_id: dealId,
      collaborator_id: collaboratorId,
      permission,
      message: 'Deal shared in demo mode.'
    };
  }

  private revokeShareDemo(dealId: string, collaboratorId: string) {
    return { success: true };
  }

  private getDealSharesDemo(dealId: string): DealShareRecord[] {
    return [
      {
        share_id: 'demo-share-rec-1',
        collaborator_id: 'demo-partner-1',
        collaborator_name: 'Sarah Lin',
        collaborator_email: 'sarah.lin@apexcapital.internal',
        collaborator_company: 'Apex Real Estate Partners',
        permission: 'editor',
        can_view_scenarios: true,
        shared_at: new Date(Date.now() - 86400000 * 3).toISOString()
      }
    ];
  }
}

export const collaborationService = new CollaborationService();

// Expose globally on window for direct HTML script consumption
if (typeof window !== 'undefined') {
  (window as any).MathTreeCollaboration = collaborationService;
}
