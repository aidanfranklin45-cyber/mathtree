/**
 * A stand-in for the document reader, for development only. The real reader is a language model reached through Google, which is sometimes
 * unavailable for hours; this lets the rest of the new-project flow be tried meanwhile. It is switched on by adding `?stubReader=1` to the app's
 * address in a development server, and it only knows the Cowiche Creek memorandum (it answers with the simulated reader answer the evals use).
 * It is not part of the production build: `readDocument` imports it behind `import.meta.env.DEV`, which the build removes.
 */

import { coerceIntake } from '@engine/intakeParse';
import { COWICHE_READER_ANSWER } from './evals/fixtures/cowicheReader';
import type { ParsedDocument } from './client';

export function devReadDocument(text: string): ParsedDocument {
  if (!/cowiche/i.test(text)) throw new Error('The stand-in reader only knows the Cowiche Creek memorandum. Remove ?stubReader=1 from the address to use the real reader.');
  return {
    documentType: 'offering_memorandum',
    intake: coerceIntake('offering_memorandum', COWICHE_READER_ANSWER),
    redaction: { emails: 0, phones: 0, ids: 0, names: 0 },
    model: 'stand-in reader (development)',
  };
}
