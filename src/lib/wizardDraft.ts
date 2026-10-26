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
  /** What was read and decided so far, so the project's record of sources survives a reload. */
  intake?: unknown;
  answers?: Record<string, { label: string; decision: string }>;
  /** The closing date the investor profile filled in, and the weeks it used. */
  closingFilled?: { date: string; weeks: number } | null;
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
  try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(DOCS_KEY); } catch { /* nothing to clear */ }
}

/**
 * The documents a draft was filled from. The figures in a restored form came from them, so they come back too: otherwise the form would show
 * numbers whose source is gone. Text only; an original file (a PDF) is not kept across a reload and has to be added again to be saved with the project.
 */
const DOCS_KEY = 'mathtree_wizard_docs_v1';
export interface DraftDocument { id: number; name: string; text: string; type: string }

export function saveDraftDocuments(docs: DraftDocument[]): void {
  try {
    if (docs.length === 0) sessionStorage.removeItem(DOCS_KEY);
    else sessionStorage.setItem(DOCS_KEY, JSON.stringify(docs));
  } catch { /* too large or unavailable: the form still works */ }
}

/** Only while a draft of the form exists: documents never outlive the form they were read into. */
export function loadDraftDocuments(): DraftDocument[] {
  try {
    if (!hasWizardDraft()) return [];
    const raw = sessionStorage.getItem(DOCS_KEY);
    const docs = raw ? JSON.parse(raw) : [];
    return Array.isArray(docs) ? docs.filter((d) => d && typeof d.text === 'string' && typeof d.name === 'string') : [];
  } catch { return []; }
}
