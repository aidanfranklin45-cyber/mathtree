// collaboration-service.js
// Browser client engine for MathTree Parameter History (scenario versioning)
// and Mutual Collaborator Deal Sharing. Supports direct Supabase RPC calls with Demo Mode fallback.

(function (window) {
  'use strict';

  var DEMO_SCENARIOS_KEY = 'mathtree_demo_scenarios';
  var DEMO_COLLABORATORS_KEY = 'mathtree_demo_collaborators';
  var DEMO_SHARES_KEY = 'mathtree_demo_shares';

  function isDemoMode() {
    try {
      return !!localStorage.getItem('mathtree_demo_mode');
    } catch (e) {
      return false;
    }
  }

  function getSupabase() {
    return window._supabase || null;
  }

  // =========================================================================
  // 1. PARAMETER HISTORY (SCENARIOS)
  // =========================================================================

  function getDemoScenarios() {
    try {
      var raw = localStorage.getItem(DEMO_SCENARIOS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveDemoScenarios(scenarios) {
    try {
      localStorage.setItem(DEMO_SCENARIOS_KEY, JSON.stringify(scenarios));
    } catch (e) {}
  }

  var CollaborationService = {
    // Save a parameter snapshot
    saveSnapshot: async function (dealId, name, category, inputs, notes, isBaseline) {
      category = category || 'financing';
      var sb = getSupabase();
      if (!sb || isDemoMode() || (dealId && (dealId.indexOf('demo-') === 0 || dealId.indexOf('proj-') === 0))) {
        var all = getDemoScenarios();
        var list = all[dealId] || [];
        if (isBaseline) {
          list.forEach(function (s) { s.is_baseline = false; });
        }
        var newSnap = {
          id: 'demo-snap-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          deal_id: dealId,
          user_id: 'demo-user',
          user_name: 'Lead Underwriter',
          name: (name || 'Scenario Snapshot').trim(),
          category: category,
          inputs: inputs || {},
          metrics: (inputs && inputs.metrics) || {},
          notes: notes || null,
          is_baseline: !!isBaseline,
          created_at: new Date().toISOString()
        };
        list.unshift(newSnap);
        all[dealId] = list;
        saveDemoScenarios(all);
        return { success: true, id: newSnap.id, name: newSnap.name, message: 'Scenario snapshot saved.' };
      }

      try {
        var res = await sb.rpc('rpc_save_parameter_snapshot', {
          p_deal_id: dealId,
          p_name: name,
          p_category: category,
          p_inputs: inputs || null,
          p_notes: notes || null,
          p_is_baseline: !!isBaseline
        });
        if (res.error) throw res.error;
        return res.data;
      } catch (err) {
        console.warn('[Collaboration] Supabase saveSnapshot error, falling back to local:', err);
        return this.saveSnapshot(dealId, name, category, inputs, notes, isBaseline);
      }
    },

    // Retrieve all parameter snapshots for a deal
    getSnapshots: async function (dealId) {
      var sb = getSupabase();
      if (!sb || isDemoMode() || (dealId && (dealId.indexOf('demo-') === 0 || dealId.indexOf('proj-') === 0))) {
        var all = getDemoScenarios();
        var list = all[dealId] || [];
        if (list.length === 0) {
          list = [
            {
              id: 'demo-default-1-' + dealId,
              deal_id: dealId,
              user_id: 'demo-user',
              user_name: 'Lead Underwriter',
              name: 'Baseline 65% LTV Agency Fixed',
              category: 'financing',
              inputs: { downPaymentPercent: 35, interestRate: 6.25, loanTerm: 30, exitCapRate: 6.25 },
              metrics: { noi: 642000, dscr: 1.34, cashFlow: 162400, cashOnCash: 8.4, irr: 18.2 },
              notes: 'Standard Fannie Mae DUS quote @ 6.25% with 30-year amort.',
              is_baseline: true,
              created_at: new Date(Date.now() - 86400000 * 3).toISOString()
            },
            {
              id: 'demo-default-2-' + dealId,
              deal_id: dealId,
              user_id: 'demo-user',
              user_name: 'Lead Underwriter',
              name: 'Value-Add Bridge Loan (80% LTC @ 9.0% IO)',
              category: 'financing',
              inputs: { downPaymentPercent: 20, interestRate: 9.0, loanTerm: 24, rehabBudget: 350000, exitCapRate: 5.75 },
              metrics: { noi: 785000, dscr: 1.18, cashFlow: 198000, cashOnCash: 11.2, irr: 22.8 },
              notes: 'Bridge loan execution with $350k renovation facility and 2-year interest-only period.',
              is_baseline: false,
              created_at: new Date(Date.now() - 86400000).toISOString()
            }
          ];
          all[dealId] = list;
          saveDemoScenarios(all);
        }
        return list;
      }

      try {
        var res = await sb.rpc('rpc_get_deal_parameter_history', { p_deal_id: dealId });
        if (res.error) throw res.error;
        return res.data || [];
      } catch (err) {
        console.warn('[Collaboration] Supabase getSnapshots error:', err);
        return [];
      }
    },

    // Restore snapshot to active deal
    restoreSnapshot: async function (historyId) {
      var sb = getSupabase();
      if (!sb || isDemoMode() || (historyId && historyId.indexOf('demo-') === 0)) {
        var all = getDemoScenarios();
        for (var k in all) {
          var found = all[k].find(function (s) { return s.id === historyId; });
          if (found) {
            return { success: true, snapshot: found, message: 'Scenario restored in demo mode.' };
          }
        }
        return { success: false, error: 'Snapshot not found.' };
      }

      try {
        var res = await sb.rpc('rpc_restore_parameter_snapshot', { p_history_id: historyId });
        if (res.error) throw res.error;
        return res.data;
      } catch (err) {
        console.warn('[Collaboration] Supabase restoreSnapshot error:', err);
        return { success: false, error: err.message || 'Failed to restore snapshot.' };
      }
    },

    // Delete parameter snapshot
    deleteSnapshot: async function (historyId) {
      var sb = getSupabase();
      if (!sb || isDemoMode() || (historyId && historyId.indexOf('demo-') === 0)) {
        var all = getDemoScenarios();
        for (var k in all) {
          var idx = all[k].findIndex(function (s) { return s.id === historyId; });
          if (idx !== -1) {
            all[k].splice(idx, 1);
            saveDemoScenarios(all);
            return { success: true };
          }
        }
        return { success: false, error: 'Snapshot not found.' };
      }

      try {
        var res = await sb.rpc('rpc_delete_parameter_snapshot', { p_history_id: historyId });
        if (res.error) throw res.error;
        return res.data;
      } catch (err) {
        console.warn('[Collaboration] Supabase deleteSnapshot error:', err);
        return { success: false, error: err.message || 'Failed to delete snapshot.' };
      }
    },

    // =========================================================================
    // 2. COLLABORATOR NETWORK (MUTUAL INVITATIONS)
    // =========================================================================

    getCollaboratorsHub: async function () {
      var sb = getSupabase();
      if (!sb || isDemoMode()) {
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

      try {
        var res = await sb.rpc('rpc_get_user_collaborators');
        if (res.error) throw res.error;
        return {
          active: (res.data && res.data.active) || [],
          incoming: (res.data && res.data.incoming) || [],
          outgoing: (res.data && res.data.outgoing) || []
        };
      } catch (err) {
        console.warn('[Collaboration] Supabase getCollaboratorsHub error:', err);
        return { active: [], incoming: [], outgoing: [] };
      }
    },

    inviteCollaborator: async function (recipientEmail) {
      var clean = (recipientEmail || '').toLowerCase().trim();
      if (!clean || clean.indexOf('@') === -1) {
        return { success: false, error: 'Please provide a valid email address.' };
      }

      var sb = getSupabase();
      if (!sb || isDemoMode()) {
        return {
          success: true,
          status: 'pending',
          message: 'Invitation sent to ' + clean + '. (Demo simulated: accepted once reciprocal).'
        };
      }

      try {
        var res = await sb.rpc('rpc_invite_collaborator', { p_recipient_email: clean });
        if (res.error) throw res.error;
        return res.data;
      } catch (err) {
        console.warn('[Collaboration] Supabase inviteCollaborator error:', err);
        return { success: false, error: err.message || 'Failed to send invitation.' };
      }
    },

    respondToInvitation: async function (invitationId, action) {
      var sb = getSupabase();
      if (!sb || isDemoMode() || (invitationId && invitationId.indexOf('demo-') === 0)) {
        return {
          success: true,
          status: action === 'accept' ? 'accepted' : 'declined',
          message: 'Invitation ' + action + 'ed successfully.'
        };
      }

      try {
        var res = await sb.rpc('rpc_respond_collaborator_invite', {
          p_invitation_id: invitationId,
          p_action: action
        });
        if (res.error) throw res.error;
        return res.data;
      } catch (err) {
        console.warn('[Collaboration] Supabase respondToInvitation error:', err);
        return { success: false, error: err.message || 'Failed to respond.' };
      }
    },

    // =========================================================================
    // 3. DEAL SHARING
    // =========================================================================

    shareDeal: async function (dealId, collaboratorId, permission, canViewScenarios) {
      permission = permission || 'viewer';
      canViewScenarios = canViewScenarios !== false;

      var sb = getSupabase();
      if (!sb || isDemoMode() || (dealId && (dealId.indexOf('demo-') === 0 || dealId.indexOf('proj-') === 0))) {
        return {
          success: true,
          share_id: 'demo-share-' + Date.now(),
          deal_id: dealId,
          collaborator_id: collaboratorId,
          permission: permission,
          message: 'Deal shared with collaborator.'
        };
      }

      try {
        var res = await sb.rpc('rpc_share_deal_with_collaborator', {
          p_deal_id: dealId,
          p_collaborator_id: collaboratorId,
          p_permission: permission,
          p_can_view_scenarios: canViewScenarios
        });
        if (res.error) throw res.error;
        return res.data;
      } catch (err) {
        console.warn('[Collaboration] Supabase shareDeal error:', err);
        return { success: false, error: err.message || 'Failed to share deal.' };
      }
    },

    revokeShare: async function (dealId, collaboratorId) {
      var sb = getSupabase();
      if (!sb || isDemoMode() || (dealId && (dealId.indexOf('demo-') === 0 || dealId.indexOf('proj-') === 0))) {
        return { success: true };
      }

      try {
        var res = await sb.rpc('rpc_revoke_deal_share', {
          p_deal_id: dealId,
          p_collaborator_id: collaboratorId
        });
        if (res.error) throw res.error;
        return res.data;
      } catch (err) {
        console.warn('[Collaboration] Supabase revokeShare error:', err);
        return { success: false, error: err.message || 'Failed to revoke share.' };
      }
    },

    getDealShares: async function (dealId) {
      var sb = getSupabase();
      if (!sb || isDemoMode() || (dealId && (dealId.indexOf('demo-') === 0 || dealId.indexOf('proj-') === 0))) {
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

      try {
        var res = await sb.rpc('rpc_get_deal_shares', { p_deal_id: dealId });
        if (res.error) throw res.error;
        return res.data || [];
      } catch (err) {
        console.warn('[Collaboration] Supabase getDealShares error:', err);
        return [];
      }
    }
  };

  window.MathTreeCollaboration = CollaborationService;

})(typeof window !== 'undefined' ? window : this);
