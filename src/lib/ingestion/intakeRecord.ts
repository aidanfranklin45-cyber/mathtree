/**
 * The record that lets anyone justify a number in the engine: which documents were read, where each figure came from and the reasoning behind
 * it, what the seller merely claimed, the judgment calls made along the way, and what the owner decided. It is saved on the project when it is
 * created, as plain data. It holds no document text and no tenant names (only our own one-line explanations and the figures themselves).
 *
 * A figure that was read from a document or taken from the investor profile and then changed by the owner is recorded as the owner's.
 * Anything the owner simply typed, with no document or profile behind it, is theirs by default and is not listed.
 */

export interface RecordedDocument { name: string; type: string }

export interface DocumentFigure {
  key: string;
  label: string;
  /** What was read, as shown to the owner. */
  text: string;
  /** The value as the project stores it (a number or a string); undefined for a tenant list, which is compared by what it says in `text`. */
  value: number | string | undefined;
  how: string;
  reliability: string;
  /** What the project holds for this figure now, when it can be told; undefined when it cannot (so it is taken as unchanged). */
  current: number | string | undefined;
}

export interface ProfileFigure { key: string; label: string; value: number; why?: string }

export interface RecordedFigure {
  key: string;
  label: string;
  value: number | string | null;
  source: 'document' | 'profile' | 'owner';
  /** The reasoning: how it was found, or the owner's reason, or what they changed. */
  how: string;
  reliability?: string;
}

export interface IntakeRecord {
  version: 1;
  recordedAt: string;
  documents: RecordedDocument[];
  figures: RecordedFigure[];
  claims: Array<{ label: string; value: number }>;
  notes: string[];
  /** What the owner decided where sources disagreed. */
  choices: Array<{ label: string; decision: string }>;
  /** The owner confirmed they reviewed everything read or filled in. The tool helps; the owner underwrites the deal. */
  verification?: { at: string; by: string; statement: string };
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const same = (a: number | string | undefined, b: number | string | undefined): boolean =>
  typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : String(a ?? '') === String(b ?? '');

export function buildIntakeRecord(args: {
  now?: Date;
  documents: RecordedDocument[];
  documentFigures: DocumentFigure[];
  profileFigures: ProfileFigure[];
  claims: Array<{ how: string; value: number }>;
  notes: string[];
  choices: Array<{ label: string; decision: string }>;
  /** Who confirmed, when the project is created (the account that created it). */
  verifiedBy?: string;
}): IntakeRecord | null {
  const figures: RecordedFigure[] = [];
  for (const f of args.documentFigures) {
    const changed = f.current !== undefined && f.value !== undefined && !same(f.current, f.value);
    figures.push(changed
      ? { key: f.key, label: f.label, value: f.current as number | string, source: 'owner', how: cut(`Changed by you. The document said ${f.text}. ${f.how}`, 400) }
      : { key: f.key, label: f.label, value: f.value ?? null, source: 'document', how: cut(`${f.text}. ${f.how}`, 400), reliability: f.reliability });
  }
  for (const p of args.profileFigures) {
    figures.push({ key: p.key, label: p.label, value: p.value, source: 'profile', how: cut(p.why ? `Your investor profile: ${p.why}` : 'Your investor profile', 400) });
  }
  if (args.documents.length === 0 && figures.length === 0) return null;
  return {
    version: 1,
    recordedAt: (args.now ?? new Date()).toISOString(),
    documents: args.documents.slice(0, 20).map((d) => ({ name: cut(d.name, 120), type: d.type })),
    figures: figures.slice(0, 80),
    claims: args.claims.slice(0, 20).map((c) => ({ label: cut(c.how, 160), value: c.value })),
    notes: args.notes.slice(0, 20).map((n) => cut(n, 500)),
    choices: args.choices.slice(0, 20).map((c) => ({ label: cut(c.label, 80), decision: cut(c.decision, 200) })),
    ...(args.verifiedBy ? { verification: { at: (args.now ?? new Date()).toISOString(), by: args.verifiedBy, statement: 'Reviewed and confirmed by the owner before the project was created.' } } : {}),
  };
}

/** What the fill produced and the owner has not yet turned into a saved record. Kept in the form (and its draft) until the project is created. */
export interface IntakeSnapshot {
  documents: RecordedDocument[];
  figures: Array<Omit<DocumentFigure, 'current'>>;
  claims: Array<{ how: string; value: number }>;
  notes: string[];
}
