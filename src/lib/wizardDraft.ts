/**
 * The new-project form is long, and a page reload (a new version going out, a stale tab, a refresh) would throw away everything typed. The
 * form is kept here as a draft for as long as the tab lives, and put back when the form opens again. It is cleared when the project is
 * created or the owner closes the form on purpose. Per tab (sessionStorage), so it never leaks to another window, and never kept for long.
 */

const KEY = 'mathtree_wizard_draft_v1';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface WizardDraft {
  w: Record<string, string>;
  filledOnce: boolean;
  isNameTouched: boolean;
  docExtra: Record<string, unknown>;
  seededBasis: Record<string, unknown>;
  assessor: unknown;
  parcels: unknown[];
}

interface Stored extends WizardDraft { savedAt: number }

export function saveWizardDraft(draft: WizardDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...draft, savedAt: Date.now() } satisfies Stored));
  } catch { /* storage full or unavailable: the form still works, it just is not kept */ }
}

export function loadWizardDraft(): WizardDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored;
    if (!d || typeof d.savedAt !== 'number' || Date.now() - d.savedAt > MAX_AGE_MS || !d.w || typeof d.w !== 'object') {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export const hasWizardDraft = (): boolean => loadWizardDraft() !== null;

/** True once per page load, when a draft exists: the form reopens by itself after a reload, but not whenever the dashboard is visited again. */
let reopenPending = true;
export function takeReopenOnLoad(): boolean {
  const pending = reopenPending;
  reopenPending = false;
  return pending && hasWizardDraft();
}

export function clearWizardDraft(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
