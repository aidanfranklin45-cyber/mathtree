import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { clearWizardDraft, hasWizardDraft, loadWizardDraft, saveWizardDraft, takeReopenOnLoad } from './wizardDraft';

const store = new Map<string, string>();
const draft = { w: { name: 'Cowiche Creek', price: '18400000' }, filledOnce: true, isNameTouched: true, docExtra: { primaryApn: '181309-41011' }, seededBasis: {}, assessor: null, parcels: [] };

describe('the new-project draft', () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('keeps what was typed, gives it back, and is gone once cleared', () => {
    expect(hasWizardDraft()).toBe(false);
    saveWizardDraft(draft);
    expect(loadWizardDraft()?.w.price).toBe('18400000');
    expect(loadWizardDraft()?.docExtra).toEqual({ primaryApn: '181309-41011' });
    clearWizardDraft();
    expect(loadWizardDraft()).toBeNull();
  });

  it('forgets a draft older than two hours, and a damaged one', () => {
    vi.useFakeTimers();
    saveWizardDraft(draft);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1000);
    expect(loadWizardDraft()).toBeNull();
    store.set('mathtree_wizard_draft_v1', '{not json');
    expect(loadWizardDraft()).toBeNull();
  });

  it('reopens by itself once per page load, and only when there is a draft', () => {
    saveWizardDraft(draft);
    expect(takeReopenOnLoad()).toBe(true);
    expect(takeReopenOnLoad()).toBe(false); // visiting the dashboard again does not pop the form open
  });
});
