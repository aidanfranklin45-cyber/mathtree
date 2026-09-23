/**
 * modal-manage-entities.js
 * Backend-Driven Legal Entity Management Modal & CRUD Controller
 * Single Source of Truth for MathTree Studio (Dashboard, Project, Operations)
 * Powered by Postgres RPCs: rpc_get_user_entities, rpc_create_or_update_entity, rpc_delete_entity, rpc_attach_entity_to_deal
 */

(function(window) {
  'use strict';

  let currentTargetDealId = null;
  let currentTargetDealTitle = null;
  let currentReturnToUrl = null;
  let lastFocusedElement = null;

  function isDemoSession() {
    if (window._demoMode || window._isDemoUser) return true;
    if (window._currentUser && window._currentUser.demo) return true;
    if (new URLSearchParams(window.location.search).get('demo') === 'true') return true;
    try {
      const demoMode = localStorage.getItem('mathtree_demo_mode');
      if (demoMode && JSON.parse(demoMode).demo) return true;
      const activeUser = localStorage.getItem('mathtree_active_user');
      if (activeUser && JSON.parse(activeUser).demo) return true;
    } catch (e) {}
    return false;
  }

  // Purge legacy un-scoped cache across the browser
  try {
    localStorage.removeItem('mathtree_entities_cache');
  } catch (e) {}

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  function formatEntityTypeBadge(type) {
    const t = String(type || 'llc').toLowerCase();
    switch (t) {
      case 'series_llc':
        return '<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">Series LLC</span>';
      case 'lp':
        return '<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-800/50 text-purple-400">LP</span>';
      case 'corporation':
        return '<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-950/60 border border-blue-800/50 text-blue-400">Corp</span>';
      case 'trust':
        return '<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/50 text-amber-400">Trust</span>';
      case 'individual':
        return '<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">Individual</span>';
      case 'tic':
        return '<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-800/50 text-rose-400">TIC</span>';
      case 'llc':
      default:
        return '<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 text-emerald-400">LLC</span>';
    }
  }

  function updateContextBanner() {
    let banner = document.getElementById('entity-target-context-banner');
    const modalDiv = document.getElementById('modal-manage-entities');
    if (!banner && modalDiv) {
      banner = document.createElement('div');
      banner.id = 'entity-target-context-banner';
      banner.className = 'hidden mb-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40';
      const container = modalDiv.querySelector('#entities-list-container')?.parentElement;
      if (container && container.parentNode) {
        container.parentNode.insertBefore(banner, container);
      }
    }
    const submitBtnSpan = document.getElementById('entity-submit-btn-text') || document.querySelector('#form-create-entity button[type="submit"]');
    
    if (!banner) return;

    if (currentTargetDealId) {
      const title = currentTargetDealTitle || 'Target Property';
      banner.classList.remove('hidden');
      banner.innerHTML = `
        <div class="flex items-start gap-2.5">
          <div class="text-emerald-400 text-base mt-0.5 shrink-0">🏛️</div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-bold text-white flex items-center justify-between">
              <span class="uppercase tracking-wider text-emerald-400">Assign Entity to Property:</span>
              <button type="button" onclick="handleClearTargetDealContext()" class="text-[10px] text-slate-400 hover:text-white underline transition">
                Clear Context
              </button>
            </div>
            <div class="text-xs font-extrabold text-white mt-0.5 truncate">${escapeHtml(title)}</div>
            <p class="text-[11px] text-slate-300 mt-1 leading-snug">
              Click <strong class="text-emerald-300">✓ Attach</strong> next to any existing legal entity below to link it immediately, or register a new structure to auto-assign it.
            </p>
          </div>
        </div>
      `;
      if (submitBtnSpan) submitBtnSpan.textContent = 'Save & Attach to Property';
    } else {
      banner.classList.add('hidden');
      banner.innerHTML = '';
      if (submitBtnSpan) submitBtnSpan.textContent = 'Save Entity';
    }
  }

  function mountManageEntitiesModal(e, options) {
    let opts = options || {};
    if (e && !e.preventDefault && typeof e === 'object' && (e.dealId || e.deal_id || e.returnTo || e.return_to)) {
      opts = e;
    } else if (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      lastFocusedElement = e.currentTarget || e.target;
    } else if (document.activeElement && document.activeElement !== document.body) {
      lastFocusedElement = document.activeElement;
    }

    // Parse options or fallback to URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    currentTargetDealId = opts.dealId || opts.deal_id || urlParams.get('deal_id') || urlParams.get('dealId') || null;
    currentTargetDealTitle = opts.dealTitle || opts.deal_title || urlParams.get('deal_title') || urlParams.get('dealTitle') || null;
    currentReturnToUrl = opts.returnTo || opts.return_to || urlParams.get('return_to') || urlParams.get('returnTo') || null;

    let modalDiv = document.getElementById('modal-manage-entities');
    if (!modalDiv) {
      modalDiv = document.createElement('div');
      modalDiv.id = 'modal-manage-entities';
      modalDiv.className = 'fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm';
      modalDiv.style.setProperty('z-index', '100000', 'important');
      modalDiv.style.setProperty('display', 'flex', 'important');
      modalDiv.setAttribute('onclick', 'if (event.target === this) closeModal("modal-manage-entities");');
      modalDiv.innerHTML = `
        <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl p-4 sm:p-6 relative my-auto max-h-[92vh] overflow-y-auto">
          <div class="flex items-center justify-between pb-4 mb-3 border-b border-slate-800">
            <h3 class="text-base font-bold text-white flex items-center space-x-2">
              <span class="text-emerald-400">🏛️</span>
              <span>Manage Legal Entities</span>
            </h3>
            <button type="button" onclick="closeModal('modal-manage-entities')" class="text-slate-400 hover:text-white p-1 rounded-lg">✕</button>
          </div>

          <!-- Target Property Context Banner -->
          <div id="entity-target-context-banner" class="hidden mb-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40"></div>

          <!-- Current Entities List -->
          <div class="space-y-2 mb-5">
            <div class="flex items-center justify-between">
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Registered Entities in Backend Database</label>
              <button type="button" onclick="handleSelectAllEntities()" class="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition">
                View All Entities
              </button>
            </div>
            <div id="entities-list-container" class="space-y-2 max-h-56 overflow-y-auto pr-1">
              <!-- Populated dynamically via Postgres RPC -->
              <div class="text-xs text-slate-500 p-3 text-center">Loading entities from database...</div>
            </div>
          </div>

          <!-- Create New Legal Entity Form -->
          <form id="form-create-entity" onsubmit="handleCreateEntity(event)" class="border-t border-slate-800 pt-4 space-y-3 text-xs">
            <span class="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider">+ Register New Legal Entity</span>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="sm:col-span-2">
                <label class="block text-slate-400 font-bold mb-1">Entity Legal Name *</label>
                <input type="text" id="new-entity-name" required placeholder="e.g. Cascade Property Group LLC" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
              </div>

              <div>
                <label class="block text-slate-400 font-bold mb-1">Structure Type</label>
                <select id="new-entity-type" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none">
                  <option value="llc">LLC (Limited Liability Co.)</option>
                  <option value="series_llc">Series LLC</option>
                  <option value="lp">LP (Limited Partnership)</option>
                  <option value="corporation">Corporation (C/S-Corp)</option>
                  <option value="trust">Land Trust / Revocable Trust</option>
                  <option value="individual">Individual / Sole Proprietor</option>
                  <option value="tic">Tenants in Common (TIC)</option>
                </select>
              </div>

              <div>
                <label class="block text-slate-400 font-bold mb-1">Formation State</label>
                <input type="text" id="new-entity-state" placeholder="e.g. WA, DE, WY" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-slate-400 font-bold mb-1">Operating Bank / Depository</label>
                <input type="text" id="new-entity-bank" placeholder="e.g. Chase Commercial (*4892)" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
              </div>

              <div>
                <label class="block text-slate-400 font-bold mb-1">Tax EIN (Optional)</label>
                <input type="text" id="new-entity-ein" placeholder="e.g. 12-3456789" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
              </div>
            </div>

            <button type="submit" class="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-md shadow-emerald-900/30 flex items-center justify-center space-x-2">
              <span id="entity-submit-btn-text">Save Entity</span>
            </button>
          </form>
        </div>
      `;
      document.body.appendChild(modalDiv);
    } else {
      modalDiv.classList.remove('hidden');
      modalDiv.classList.add('flex');
      modalDiv.style.setProperty('display', 'flex', 'important');
      modalDiv.style.setProperty('z-index', '100000', 'important');
    }

    updateContextBanner();

    fetchEntities().then(function(entities) {
      renderEntitiesList(entities);
    });

    setTimeout(function() {
      const input = modalDiv.querySelector('#new-entity-name');
      if (input && !currentTargetDealId) input.focus();
    }, 50);

    return modalDiv;
  }

  function closeModal(modalId) {
    const el = document.getElementById(modalId || 'modal-manage-entities');
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('flex');
      el.style.setProperty('display', 'none', 'important');
    }
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      try {
        lastFocusedElement.focus();
      } catch (err) {}
    }
  }

  function handleClearTargetDealContext() {
    currentTargetDealId = null;
    currentTargetDealTitle = null;
    updateContextBanner();
    fetchEntities().then(renderEntitiesList);
  }

  function handleSelectAllEntities() {
    try {
      localStorage.setItem('mathtree_selected_entity_id', 'all');
    } catch(e) {}
    broadcastEntityChange('all', 'All Entities');
    closeModal('modal-manage-entities');
  }

  function broadcastEntityChange(entityId, entityName) {
    const detail = { entityId: entityId || null, llc: entityName || null, name: entityName || null };
    
    window.dispatchEvent(new CustomEvent('mathtree:entity-changed', { detail }));

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('mathtree_store_channel');
        bc.postMessage({ type: 'ENTITY_CHANGED', event: 'mathtree:entity-changed', entityId, llc: entityName, name: entityName });
        bc.close();
      }
    } catch (e) {}
  }

  // Pure Backend-Driven Entity Retrieval via Postgres RPC
  async function fetchEntities() {
    const isDemo = isDemoSession();

    if (window._supabase) {
      try {
        const { data, error } = await window._supabase.rpc('rpc_get_user_entities', { p_is_demo: isDemo });
        if (!error && Array.isArray(data)) {
          return data;
        }
        if (error) {
          console.warn('[ManageEntities] rpc_get_user_entities warning:', error);
        }
      } catch (e) {
        console.warn('[ManageEntities] live entity query error:', e);
      }
    }

    return [];
  }

  function renderEntitiesList(entities) {
    const container = document.getElementById('entities-list-container');
    if (!container) return;

    if (!entities || entities.length === 0) {
      container.innerHTML = `
        <div class="text-xs text-slate-500 italic p-3 text-center bg-slate-950 rounded-xl border border-slate-800/60">
          No legal entities registered yet. Register your first structure below.
        </div>
      `;
      return;
    }

    container.innerHTML = entities.map(function(e) {
      const isTargeting = Boolean(currentTargetDealId);
      const actionHtml = isTargeting ? `
        <button type="button" onclick="handleAttachEntityToDeal('${e.id}', '${escapeAttr(e.name)}')" class="px-3 py-1 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md shadow-emerald-950/40 transition flex items-center space-x-1 shrink-0">
          <span>✓ Attach</span>
        </button>
      ` : `
        <span class="text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">Active</span>
      `;

      const dealCountText = Number(e.deal_count || 0) === 1 ? '1 Property' : `${e.deal_count || 0} Properties`;
      const stateText = e.formation_state ? `(${escapeHtml(e.formation_state)})` : '';
      const bankText = e.bank_name ? ` • ${escapeHtml(e.bank_name)}` : '';

      return `
        <div class="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 hover:border-slate-700 transition">
          <div class="min-w-0 flex-1">
            <div class="flex items-center space-x-2">
              <span class="block font-bold text-white text-xs truncate">${escapeHtml(e.name)}</span>
              ${formatEntityTypeBadge(e.entity_type)}
            </div>
            <div class="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5 truncate">
              <span>${dealCountText}</span>
              ${stateText ? `<span>${stateText}</span>` : ''}
              ${bankText ? `<span class="truncate">${bankText}</span>` : ''}
            </div>
          </div>
          <div class="flex items-center space-x-1.5 shrink-0">
            ${actionHtml}
            <button type="button" onclick="handleDeleteEntity('${e.id}')" class="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition" title="Delete Entity">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Pure Backend-Driven Entity Attachment via Postgres RPC
  async function handleAttachEntityToDeal(entityId, entityName) {
    if (!currentTargetDealId) {
      alert('No target property selected for entity attachment.');
      return;
    }

    const dealId = currentTargetDealId;
    const dealTitle = currentTargetDealTitle || 'Property';
    const returnUrl = currentReturnToUrl;

    try {
      if (window._supabase && !window._currentUser?.demo) {
        // Execute Postgres RPC: rpc_attach_entity_to_deal
        const { error } = await window._supabase.rpc('rpc_attach_entity_to_deal', {
          p_deal_id: dealId,
          p_entity_id: entityId
        });

        if (error) {
          console.warn('[ManageEntities] Postgres RPC attachment warning:', error);
        }
      }

      // Sync in-memory objects on active pages
      if (Array.isArray(window.activeDashboardProjects)) {
        window.activeDashboardProjects.forEach(d => {
          if (d && (d.id === dealId || String(d.id) === String(dealId))) {
            d.entity_id = entityId;
            d.inputs = d.inputs || {};
            d.inputs.entity_id = entityId;
            d.inputs.entityName = entityName;
          }
        });
      }
      if (Array.isArray(window.rawDeals)) {
        window.rawDeals.forEach(d => {
          if (d && (d.id === dealId || String(d.id) === String(dealId))) {
            d.entity_id = entityId;
          }
        });
      }
      if (window.currentLoadedDeal && (window.currentLoadedDeal.id === dealId || String(window.currentLoadedDeal.id) === String(dealId))) {
        window.currentLoadedDeal.entity_id = entityId;
        window.currentLoadedDeal.inputs = window.currentLoadedDeal.inputs || {};
        window.currentLoadedDeal.inputs.entity_id = entityId;
      }

      // Update dropdowns in open forms
      ['edit-deal-entity', 'wiz-entity-select', 'property-entity-select', 'deal-entity-select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          let opt = el.querySelector(`option[value="${entityId}"]`);
          if (!opt) {
            opt = document.createElement('option');
            opt.value = entityId;
            opt.textContent = entityName;
            el.appendChild(opt);
          }
          el.value = entityId;
        }
      });

      // Broadcast changes across tabs and windows
      broadcastEntityChange(entityId, entityName);
      window.dispatchEvent(new CustomEvent('mathtree:deal-updated', { detail: { dealId, entityId, entityName } }));

      // Refresh notification counts via backend
      if (window.MathTreeClient && typeof window.MathTreeClient.getNotifications === 'function') {
        window.MathTreeClient.getNotifications();
      }

      // Feedback toast
      const successMsg = `Successfully assigned ${entityName} to ${dealTitle}`;
      if (typeof window.showActionToast === 'function') {
        window.showActionToast(successMsg, 'success');
      } else {
        console.log('[ManageEntities]', successMsg);
      }

      closeModal('modal-manage-entities');

      // Clear state
      currentTargetDealId = null;
      currentTargetDealTitle = null;
      currentReturnToUrl = null;

      // Trampoline back if requested
      if (returnUrl && window.location.href !== returnUrl) {
        setTimeout(() => {
          window.location.href = returnUrl;
        }, 150);
        return;
      }

      // Re-render local page components
      if (typeof window.populateFilterDropdowns === 'function') window.populateFilterDropdowns();
      if (typeof window.loadDashboardProjects === 'function') window.loadDashboardProjects();
      if (typeof window.loadOperationsData === 'function') window.loadOperationsData();
      if (typeof window.renderOperationsUI === 'function') window.renderOperationsUI();
      if (typeof window.renderPortfolioGrid === 'function') window.renderPortfolioGrid();

    } catch (err) {
      console.error('[ManageEntities] handleAttachEntityToDeal error:', err);
      alert('Failed to attach entity: ' + (err.message || err));
    }
  }

  // Pure Backend-Driven Entity Creation via Postgres RPC
  async function handleCreateEntity(e) {
    if (e && e.preventDefault) e.preventDefault();

    const nameInput = document.getElementById('new-entity-name');
    const typeInput = document.getElementById('new-entity-type');
    const stateInput = document.getElementById('new-entity-state');
    const bankInput = document.getElementById('new-entity-bank');
    const einInput = document.getElementById('new-entity-ein');

    const name = nameInput?.value?.trim();
    if (!name) return;

    const entityType = typeInput?.value || 'llc';
    const state = stateInput?.value?.trim() || null;
    const bank = bankInput?.value?.trim() || null;
    const ein = einInput?.value?.trim() || null;

    let createdEntity = null;

    if (window._supabase) {
      try {
        const { data, error } = await window._supabase.rpc('rpc_create_or_update_entity', {
          p_name: name,
          p_entity_type: entityType,
          p_formation_state: state,
          p_bank_name: bank,
          p_ein: ein,
          p_notes: null,
          p_id: null
        });

        if (error) {
          console.warn('[ManageEntities] rpc_create_or_update_entity error:', error);
          alert('Could not save entity: ' + (error.message || 'Database error'));
          return;
        }

        createdEntity = data;
      } catch (err) {
        console.warn('[ManageEntities] Backend entity creation error:', err);
        alert('Could not connect to database backend.');
        return;
      }
    }

    const form = document.getElementById('form-create-entity');
    if (form) form.reset();

    const refreshedEntities = await fetchEntities();
    renderEntitiesList(refreshedEntities);
    
    if (createdEntity) {
      broadcastEntityChange(createdEntity.id, createdEntity.name);
    }

    if (typeof window.populateFilterDropdowns === 'function') {
      window.populateFilterDropdowns();
    }

    // Auto-attach if a target deal is set
    if (currentTargetDealId && createdEntity) {
      await handleAttachEntityToDeal(createdEntity.id, createdEntity.name);
    }
  }

  // Pure Backend-Driven Entity Deletion via Postgres RPC
  async function handleDeleteEntity(entityId) {
    if (!confirm('Are you sure you want to remove this entity? Any properties assigned to it will be unassigned.')) return;

    if (window._supabase) {
      try {
        const { error } = await window._supabase.rpc('rpc_delete_entity', {
          p_entity_id: entityId
        });

        if (error) {
          console.warn('[ManageEntities] rpc_delete_entity warning:', error);
          alert('Could not delete entity: ' + (error.message || 'Database error'));
          return;
        }
      } catch (err) {
        console.warn('[ManageEntities] Supabase delete warning:', err);
      }
    }

    const refreshedEntities = await fetchEntities();
    renderEntitiesList(refreshedEntities);
    broadcastEntityChange(null, null);

    if (typeof window.populateFilterDropdowns === 'function') {
      window.populateFilterDropdowns();
    }
  }

  // Reactive listener for entity changes to avoid stale list in open modal
  let renderDebounceTimer = null;
  function handleExternalEntityChange() {
    const modal = document.getElementById('modal-manage-entities');
    if (modal && !modal.classList.contains('hidden') && modal.style.display !== 'none') {
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(async () => {
        const entities = await fetchEntities();
        renderEntitiesList(entities);
      }, 100);
    }
  }

  window.addEventListener('mathtree:entity-changed', handleExternalEntityChange);

  // Escape key listener to close modal-manage-entities without closing parent modal
  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-manage-entities');
      if (modal && !modal.classList.contains('hidden') && modal.style.display !== 'none') {
        closeModal('modal-manage-entities');
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  // Client-side in-place routing for Manage Entity Relationship Container
  function handleInPlaceEntityRouting() {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    if (params.get('action') === 'manage-entities' || params.get('modal') === 'manage-entities' || hash === '#manage-entities') {
      mountManageEntitiesModal();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleInPlaceEntityRouting);
  } else {
    handleInPlaceEntityRouting();
  }
  window.addEventListener('hashchange', handleInPlaceEntityRouting);

  // Authoritative Window Action Exposure
  window.mountManageEntitiesModal = mountManageEntitiesModal;
  window.openEntityManagementModal = mountManageEntitiesModal;
  window.closeModal = closeModal;
  window.handleCreateEntity = handleCreateEntity;
  window.handleDeleteEntity = handleDeleteEntity;
  window.handleAttachEntityToDeal = handleAttachEntityToDeal;
  window.handleClearTargetDealContext = handleClearTargetDealContext;
  window.handleSelectAllEntities = handleSelectAllEntities;

  // Pre-mount if document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      let modalDiv = document.getElementById('modal-manage-entities');
      if (modalDiv) {
        modalDiv.style.setProperty('z-index', '100000', 'important');
      }
    });
  }

})(window);
