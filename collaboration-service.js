// collaboration-service.js
// Supabase Edge Function Client for Collaborator Groups, Deal Sharing, and Auto Scenario Engine
// Replaces deprecated direct-RPC connection model with server-side Edge Functions.

(function (window) {
  'use strict';

  function isDemoMode() {
    try {
      if (window._isDemoUser || window._demoMode) return true;
      return !!localStorage.getItem('mathtree_demo_mode');
    } catch (e) {
      return false;
    }
  }

  function getSupabase() {
    return window._supabase || null;
  }

  async function invokeEdgeFunction(functionName, body) {
    const sb = getSupabase();
    if (sb && sb.functions && !isDemoMode()) {
      try {
        const { data, error } = await sb.functions.invoke(functionName, { body });
        if (error) throw error;
        return data;
      } catch (err) {
        console.warn(`[EdgeFunction] ${functionName} invocation error:`, err);
        // Fallback to fetch if invoke failed
        try {
          const session = await (sb.auth?.getSession() || Promise.resolve({ data: {} }));
          const token = session?.data?.session?.access_token || window.SUPABASE_ANON_KEY || '';
          const anonKey = window.SUPABASE_ANON_KEY || '';
          const res = await fetch(`https://bgexwcepwbxvhxbpblhd.supabase.co/functions/v1/${functionName}`, {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'apikey': anonKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          });
          if (res.ok) return await res.json();
        } catch (fetchErr) {
          console.warn(`[EdgeFunction] Direct fetch fallback failed:`, fetchErr);
        }
      }
    }
    return null;
  }

  // Local demo store fallback for sandbox testing
  var DEMO_STORAGE_KEY = 'mathtree_demo_groups_hub';
  function getDemoHub() {
    try {
      var raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {
      groups: [
        {
          id: 'demo-grp-acq',
          name: 'Acquisitions Committee',
          description: 'Principal underwriting team',
          created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
          collaborator_group_members: [
            { id: 'dm-1', member_email: 'sarah.lin@apexcapital.internal' },
            { id: 'dm-2', member_email: 'marcus.vance@cascadeinvest.internal' }
          ]
        },
        {
          id: 'demo-grp-equity',
          name: 'LP Equity Partners',
          description: 'Co-investment capital group',
          created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
          collaborator_group_members: [
            { id: 'dm-3', member_email: 'elena.rostova@meridianfund.internal' }
          ]
        }
      ],
      shares: [
        {
          id: 'demo-sh-1',
          deal_id: 'demo-deal-1',
          group_id: 'demo-grp-acq',
          permission: 'editor',
          can_view_scenarios: true,
          created_at: new Date(Date.now() - 86400000 * 3).toISOString()
        }
      ],
      runs: {}
    };
  }

  function saveDemoHub(hub) {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(hub));
    } catch(e) {}
  }

  var CollaborationService = {
    // =========================================================================
    // 1. COLLABORATOR GROUPS & HUB
    // =========================================================================
    getHubData: async function () {
      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-collaboration', { action: 'list_hub' });
        if (res && res.success) return res;
      }
      var hub = getDemoHub();
      return {
        success: true,
        groups: hub.groups || [],
        direct_collaborators: [
          { email: 'sarah.lin@apexcapital.internal', deals_count: 2 },
          { email: 'marcus.vance@cascadeinvest.internal', deals_count: 1 }
        ],
        shares_count: (hub.shares || []).length
      };
    },

    createGroup: async function (name, description, members) {
      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-collaboration', {
          action: 'create_group',
          name: name,
          description: description,
          members: members || []
        });
        if (res && res.success) return res;
      }
      var hub = getDemoHub();
      var newGrp = {
        id: 'demo-grp-' + Date.now(),
        name: name,
        description: description || null,
        created_at: new Date().toISOString(),
        collaborator_group_members: (members || []).map(function(m) {
          return { id: 'dm-' + Math.random().toString(36).substr(2, 6), member_email: m };
        })
      };
      hub.groups.unshift(newGrp);
      saveDemoHub(hub);
      return { success: true, group: newGrp, message: 'Group created' };
    },

    updateGroup: async function (groupId, name, description, members) {
      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-collaboration', {
          action: 'update_group',
          group_id: groupId,
          name: name,
          description: description,
          members: members
        });
        if (res && res.success) return res;
      }
      var hub = getDemoHub();
      var found = (hub.groups || []).find(function(g) { return g.id === groupId; });
      if (found) {
        found.name = name;
        if (description !== undefined) found.description = description;
        if (members) {
          found.collaborator_group_members = members.map(function(m) {
            return { id: 'dm-' + Math.random().toString(36).substr(2, 6), member_email: m };
          });
        }
        saveDemoHub(hub);
        return { success: true, group: found, message: 'Group updated' };
      }
      return { success: false, error: 'Group not found' };
    },

    deleteGroup: async function (groupId) {
      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-collaboration', {
          action: 'delete_group',
          group_id: groupId
        });
        if (res && res.success) return res;
      }
      var hub = getDemoHub();
      var idx = (hub.groups || []).findIndex(function(g) { return g.id === groupId; });
      if (idx !== -1) {
        hub.groups.splice(idx, 1);
        saveDemoHub(hub);
        return { success: true };
      }
      return { success: false, error: 'Group not found' };
    },

    // =========================================================================
    // 2. DEAL SHARING (GROUP OR DIRECT EMAIL)
    // =========================================================================
    shareDeal: async function (dealId, shareType, targetId, permission, canViewScenarios) {
      permission = permission || 'viewer';
      canViewScenarios = canViewScenarios !== false;

      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-collaboration', {
          action: 'share_deal',
          deal_id: dealId,
          share_type: shareType, // 'group' or 'email'
          target_id: targetId,
          permission: permission,
          can_view_scenarios: canViewScenarios
        });
        if (res && res.success) return res;
      }

      var hub = getDemoHub();
      var newShare = {
        id: 'demo-share-' + Date.now(),
        deal_id: dealId,
        group_id: shareType === 'group' ? targetId : null,
        shared_with_email: shareType === 'email' ? targetId : null,
        permission: permission,
        can_view_scenarios: canViewScenarios,
        created_at: new Date().toISOString()
      };
      hub.shares = hub.shares || [];
      hub.shares.unshift(newShare);
      saveDemoHub(hub);
      return { success: true, share: newShare, message: 'Deal access granted.' };
    },

    revokeShare: async function (dealId, targetId, shareId) {
      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-collaboration', {
          action: 'revoke_share',
          deal_id: dealId,
          target_id: targetId,
          share_id: shareId
        });
        if (res && res.success) return res;
      }
      var hub = getDemoHub();
      hub.shares = (hub.shares || []).filter(function(s) {
        if (shareId) return s.id !== shareId;
        return !(s.deal_id === dealId && (s.group_id === targetId || s.shared_with_email === targetId));
      });
      saveDemoHub(hub);
      return { success: true };
    },

    getDealShares: async function (dealId) {
      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-collaboration', {
          action: 'get_deal_shares',
          deal_id: dealId
        });
        if (res && res.success) return res.shares || [];
      }
      var hub = getDemoHub();
      var list = (hub.shares || []).filter(function(s) { return s.deal_id === dealId; });
      return list.map(function(s) {
        var grp = (hub.groups || []).find(function(g) { return g.id === s.group_id; });
        return {
          id: s.id,
          deal_id: s.deal_id,
          group_id: s.group_id,
          shared_with_email: s.shared_with_email,
          collaborator_groups: grp ? { name: grp.name } : null,
          permission: s.permission,
          can_view_scenarios: s.can_view_scenarios,
          created_at: s.created_at
        };
      });
    },

    // =========================================================================
    // 3. AUTOMATIC PROSPECTIVE SCENARIO ENGINE & IMPACT DIFFING
    // =========================================================================
    recordRun: async function (dealId, inputs, metrics, name) {
      if (!dealId) return { success: false, error: 'Deal ID required' };

      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-scenarios', {
          action: 'record_run',
          deal_id: dealId,
          inputs: inputs,
          metrics: metrics,
          name: name || null
        });
        if (res && res.success) return res;
      }

      var hub = getDemoHub();
      hub.runs = hub.runs || {};
      var list = hub.runs[dealId] || [];

      // Compute simple demo diff
      var last = list[0];
      var inputDiff = [];
      var metricDiff = [];
      if (last) {
        var oldP = Number(last.inputs?.purchasePrice || 0);
        var newP = Number(inputs?.purchasePrice || 0);
        if (oldP && newP && oldP !== newP) {
          inputDiff.push({ key: 'purchasePrice', label: 'Purchase Basis', oldValue: oldP, newValue: newP, delta: newP - oldP, isCurrency: true });
        }
        var oldR = Number(last.inputs?.interestRate || 0);
        var newR = Number(inputs?.interestRate || 0);
        if (oldR && newR && oldR !== newR) {
          inputDiff.push({ key: 'interestRate', label: 'Interest Rate', oldValue: oldR, newValue: newR, delta: newR - oldR, isPct: true });
        }
        var oldIrr = Number(last.metrics?.irr || 0);
        var newIrr = Number(metrics?.irr || 0);
        if (oldIrr && newIrr && oldIrr !== newIrr) {
          metricDiff.push({ key: 'irr', label: 'Target IRR', oldValue: oldIrr, newValue: newIrr, delta: newIrr - oldIrr, isPct: true });
        }
      }

      var newRun = {
        id: 'demo-run-' + Date.now(),
        deal_id: dealId,
        name: name || (inputDiff[0] ? `Run: ${inputDiff[0].label}` : `Underwriting Run #${list.length + 1}`),
        inputs: inputs,
        metrics: metrics,
        input_diff: inputDiff,
        metric_diff: metricDiff,
        created_at: new Date().toISOString()
      };

      list.unshift(newRun);
      if (list.length > 5) list = list.slice(0, 5); // 5-run cap
      hub.runs[dealId] = list;
      saveDemoHub(hub);

      return { success: true, run: newRun, input_diff: inputDiff, metric_diff: metricDiff };
    },

    getHistory: async function (dealId) {
      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-scenarios', {
          action: 'get_history',
          deal_id: dealId
        });
        if (res && res.success) return res.runs || [];
      }
      var hub = getDemoHub();
      return (hub.runs && hub.runs[dealId]) || [];
    },

    restoreRun: async function (dealId, historyId) {
      if (!isDemoMode()) {
        var res = await invokeEdgeFunction('manage-scenarios', {
          action: 'restore_run',
          deal_id: dealId,
          history_id: historyId
        });
        if (res && res.success) return res;
      }
      var hub = getDemoHub();
      var list = (hub.runs && hub.runs[dealId]) || [];
      var found = list.find(function(r) { return r.id === historyId; });
      if (found) {
        return { success: true, restoredInputs: found.inputs, runName: found.name };
      }
      return { success: false, error: 'Historical run not found' };
    }
  };

  window.MathTreeCollaboration = CollaborationService;

})(typeof window !== 'undefined' ? window : this);
