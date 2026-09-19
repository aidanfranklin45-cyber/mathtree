/**
 * src/components/modal-manage-entities.ts
 * Shared In-Place LLC & Legal Entity Management Modal & CRUD Controller
 * Single Source of Truth for MathTree Studio
 */

export interface LegalEntity {
  id: string;
  name: string;
  formation_state?: string;
  ein?: string;
  bank_name?: string;
  depository_bank?: string;
}

export function broadcastEntityChange(entityId: string | null, llcName?: string | null): void {
  if (typeof window === 'undefined') return;
  const detail = { entityId: entityId || null, llc: llcName || null };
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
