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
      ein: '91-1234567',
      bank_name: 'Chase Commercial (*4892)',
      depository_bank: 'Chase Commercial (*4892)'
    },
    {
      id: 'ent-demo-2',
      name: 'Cascade Property Holdings LLC',
      formation_state: 'DE',
      ein: '82-7654321',
      bank_name: 'Wells Fargo Real Estate (*1042)',
      depository_bank: 'Wells Fargo Real Estate (*1042)'
    }
  ];

  // Try to load cached entities from localStorage
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

  function mountManageEntitiesModal() {
    if (document.getElementById('modal-manage-entities')) return;

    const modalDiv = document.createElement('div');
    modalDiv.id = 'modal-manage-entities';
    modalDiv.className = 'hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm';
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
          <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Entities</label>
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

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 font-bold mb-1">Formation State</label>
              <input type="text" id="new-entity-state" placeholder="e.g. WA, DE" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-slate-400 font-bold mb-1">EIN / Tax ID</label>
              <input type="text" id="new-entity-ein" placeholder="XX-XXXXXXX" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none">
            </div>
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
  }

  function closeModal(modalId) {
    const el = document.getElementById(modalId || 'modal-manage-entities');
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
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
    if (window._supabase && window._currentUser && !window._currentUser.demo) {
      try {
        const { data, error } = await window._supabase
          .from('entities')
          .select('*')
          .eq('user_id', window._currentUser.id)
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
      container.innerHTML = '<div class="text-xs text-slate-500 italic p-2 text-center bg-slate-950 rounded-xl border border-slate-800/60">No legal entities registered yet.</div>';
      return;
    }

    container.innerHTML = entities.map(e => `
      <div class="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <span class="block font-bold text-white text-xs truncate">${e.name}</span>
          <span class="block text-[10px] text-slate-400 truncate">${e.formation_state ? e.formation_state + ' LLC' : 'Entity'} ${e.ein ? '• EIN: ' + e.ein : ''} ${e.bank_name ? '• ' + e.bank_name : ''}</span>
        </div>
        <div class="flex items-center space-x-1.5 shrink-0">
          <span class="text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">Active</span>
          <button type="button" onclick="handleDeleteEntity('${e.id}')" class="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition" title="Delete Entity">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  async function openEntityManagementModal() {
    mountManageEntitiesModal();
    const entities = await fetchEntities();
    renderEntitiesList(entities);

    const modal = document.getElementById('modal-manage-entities');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  async function handleCreateEntity(e) {
    if (e && e.preventDefault) e.preventDefault();

    const nameInput = document.getElementById('new-entity-name');
    const stateInput = document.getElementById('new-entity-state');
    const einInput = document.getElementById('new-entity-ein');
    const bankInput = document.getElementById('new-entity-bank');

    const name = nameInput?.value?.trim();
    if (!name) return;

    const state = stateInput?.value?.trim() || '';
    const ein = einInput?.value?.trim() || '';
    const bank = bankInput?.value?.trim() || '';

    let newEntity = {
      id: 'ent-' + Date.now(),
      name: name,
      formation_state: state,
      ein: ein,
      bank_name: bank,
      depository_bank: bank
    };

    if (window._supabase && window._currentUser && !window._currentUser.demo) {
      try {
        const { data, error } = await window._supabase
          .from('entities')
          .insert({
            user_id: window._currentUser.id,
            name: name,
            formation_state: state || null,
            ein: ein || null,
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

    if (window._supabase && window._currentUser && !window._currentUser.demo) {
      try {
        await window._supabase
          .from('entities')
          .delete()
          .eq('id', entityId);
      } catch (err) {
        console.warn('[ManageEntities] Supabase delete warning:', err);
      }
    }

    localEntities = localEntities.filter(e => e.id !== entityId);
    saveLocalEntitiesCache();

    renderEntitiesList(localEntities);
    broadcastEntityChange(null, null);

    if (typeof window.populateFilterDropdowns === 'function') {
      window.populateFilterDropdowns();
    }
  }

  // Expose on window
  window.mountManageEntitiesModal = mountManageEntitiesModal;
  window.openEntityManagementModal = openEntityManagementModal;
  window.closeModal = closeModal;
  window.handleCreateEntity = handleCreateEntity;
  window.handleDeleteEntity = handleDeleteEntity;

  // Pre-mount if document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountManageEntitiesModal);
  } else {
    mountManageEntitiesModal();
  }

})(window);
