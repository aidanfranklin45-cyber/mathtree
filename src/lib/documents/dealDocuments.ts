/**
 * The original documents (offering memorandum, rent roll, statements) kept with the deal, in a private bucket. Whoever owns the deal can read them.
 * See supabase/migrations_draft/16_deal_documents.sql. Nothing here is required for a project to exist: a missing bucket or a failed upload
 * is reported and the project is still created.
 */

import { supabase } from '../supabase/client';

export const DEAL_DOCUMENT_BUCKET = 'deal-documents';
/** The free plan's own cap per file; the bucket enforces the same. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/** The type to store a file under, from its extension (browsers report a CSV or Excel file as many things, or as nothing). Null when it is not a kind we keep. */
export function documentMimeType(fileName: string): string | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return ext ? MIME_BY_EXTENSION[ext] ?? null : null;
}

/** A file name that is safe in a storage path: letters, digits, dot, dash, underscore and spaces only. */
export function safeFileName(name: string): string {
  const cleaned = String(name ?? '').replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').replace(/_{2,}/g, '_').trim();
  return cleaned.replace(/^\.+/, '') || 'document';
}

/** <deal id>/<time>-<name>: the deal id first is what the bucket's access rule checks (the deal's current owner can read it). */
export function documentPath(dealId: string, fileName: string, stamp: number = Date.now()): string {
  return `${dealId}/${stamp}-${safeFileName(fileName)}`;
}

export interface StoredDocument {
  id: string;
  deal_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
  doc_type: string | null;
  uploaded_at: string;
}

export interface UploadResult {
  saved: string[];
  failed: Array<{ name: string; reason: string }>;
}

/** Stores the files with the deal and lists them. A file that cannot be stored is reported by name and reason; the others are still stored. */
export async function uploadDealDocuments(args: { userId: string; dealId: string; files: Array<{ file: File; type?: string }> }): Promise<UploadResult> {
  const out: UploadResult = { saved: [], failed: [] };
  let stamp = Date.now();
  for (const { file, type } of args.files) {
    const mime = documentMimeType(file.name);
    if (!mime) { out.failed.push({ name: file.name, reason: 'This kind of file is not kept (PDF, CSV, Excel, Word or text only).' }); continue; }
    if (file.size > MAX_DOCUMENT_BYTES) { out.failed.push({ name: file.name, reason: 'It is larger than 50 MB.' }); continue; }
    const path = documentPath(args.dealId, file.name, stamp++);
    try {
      const up = await supabase.storage.from(DEAL_DOCUMENT_BUCKET).upload(path, file, { contentType: mime, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const row = await supabase.from('deal_documents' as never).insert({
        deal_id: args.dealId, user_id: args.userId, file_name: file.name, storage_path: path, mime_type: mime, size_bytes: file.size, doc_type: type ?? null,
      } as never);
      if (row.error) {
        // No list entry means nobody could find the file: take it back out rather than leave it orphaned
        await supabase.storage.from(DEAL_DOCUMENT_BUCKET).remove([path]);
        throw new Error(row.error.message);
      }
      out.saved.push(file.name);
    } catch (e) {
      out.failed.push({ name: file.name, reason: e instanceof Error ? e.message : 'Could not be stored.' });
    }
  }
  return out;
}

/** The documents kept with a deal, newest first. Empty when there are none, or when the storage has not been set up yet. */
export async function listDealDocuments(dealId: string): Promise<StoredDocument[]> {
  try {
    const { data, error } = await supabase.from('deal_documents' as never).select('*').eq('deal_id', dealId).order('uploaded_at', { ascending: false });
    if (error) return [];
    return (data as unknown as StoredDocument[]) ?? [];
  } catch {
    return [];
  }
}

/** The stored file itself, fetched through the signed-in session (no link is made, so there is nothing to share or expire). Null when it cannot be read. */
export async function downloadDealDocument(path: string): Promise<Blob | null> {
  try {
    const { data, error } = await supabase.storage.from(DEAL_DOCUMENT_BUCKET).download(path);
    return error ? null : data ?? null;
  } catch {
    return null;
  }
}

/** Whether a browser can show the file in a tab (a PDF or plain text); any other file is downloaded. */
export const opensInTab = (mime: string | null): boolean => mime === 'application/pdf' || mime === 'text/plain';
