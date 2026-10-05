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

/** Sends one document's text to the parse-document edge function. Throws an Error with a message fit to show the owner. */
export async function readDocument(args: { text: string; filename?: string; documentType?: Exclude<DocumentType, 'unknown'>; knownNames?: string[] }): Promise<ParsedDocument> {
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
  if (!res.ok) throw new Error(body?.error || `The document reader returned ${res.status}.`);
  return body as ParsedDocument;
}
