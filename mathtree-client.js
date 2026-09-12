/**
 * mathtree-client.js
 * Lightweight Reactive Client SDK for MathTree
 * Integrates Supabase Postgres Views, RPC Functions, Edge Functions, and Declarative DOM Binding.
 */

(function(window) {
  'use strict';

  const SUPABASE_URL = 'https://bgexwcepwbxvhxbpblhd.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnZXh3Y2Vwd2J4dmh4YnBibGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0MjczMzQsImV4cCI6MjA0MTAwMzMzNH0.fP8d22yY5X4d34V517xS3Z45Y2Z5X1d34V517xS3Z44';

  const MathTreeClient = {
    _client: null,
    _currentDeal: null,
    _listeners: [],
    _saveTimer: null,
    _realtimeChannel: null,

    init: function() {
      if (window._supabase) {
        this._client = window._supabase;
      } else if (typeof supabase !== 'undefined' && supabase.createClient) {
        this._client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window._supabase = this._client;
      }
      return this;
    },

    getClient: function() {
      if (!this._client) this.init();
      return this._client;
    },

    // === 1. Direct Postgres Views ===

    getPortfolioAggregates: async function(userId) {
      const client = this.getClient();
      if (!client) return null;
      try {
        let q = client.from('view_portfolio_aggregates').select('*');
        if (userId) q = q.eq('user_id', userId);
        const res = await q;
        if (res.error) throw res.error;
        return (res.data && res.data[0]) || null;
      } catch (err) {
        console.warn('[MathTreeClient] view_portfolio_aggregates fallback:', err);
        return null;
      }
    },

    getPropertyManagementStats: async function(userId) {
      const client = this.getClient();
      if (!client) return [];
      try {
        let q = client.from('view_property_management_stats').select('*');
        if (userId) q = q.eq('user_id', userId);
        const res = await q;
        if (res.error) throw res.error;
        return res.data || [];
      } catch (err) {
        console.warn('[MathTreeClient] view_property_management_stats fallback:', err);
        return [];
      }
    },

    // === 2. Direct Postgres RPC Functions ===

    recalculateDeal: async function(dealId, newInputs) {
      const client = this.getClient();
      if (!client) return null;

      try {
        // Try native Postgres RPC first (fastest, runs in microseconds)
        const res = await client.rpc('rpc_recalculate_deal', {
          p_deal_id: dealId,
          p_new_inputs: newInputs || {}
        });

        if (!res.error && res.data) {
          this._currentDeal = res.data;
          this.notifyChange(res.data);
          return res.data;
        }
      } catch (e) {
        console.warn('[MathTreeClient] rpc_recalculate_deal error, trying Edge Function:', e);
      }

      // Fallback to active Edge Function
      try {
        const edgeRes = await fetch(`${SUPABASE_URL}/functions/v1/edit-property-inputs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealId, updates: newInputs })
        });
        const edgeData = await edgeRes.json();
        if (edgeData.success && edgeData.deal) {
          this._currentDeal = edgeData.deal;
          this.notifyChange(edgeData.deal);
          return edgeData.deal;
        }
      } catch (edgeErr) {
        console.error('[MathTreeClient] recalculateDeal failed both RPC and Edge:', edgeErr);
      }
      return null;
    },

    getDebtSchedule: async function(loanAmount, interestRate, termYears, amortYears) {
      const client = this.getClient();
      if (!client) return [];
      try {
        const res = await client.rpc('rpc_get_debt_schedule', {
          p_loan_amount: loanAmount,
          p_interest_rate: interestRate,
          p_term_years: termYears,
          p_amort_years: amortYears || termYears
        });
        if (!res.error && res.data) {
          return res.data;
        }
      } catch (e) {
        console.warn('[MathTreeClient] rpc_get_debt_schedule fallback:', e);
      }
      return [];
    },

    // === 3. Specialized Serverless Edge Functions ===

    runMonteCarlo: async function(inputs, runs, options) {
      options = options || {};
      const resolvedInputs = inputs || (this._currentDeal && this._currentDeal.inputs) || {};
      const payload = {
        inputs: resolvedInputs,
        assetType: options.assetType || (this._currentDeal && this._currentDeal.asset_class) || 'single-family',
        runs: runs || 1000,
        exitCapSpreadBps: options.exitCapSpreadBps || 100,
        rentGrowthVolPct: options.rentGrowthVolPct || 2.0,
        vacancyVolPct: options.vacancyVolPct || 2.5
      };

      const res = await fetch(`${SUPABASE_URL}/functions/v1/simulate-monte-carlo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`Deno Edge simulation error (${res.status}): ${errorText || res.statusText}`);
      }
      return await res.json();
    },

    generatePdfBriefUrl: function(deal) {
      return `${SUPABASE_URL}/functions/v1/generate-pdf-brief`;
    },

    downloadPdfBrief: async function(deal) {
      const targetDeal = deal || this._currentDeal;
      if (!targetDeal) return;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-pdf-brief`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deal: targetDeal })
        });
        const html = await res.text();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank');
        if (win) {
          win.focus();
        } else {
          window.location.href = url;
        }
      } catch (e) {
        console.error('[MathTreeClient] Error generating PDF brief:', e);
        window.print();
      }
    },

    // === 4. Declarative Reactive UI Binding ===

    formatValue: function(val, format) {
      if (val === null || val === undefined || isNaN(val)) return '—';
      const num = Number(val);
      switch (format) {
        case 'currency':
          return '$' + Math.round(num).toLocaleString('en-US');
        case 'currency-cents':
          return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        case 'percent':
          return num.toFixed(2) + '%';
        case 'percent-1':
          return num.toFixed(1) + '%';
        case 'multiple':
          return num.toFixed(2) + 'x';
        case 'integer':
          return Math.round(num).toLocaleString('en-US');
        default:
          return String(val);
      }
    },

    getDeepValue: function(obj, path) {
      if (!obj || !path) return undefined;
      const parts = path.split('.');
      let curr = obj;
      for (let i = 0; i < parts.length; i++) {
        if (curr === null || curr === undefined) return undefined;
        curr = curr[parts[i]];
      }
      return curr;
    },

    setDeepValue: function(obj, path, value) {
      if (!obj || !path) return;
      const parts = path.split('.');
      let curr = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!curr[parts[i]] || typeof curr[parts[i]] !== 'object') {
          curr[parts[i]] = {};
        }
        curr = curr[parts[i]];
      }
      curr[parts[parts.length - 1]] = value;
    },

    bindUI: function(rootEl, deal) {
      rootEl = rootEl || document;
      this._currentDeal = deal || this._currentDeal || {};
      const self = this;

      // 1. Bind Displays [data-bind="metrics.noi"] [data-format="currency"]
      rootEl.querySelectorAll('[data-bind]').forEach(function(el) {
        const path = el.getAttribute('data-bind');
        const format = el.getAttribute('data-format');
        const rawVal = self.getDeepValue(self._currentDeal, path);
        if (rawVal !== undefined) {
          el.textContent = format ? self.formatValue(rawVal, format) : String(rawVal);
        }
      });

      // 2. Bind Inputs [data-model="inputs.purchasePrice"] [data-format="currency"]
      rootEl.querySelectorAll('[data-model]').forEach(function(input) {
        const path = input.getAttribute('data-model');
        const format = input.getAttribute('data-format');
        const currentVal = self.getDeepValue(self._currentDeal, path);

        if (currentVal !== undefined && input !== document.activeElement) {
          input.value = format ? self.formatValue(currentVal, format) : currentVal;
        }

        if (!input._mathtreeBound) {
          input._mathtreeBound = true;

          input.addEventListener('input', function() {
            let clean = input.value.replace(/[^0-9.-]+/g, '');
            let parsed = clean ? parseFloat(clean) : 0;
            self.setDeepValue(self._currentDeal, path, parsed);
            self.scheduleAutoSave();
          });

          input.addEventListener('blur', function() {
            let clean = input.value.replace(/[^0-9.-]+/g, '');
            let parsed = clean ? parseFloat(clean) : 0;
            if (format) {
              input.value = self.formatValue(parsed, format);
            }
          });

          input.addEventListener('focus', function() {
            let clean = input.value.replace(/[^0-9.-]+/g, '');
            input.value = clean || '';
          });
        }
      });
    },

    scheduleAutoSave: function() {
      const self = this;
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(function() {
        if (self._currentDeal && self._currentDeal.id) {
          console.log('[MathTreeClient] Auto-saving deal inputs via Postgres RPC...');
          self.recalculateDeal(self._currentDeal.id, self._currentDeal.inputs);
        }
      }, 500);
    },

    subscribeRealtime: function(dealId, callback) {
      const client = this.getClient();
      if (!client || typeof client.channel !== 'function') return;

      try {
        if (this._realtimeChannel) {
          client.removeChannel(this._realtimeChannel);
        }

        const self = this;
        this._realtimeChannel = client.channel('mathtree-client-deal-' + (dealId || 'all'))
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'deals' },
            function(payload) {
              if (!dealId || (payload.new && payload.new.id === dealId)) {
                console.log('[MathTreeClient] Realtime update received for deal:', payload.new?.id);
                if (payload.new) {
                  self._currentDeal = payload.new;
                  self.bindUI(document, payload.new);
                  if (typeof callback === 'function') callback(payload.new);
                }
              }
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('[MathTreeClient] Realtime subscribe notice:', err);
      }
    },

    onDealChange: function(fn) {
      if (typeof fn === 'function') this._listeners.push(fn);
    },

    notifyChange: function(deal) {
      this.bindUI(document, deal);
      for (let i = 0; i < this._listeners.length; i++) {
        try {
          this._listeners[i](deal);
        } catch (e) {
          console.error(e);
        }
      }
    },

    // === 4. In-App Notification Hub & Action Center ===
    _notifications: [],
    _isHubOpen: false,

    initNotificationHub: async function() {
      const self = this;
      try {
        await this.getNotifications();
      } catch (e) {}

      // Realtime subscription for app_notifications
      try {
        const client = this.getClient();
        if (client) {
          client.channel('mathtree-app-notifications')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'app_notifications' }, function() {
              self.getNotifications();
            })
            .subscribe();
        }
      } catch (e) {
        console.warn('[MathTreeClient] notif realtime notice:', e);
      }
    },

    getNotifications: async function(userId) {
      const client = this.getClient();
      if (!client) return [];
      try {
        let uId = userId;
        if (!uId && window._currentUser) uId = window._currentUser.id;
        if (!uId) {
          const sessionRes = await client.auth.getSession();
          uId = sessionRes.data?.session?.user?.id;
        }
        if (!uId) return [];

        const evalRes = await client.rpc('rpc_evaluate_deal_notifications', { p_user_id: uId });
        if (!evalRes.error && evalRes.data) {
          this._notifications = evalRes.data;
          this.updateNotificationBadge();
          if (this._isHubOpen) {
            this.renderNotificationDrawerContent();
          }
          return this._notifications;
        }
      } catch (err) {
        console.warn('[MathTreeClient] getNotifications notice:', err);
      }
      return [];
    },

    updateNotificationBadge: function() {
      const count = (this._notifications || []).length;
      document.querySelectorAll('.notif-badge, #notif-badge').forEach(badge => {
        if (count > 0) {
          badge.textContent = count > 9 ? '9+' : count;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      });
    },

    toggleNotificationHub: function() {
      this._isHubOpen = !this._isHubOpen;
      let drawer = document.getElementById('mathtree-notification-drawer');
      if (!drawer) {
        drawer = document.createElement('div');
        drawer.id = 'mathtree-notification-drawer';
        document.body.appendChild(drawer);
      }

      if (this._isHubOpen) {
        this.renderNotificationDrawerContent();
        drawer.classList.remove('hidden');
      } else {
        drawer.classList.add('hidden');
      }
    },

    closeNotificationHub: function() {
      this._isHubOpen = false;
      const drawer = document.getElementById('mathtree-notification-drawer');
      if (drawer) drawer.classList.add('hidden');
    },

    dismissNotification: async function(notificationId) {
      const client = this.getClient();
      if (!client || !notificationId) return;
      try {
        await client
          .from('app_notifications')
          .update({ is_dismissed: true, updated_at: new Date().toISOString() })
          .eq('id', notificationId);
        this._notifications = this._notifications.filter(n => (n.notification_id || n.id) !== notificationId);
        this.updateNotificationBadge();
        this.renderNotificationDrawerContent();
      } catch (err) {
        console.warn('[MathTreeClient] dismissNotification error:', err);
      }
    },

    syncProFormaToActuals: async function(dealId, actualMonthlyRent) {
      const client = this.getClient();
      if (!client || !dealId) return false;
      try {
        const res = await client.rpc('rpc_sync_proforma_to_actuals', {
          p_deal_id: dealId,
          p_actual_monthly_rent: parseFloat(actualMonthlyRent) || 0
        });
        if (res.error) throw res.error;

        this._notifications = this._notifications.filter(n => n.target_deal_id !== dealId || n.notif_type !== 'revenue_variance');
        this.updateNotificationBadge();
        this.renderNotificationDrawerContent();

        const formattedRent = '$' + Math.round(actualMonthlyRent).toLocaleString() + '/mo';
        if (typeof showActionToast === 'function') {
          showActionToast('Pro-forma synchronized to operational revenue (' + formattedRent + ')', 'success');
        } else {
          alert('Pro-forma successfully synchronized to live operational revenue: ' + formattedRent);
        }

        if (typeof loadDashboardProjects === 'function') loadDashboardProjects();
        if (typeof loadOperationsData === 'function') loadOperationsData();
        if (window.location.pathname.includes('project.html')) {
          setTimeout(() => window.location.reload(), 400);
        }
        return true;
      } catch (err) {
        console.error('[MathTreeClient] syncProFormaToActuals failed:', err);
        alert('Failed to synchronize pro-forma: ' + (err.message || err));
        return false;
      }
    },

    handleNotificationAction: function(notifId, actionType, payloadStr) {
      let payload = {};
      try {
        payload = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : (payloadStr || {});
      } catch(e) {}

      if (actionType === 'sync_proforma_income') {
        this.syncProFormaToActuals(payload.deal_id, payload.actual_monthly_rent);
      } else if (actionType === 'open_lease_modal') {
        this.closeNotificationHub();
        if (typeof openAddLeaseModal === 'function') {
          openAddLeaseModal(payload.deal_id);
        } else {
          window.location.href = 'operations.html?action=add-lease&deal_id=' + (payload.deal_id || '');
        }
      } else if (actionType === 'open_entity_modal') {
        this.closeNotificationHub();
        if (typeof openEntityManagementModal === 'function') {
          openEntityManagementModal();
        } else {
          window.location.href = 'operations.html?action=manage-entities';
        }
      }
    },

    renderNotificationDrawerContent: function() {
      const drawer = document.getElementById('mathtree-notification-drawer');
      if (!drawer) return;

      const notifs = this._notifications || [];
      const notifHtml = notifs.length === 0 ? `
        <div class="p-8 text-center bg-slate-950/40 rounded-2xl border border-slate-800/80 my-auto">
          <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-3">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          </div>
          <h4 class="text-sm font-bold text-white mb-1">All Caught Up!</h4>
          <p class="text-xs text-slate-400 leading-relaxed">
            All owned properties have verified tenants, complete lease terms, and aligned pro-forma models.
          </p>
        </div>
      ` : notifs.map(n => {
        const id = n.notification_id || n.id;
        const sev = n.severity || 'info';
        const sevBadge = sev === 'critical' 
          ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 border border-rose-500/40 text-rose-300">Action Required</span>'
          : sev === 'warning'
          ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 border border-amber-500/40 text-amber-300">Review & Check</span>'
          : '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 border border-blue-500/40 text-blue-300">Tip / Reminder</span>';

        const payloadJson = JSON.stringify(n.action_payload || {}).replace(/"/g, '&quot;');
        
        let actionBtn = '';
        if (n.action_type === 'sync_proforma_income') {
          const actualRent = n.action_payload?.actual_monthly_rent || 0;
          actionBtn = `
            <div class="mt-3 flex flex-col xs:flex-row gap-2">
              <button onclick="window.MathTreeClient.handleNotificationAction('${id}', 'sync_proforma_income', '${payloadJson}')" class="flex-1 py-1.5 px-3 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-950/40 transition text-center flex items-center justify-center space-x-1">
                <span>⚡ Sync Pro-Forma ($${Math.round(actualRent).toLocaleString()}/mo)</span>
              </button>
              <button onclick="window.MathTreeClient.dismissNotification('${id}')" class="py-1.5 px-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 transition" title="Keep prospective model as baseline target">
                Keep Separate
              </button>
            </div>
          `;
        } else if (n.action_type === 'open_lease_modal') {
          actionBtn = `
            <div class="mt-3 flex items-center gap-2">
              <button onclick="window.MathTreeClient.handleNotificationAction('${id}', 'open_lease_modal', '${payloadJson}')" class="flex-1 py-1.5 px-3 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition text-center">
                + Add Tenant & Lease Terms
              </button>
              <button onclick="window.MathTreeClient.dismissNotification('${id}')" class="py-1.5 px-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition">
                Snooze
              </button>
            </div>
          `;
        } else if (n.action_type === 'open_entity_modal') {
          actionBtn = `
            <div class="mt-3 flex items-center gap-2">
              <button onclick="window.MathTreeClient.handleNotificationAction('${id}', 'open_entity_modal', '${payloadJson}')" class="flex-1 py-1.5 px-3 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 transition text-center">
                Assign Entity LLC
              </button>
              <button onclick="window.MathTreeClient.dismissNotification('${id}')" class="py-1.5 px-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition">
                Dismiss
              </button>
            </div>
          `;
        } else if (n.action_type === 'missing_terms') {
          actionBtn = `
            <div class="mt-3 flex items-center gap-2">
              <button onclick="window.MathTreeClient.handleNotificationAction('${id}', 'open_lease_modal', '${payloadJson}')" class="flex-1 py-1.5 px-3 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 transition text-center">
                Complete Lease Terms
              </button>
              <button onclick="window.MathTreeClient.dismissNotification('${id}')" class="py-1.5 px-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition">
                Dismiss
              </button>
            </div>
          `;
        }

        return `
          <div class="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/90 shadow-lg flex flex-col space-y-2 relative group hover:border-slate-700 transition">
            <div class="flex items-center justify-between gap-2">
              ${sevBadge}
              <button onclick="window.MathTreeClient.dismissNotification('${id}')" class="text-slate-500 hover:text-slate-300 transition text-xs p-1" title="Dismiss notification">✕</button>
            </div>
            <h5 class="text-xs font-bold text-slate-200 leading-snug">${n.title}</h5>
            <p class="text-xs text-slate-400 leading-relaxed">${n.message}</p>
            ${actionBtn}
          </div>
        `;
      }).join('');

      drawer.innerHTML = `
        <div class="fixed inset-0 z-[9999] flex justify-end">
          <div onclick="window.MathTreeClient.closeNotificationHub()" class="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"></div>
          <div class="relative w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col h-full z-10">
            <!-- Header -->
            <div class="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 sticky top-0">
              <div class="flex items-center space-x-2.5">
                <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold text-sm">
                  🔔
                </div>
                <div>
                  <h3 class="text-sm font-extrabold text-white flex items-center space-x-2">
                    <span>Action Center</span>
                    <span class="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">${notifs.length}</span>
                  </h3>
                  <p class="text-[11px] text-slate-400">Institutional reminders & pro-forma checks</p>
                </div>
              </div>
              <div class="flex items-center space-x-1">
                <button onclick="window.MathTreeClient.getNotifications()" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition" title="Refresh checks">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                </button>
                <button onclick="window.MathTreeClient.closeNotificationHub()" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-sm font-bold">
                  ✕
                </button>
              </div>
            </div>

            <!-- Scrollable Content -->
            <div class="flex-1 overflow-y-auto p-5 space-y-3">
              ${notifHtml}
            </div>

            <!-- Footer -->
            <div class="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-[11px] text-slate-400">
              <span>MathTree Autonomous Underwriting Engine</span>
              <button onclick="window.MathTreeClient.closeNotificationHub()" class="font-bold text-emerald-400 hover:text-emerald-300">Done</button>
            </div>
          </div>
        </div>
      `;
    },

    // === 5. Underwriting vs Actuals Performance Tracking ===
    getPerformanceTracking: async function(userId) {
      const client = this.getClient();
      if (!client) return [];
      try {
        let q = client.from('view_deal_performance_tracking').select('*');
        if (userId) q = q.eq('user_id', userId);
        const res = await q;
        if (res.error) throw res.error;
        return res.data || [];
      } catch (err) {
        console.warn('[MathTreeClient] view_deal_performance_tracking notice:', err);
        return [];
      }
    }
  };

  // Auto-initialize Notification Hub when DOM is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => MathTreeClient.initNotificationHub());
    } else {
      MathTreeClient.initNotificationHub();
    }
  }

  window.MathTreeClient = MathTreeClient;
})(window);
