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
      const payload = {
        inputs: inputs || (this._currentDeal && this._currentDeal.inputs) || {},
        runs: runs || 10000,
        exitCapSpreadBps: options.exitCapSpreadBps || 100,
        rentGrowthVolPct: options.rentGrowthVolPct || 2.0,
        vacancyVolPct: options.vacancyVolPct || 2.5
      };

      const res = await fetch(`${SUPABASE_URL}/functions/v1/simulate-monte-carlo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
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
    }
  };

  window.MathTreeClient = MathTreeClient;
})(window);
