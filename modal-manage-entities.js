/**
 * modal-manage-entities.js
 * Shared In-Place LLC & Legal Entity Management Modal & CRUD Controller
 * Single Source of Truth for MathTree Studio (Dashboard, Project, Operations)
 */

(function(window) {
  'use strict';

  let localEntities = [
    {
      id: 'ent-demo-1',
      name: 'Apex Real Estate Capital LLC',
      formation_state: 'WA',
      bank_name: 'Chase Commercial (*4892)',
      depository_bank: 'Chase Commercial (*4892)'
    },
    {
      id: 'ent-demo-2',
      name: 'Cascade Property Holdings LLC',
      formation_state: 'DE',
      bank_name: 'Wells Fargo Real Estate (*1042)',
      depository_bank: 'Wells Fargo Real Estate (*1042)'
    }
  ];

  let lastFocusedElement = null;

  // Load cached entities from localStorage
  try {
    const cached = localStorage.getItem('mathtree_entities_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        localEntities = parsed;
      }
    }
  } catch (e) {}

  function saveLocalEntitiesCache() {
    try {
      localStorage.setItem('mathtree_entities_cache', JSON.stringify(localEntities));
    } catch (e) {}
  }

  function mountManageEntitiesModal(e) {
    if (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      lastFocusedElement = e.currentTarget || e.target;
    } else if (document.activeElement && document.activeElement !== document.body) {
      lastFocusedElement = document.activeElement;
    }

    let modalDiv = document.getElementById('modal-manage-entities');
    if (!modalDiv) {
      modalDiv = document.createElement('div');
      modalDiv.id = 'modal-manage-entities';
      modalDiv.className = 'fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm';
      modalDiv.style.setProperty('z-index', '100000', 'important');
      modalDiv.style.setProperty('display', 'flex', 'important');
      modalDiv.setAttribute('onclick', 'if (event.target === this) closeModal("modal-manage-entities");');
      modalDiv.innerHTML = `
        <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl p-4 sm:p-6 relative my-auto max-h-[92vh] overflow-y-auto">
          <div class="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
            <h3 class="text-base font-bold text-white flex items-center space-x-2">
              <span class="text-emerald-400">🏛️</span>
              <span>Manage Legal Entities (LLCs)</span>
            </h3>
            <button type="button" onclick="closeModal('modal-manage-entities')" class="text-slate-400 hover:text-white p-1 rounded-lg">✕</button>
          </div>

          <!-- Current Entities List -->
          <div class="space-y-2 mb-5">
            <div class="flex items-center justify-between">
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Entities</label>
              <button type="button" onclick="handleSelectAllEntities()" class="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition">
                View All Entities
              </button>
            </div>
            <div id="entities-list-container" class="space-y-2 max-h-48 overflow-y-auto pr-1">
              <!-- Populated dynamically -->
            </div>
          </div>

          <!-- Create New LLC Form -->
          <form id="form-create-entity" onsubmit="handleCreateEntity(event)" class="border-t border-slate-800 pt-4 space-y-3 text-xs">
            <span class="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider">+ Register New LLC Entity</span>
            
            <div>
              <label class="block text-slate-400 font-bold mb-1">Entity Legal Name *</label>
              <input type="text" id="new-entity-name" required placeholder="e.g. Cascade Property Group LLC" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
            </div>

            <div>
              <label class="block text-slate-400 font-bold mb-1">Formation State</label>
              <input type="text" id="new-entity-state" placeholder="e.g. WA, DE" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
            </div>

            <div>
              <label class="block text-slate-400 font-bold mb-1">Operating Bank / Depository</label>
              <input type="text" id="new-entity-bank" placeholder="e.g. Chase Commercial Banking (*4892)" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
            </div>

            <button type="submit" class="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-md shadow-emerald-900/30 flex items-center justify-center space-x-2">
              <span>Save Entity</span>
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

    fetchEntities().then(function(entities) {
      renderEntitiesList(entities);
    });

    setTimeout(function() {
      const input = modalDiv.querySelector('#new-entity-name');
      if (input) input.focus();
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

  function handleSelectAllEntities() {
    try {
      localStorage.setItem('mathtree_selected_entity_id', 'all');
    } catch(e) {}
    broadcastEntityChange('all', 'All LLCs');
    closeModal('modal-manage-entities');
  }

  function broadcastEntityChange(entityId, llcName) {
    const detail = { entityId: entityId || null, llc: llcName || null };
    
    // Dispatch both standard and double-d events on window
    window.dispatchEvent(new CustomEvent('mathtree:entity-changed', { detail }));
    window.dispatchEvent(new CustomEvent('mathtree:entity-changedd', { detail }));

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('mathtree_store_channel');
        bc.postMessage({ type: 'ENTITY_CHANGED', event: 'mathtree:entity-changedd', entityId, llc: llcName });
        bc.close();
      }
    } catch (e) {}
  }

  async function fetchEntities() {
    let currentUserId = window._currentUser?.id;
    if (!currentUserId && window._supabase) {
      try {
        const { data: userData } = await window._supabase.auth.getUser();
        if (userData?.user) {
          currentUserId = userData.user.id;
          window._currentUser = userData.user;
        }
      } catch (e) {}
    }

    if (window._supabase && currentUserId && !window._currentUser?.demo) {
      try {
        const { data, error } = await window._supabase
          .from('entities')
          .select('*')
          .eq('user_id', currentUserId)
          .order('name', { ascending: true });
        if (!error && data) {
          localEntities = data;
          saveLocalEntitiesCache();
          return localEntities;
        }
      } catch (e) {
        console.warn('[ManageEntities] Supabase fetch error, using local entities:', e);
      }
    }
    return localEntities;
  }

  function renderEntitiesList(entities) {
    const container = document.getElementById('entities-list-container');
    if (!container) return;

    if (!entities || entities.length === 0) {
      container.innerHTML = `
        <div class="text-xs text-slate-500 italic p-3 text-center bg-slate-950 rounded-xl border border-slate-800/60">
          No legal entities registered yet. Click below to add one.
        </div>
      `;
      return;
    }

    container.innerHTML = entities.map(function(e) {
      return `
        <div class="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <span class="block font-bold text-white text-xs truncate">${e.name}</span>
            <span class="block text-[10px] text-slate-400 truncate">${e.formation_state ? e.formation_state + ' LLC' : 'Entity'} ${e.bank_name ? '• ' + e.bank_name : ''}</span>
          </div>
          <div class="flex items-center space-x-1.5 shrink-0">
            <span class="text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">Active</span>
            <button type="button" onclick="handleDeleteEntity('${e.id}')" class="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition" title="Delete Entity">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function openEntityManagementModal(e) {
    return mountManageEntitiesModal(e);
  }

  async function handleCreateEntity(e) {
    if (e && e.preventDefault) e.preventDefault();

    const nameInput = document.getElementById('new-entity-name');
    const stateInput = document.getElementById('new-entity-state');
    const bankInput = document.getElementById('new-entity-bank');

    const name = nameInput?.value?.trim();
    if (!name) return;

    const state = stateInput?.value?.trim() || '';
    const bank = bankInput?.value?.trim() || '';

    let newEntity = {
      id: 'ent-' + Date.now(),
      name: name,
      formation_state: state,
      bank_name: bank,
      depository_bank: bank
    };

    let currentUserId = window._currentUser?.id;
    if (!currentUserId && window._supabase) {
      try {
        const { data: userData } = await window._supabase.auth.getUser();
        if (userData?.user) {
          currentUserId = userData.user.id;
          window._currentUser = userData.user;
        }
      } catch (err) {}
    }

    if (window._supabase && currentUserId && !window._currentUser?.demo) {
      try {
        const { data, error } = await window._supabase
          .from('entities')
          .insert({
            user_id: currentUserId,
            name: name,
            formation_state: state || null,
            bank_name: bank || null
          })
          .select()
          .single();

        if (!error && data) {
          newEntity = data;
        }
      } catch (err) {
        console.warn('[ManageEntities] Supabase insert warning:', err);
      }
    }

    localEntities.push(newEntity);
    saveLocalEntitiesCache();

    const form = document.getElementById('form-create-entity');
    if (form) form.reset();

    renderEntitiesList(localEntities);
    broadcastEntityChange(newEntity.id, newEntity.name);

    if (typeof window.populateFilterDropdowns === 'function') {
      window.populateFilterDropdowns();
    }
  }

  async function handleDeleteEntity(entityId) {
    if (!confirm('Are you sure you want to remove this entity? Any properties assigned to it will be unassigned.')) return;

    let currentUserId = window._currentUser?.id;
    if (window._supabase && currentUserId && !window._currentUser?.demo) {
      try {
        await window._supabase
          .from('entities')
          .delete()
          .eq('id', entityId)
          .eq('user_id', currentUserId);
      } catch (err) {
        console.warn('[ManageEntities] Supabase delete warning:', err);
      }
    }

    localEntities = localEntities.filter(function(e) { return e.id !== entityId; });
    saveLocalEntitiesCache();

    renderEntitiesList(localEntities);
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
  window.addEventListener('mathtree:entity-changedd', handleExternalEntityChange);

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

  // Delegated click listener ensuring immediate in-place mounting for any Manage LLCs trigger
  window.addEventListener('click', function(event) {
    const target = event.target;
    if (target && (target.textContent?.trim() === '+ Manage LLCs' || target.textContent?.includes('Manage LLCs') || target.closest?.('#btn-dash-manage-llcs, #btn-menu-manage-entities'))) {
      if (typeof window.mountManageEntitiesModal === 'function') {
        window.mountManageEntitiesModal(event);
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
