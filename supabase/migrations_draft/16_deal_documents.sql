-- 16: keep the original documents (offering memorandum, rent roll, statements) with the deal.   *** APPLIED 2026-10-05 (via the Supabase tool, without the BEGIN and COMMIT, which the tool adds itself). Do not re-run. ***
--
-- Adds ONE private storage bucket, `deal-documents`, and ONE table, `public.deal_documents`, that lists what is in it. Nothing existing changes.
--
-- Who can see a file: the CURRENT OWNER OF THE DEAL, and nobody else. Access follows the deal, not the person who uploaded the file, so when a
-- deal is transferred (rpc_transfer_deal_ownership, draft 10) the new owner can open its documents and the previous owner no longer can, with
-- nothing to move or re-point. Files are stored as <deal id>/<file>; every rule below looks the deal up in `deals` and checks `user_id = auth.uid()`.
-- The bucket is private (no public links). Files are read by the app through the signed-in session, never through a link anyone could share.
-- Rules inside the database (the browser cannot skip them):
--   * 50 MB per file (the free plan's own cap), and only PDF, CSV, Excel, Word and plain text
--   * the deal's owner can add, read and remove files; a file cannot be edited in place (replace it by uploading again)
--   * `deal_documents.user_id` records who uploaded the file. It is history only and grants nothing.
--
-- Things this does NOT do (follow-ups, noted on purpose):
--   * Deleting a deal deletes its document rows (ON DELETE CASCADE) but not the files themselves. Remove the files in the same step.
--   * Deal shares do not grant access to documents. They contain names and contact details the parser redacts before reading.
-- Rolling back: DROP TABLE public.deal_documents; DELETE FROM storage.objects WHERE bucket_id = 'deal-documents';
--               DELETE FROM storage.buckets WHERE id = 'deal-documents';  (and drop the policies below)

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deal-documents', 'deal-documents', false, 52428800,
  ARRAY[
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- The files: <deal id>/<file>. Whoever owns that deal now can read, add and remove them.
CREATE POLICY deal_documents_files_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'deal-documents'
    AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id::text = (storage.foldername(name))[1] AND d.user_id = auth.uid())
  );
CREATE POLICY deal_documents_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deal-documents'
    AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id::text = (storage.foldername(name))[1] AND d.user_id = auth.uid())
  );
CREATE POLICY deal_documents_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'deal-documents'
    AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id::text = (storage.foldername(name))[1] AND d.user_id = auth.uid())
  );

CREATE TABLE public.deal_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  -- who uploaded it (history only: access follows the deal's current owner)
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  file_name    text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type    text,
  size_bytes   bigint NOT NULL CHECK (size_bytes >= 0),
  -- what it was read as (offering_memorandum, operating_statement, rent_roll, ...), when it was read
  doc_type     text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deal_documents_deal_idx ON public.deal_documents (deal_id);

ALTER TABLE public.deal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY deal_documents_select ON public.deal_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.user_id = auth.uid()));
CREATE POLICY deal_documents_insert ON public.deal_documents FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.user_id = auth.uid())
  );
CREATE POLICY deal_documents_delete ON public.deal_documents FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.user_id = auth.uid()));

COMMIT;
