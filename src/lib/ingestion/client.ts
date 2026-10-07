import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase/client';
import type { DocumentType, IntakeDocument } from './intake';

export interface ParsedDocument {
  documentType: DocumentType;
  intake: IntakeDocument;
  /** What was hidden from the model before it saw the text. */
  redaction: { emails: number; phones: number; ids: number; names: number };
  model: string;
  message?: string;
}

/** What the owner is told when no model could answer because of demand. The same sentence the reader itself sends. */
export const READER_BUSY_MESSAGE = 'Due to high demand the parser is currently unavailable. Please try again later.';

/**
 * A message fit for the owner. A reader that was busy, out of room, or could not be reached is one calm sentence (waiting fixes it). Anything else
 * keeps its detail: a setup problem is something the owner may need to see. The reader sends the calm sentence itself once it is updated; an older
 * reader sent its gateway detail, which is recognised by the replies that mean demand (429, 500, 502, 503, 504) or by no answer.
 */
export function readerErrorMessage(message: string | undefined, status: number): string {
  const text = String(message ?? '');
  if (/Due to high demand/i.test(text)) return text;
  if (/The AI gateway returned (429|500|502|503|504)\b/.test(text) || /The model took too long to answer|The model returned no answer|Could not reach the AI gateway/i.test(text)) return READER_BUSY_MESSAGE;
  return text || `The document reader returned ${status}.`;
}

/** Sends one document's text to the parse-document edge function. Throws an Error with a message fit to show the owner. */
export async function readDocument(args: { text: string; filename?: string; documentType?: Exclude<DocumentType, 'unknown'>; knownNames?: string[] }): Promise<ParsedDocument> {
  // Development only: a stand-in for the reader, so the flow can be tried while the real one is unavailable (see devReader.ts)
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('stubReader')) {
    const { devReadDocument } = await import('./devReader');
    return devReadDocument(args.text);
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in to read a document.');
  // One request, never repeated here: a free tier counts every request, and the reader already moves on to another model by itself
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/parse-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error('Could not reach the document reader. Check your connection and try again.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(readerErrorMessage(body?.error, res.status));
  return body as ParsedDocument;
}
