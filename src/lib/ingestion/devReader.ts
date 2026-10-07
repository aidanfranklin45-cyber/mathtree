/**
 * A stand-in for the document reader, for development only. The real reader is a language model reached through Google, which is sometimes
 * unavailable for hours; this lets the rest of the new-project flow be tried meanwhile. It is switched on by adding `?stubReader=1` to the app's
 * address in a development server. It knows the documents of the test bench (the Cowiche Creek memorandum and the invented ones for each asset
 * class, see `evals/assetClasses`), and answers each with the simulated reader answer kept beside it. It is not part of the production build:
 * `readDocument` imports it behind `import.meta.env.DEV`, which the build removes.
 */

import { coerceIntake } from '@engine/intakeParse';
import { BENCH_DOCUMENTS } from './evals/assetClasses/documents';
import { COWICHE_READER_ANSWER } from './evals/fixtures/cowicheReader';
import type { ParsedDocument } from './client';

/** What identifies each document of the bench in the text pasted or read: its title line. */
const SIGNATURES: Array<{ match: RegExp; type: ParsedDocument['documentType']; answer: Record<string, unknown> }> = [
  { match: /cowiche creek/i, type: 'offering_memorandum', answer: COWICHE_READER_ANSWER },
  ...BENCH_DOCUMENTS.map((d) => ({ match: d.signature, type: d.type as ParsedDocument['documentType'], answer: d.answer })),
];

export function devReadDocument(text: string): ParsedDocument {
  const hit = SIGNATURES.find((s) => s.match.test(text));
  if (!hit) throw new Error('The stand-in reader only knows the test bench documents (Cowiche Creek, Sunnyside house, Parkside Retail, Selah Self Storage, Maple Court). Remove ?stubReader=1 from the address to use the real reader.');
  return {
    documentType: hit.type,
    intake: coerceIntake(hit.type as never, hit.answer),
    redaction: { emails: 0, phones: 0, ids: 0, names: 0 },
    model: 'stand-in reader (development)',
  };
}
