/**
 * The bench's documents exist twice: as text in `documents.ts` (what the tests read) and as `.txt` files in `texts/` (what a person pastes into the
 * new-project form to try the same document in the browser, with `?stubReader=1`). These tests keep the two the same, and keep the stand-in reader
 * able to recognise each.
 */
import { describe, expect, it } from 'vitest';
import { devReadDocument } from '../../devReader';
import { BENCH_DOCUMENTS } from './documents';

const files = import.meta.glob('./texts/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('the bench documents as text files', () => {
  it('has a file for every document, with exactly its text', () => {
    for (const d of BENCH_DOCUMENTS) {
      const text = files[`./texts/${d.file}`];
      expect(text, d.file).toBeDefined();
      expect(text.replace(/\r\n/g, '\n').trimEnd(), d.file).toBe(d.text);
    }
  });

  it('is recognised by the stand-in reader as the kind of document it is', () => {
    for (const d of BENCH_DOCUMENTS) expect(devReadDocument(d.text).documentType, d.name).toBe(d.type);
  });

  it('is not mistaken for another document of the same building', () => {
    const maple = BENCH_DOCUMENTS.filter((d) => /maple/i.test(d.file));
    expect(maple.map((d) => devReadDocument(d.text).documentType)).toEqual(['offering_memorandum', 'operating_statement', 'rent_roll']);
  });

  it('refuses a document it does not know, and says which it knows', () => {
    expect(() => devReadDocument('Some other document entirely, with no title the bench knows.')).toThrow(/test bench documents/);
  });
});
