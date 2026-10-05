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

/** Files read as text in the browser. Other formats are not supported yet, and the message says so rather than reading them badly. */
export const READABLE_EXTENSIONS = ['.csv', '.tsv', '.txt', '.md'];

export function isReadableFile(name: string): boolean {
  const lower = name.toLowerCase();
  return READABLE_EXTENSIONS.some((e) => lower.endsWith(e));
}

/** Sends one document's text to the parse-document edge function. Throws an Error with a message fit to show the owner. */
export async function readDocument(args: { text: string; filename?: string; documentType?: Exclude<DocumentType, 'unknown'>; knownNames?: string[] }): Promise<ParsedDocument> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in to read a document.');
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
