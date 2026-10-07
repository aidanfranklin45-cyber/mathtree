/**
 * The receipt for a figure: what it rests on. A number in the underwriting is one of three things: read from a document (and then it points to the
 * page and line it was read from), taken from the owner's investor profile (and then it carries the reason the owner gave), or the owner's own
 * entry. This joins the saved record of a project to the lines the reader took from each document, so any figure can be walked back to its source.
 *
 * Pure. It reads what is saved with the project; it computes nothing.
 */

import type { IntakeRecord, RecordedFigure } from './intakeRecord';
import type { TraceRow } from './lineage';

export interface SourceRef {
  document: string;
  /** The page of the document the line is on, when the document had page markers. */
  page: number | null;
  line: number | null;
  /** What the reader called the line, and the line of the document it was found on. */
  label: string;
  snippet: string | null;
  amount: number | null;
}

export interface Receipt {
  key: string;
  label: string;
  value: number | string | null;
  source: RecordedFigure['source'];
  /** The reasoning recorded with the figure. */
  how: string;
  /** For a document figure: the lines it was built from. Empty for a profile figure or the owner's own entry. */
  from: SourceRef[];
  /** Whether the figure can be walked back to its source: a document figure to a line found in the document, the others by their recorded reason. */
  traced: boolean;
}

const toRef = (r: TraceRow): SourceRef => ({ document: r.document, page: r.page, line: r.line, label: r.label, snippet: r.snippet, amount: r.amount });

export function receiptsFor(record: Pick<IntakeRecord, 'figures' | 'lineage'> | null | undefined): Receipt[] {
  if (!record) return [];
  const rows = record.lineage ?? [];
  return record.figures.map((f) => {
    if (f.source === 'document') {
      const from = rows.filter((r) => r.found && r.snippet && (r.keys ?? []).includes(f.key)).map(toRef);
      return { key: f.key, label: f.label, value: f.value, source: f.source, how: f.how, from, traced: from.length > 0 };
    }
    // A profile figure is traced by the standard it is (and the reason the owner gave); an owner's figure by the fact that it is theirs
    return { key: f.key, label: f.label, value: f.value, source: f.source, how: f.how, from: [], traced: f.how.trim().length > 0 };
  });
}

/** The figures that cannot be walked back to a source: a document figure with no line found in the document, or one with no recorded reason. */
export function untraced(receipts: Receipt[]): Receipt[] {
  return receipts.filter((r) => !r.traced);
}

/** One line for a person: where the figure came from, in words. */
export function receiptText(r: Receipt): string {
  if (r.source === 'profile') return `Your investor profile. ${r.how.replace(/^Your investor profile:?\s*/, '')}`.trim();
  if (r.source === 'owner') return `Your own entry. ${r.how}`.trim();
  if (r.from.length === 0) return 'Read from a document, but the line could not be found in its text.';
  const first = r.from[0];
  const where = `${first.document}${first.page !== null ? `, page ${first.page}` : ''}`;
  const more = r.from.length > 1 ? ` and ${r.from.length - 1} more line${r.from.length === 2 ? '' : 's'}` : '';
  return `${where}: "${first.snippet}"${more}`;
}
