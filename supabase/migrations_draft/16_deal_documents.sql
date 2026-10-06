-- DRAFT 16: keep the original documents (offering memorandum, rent roll, statements) with the deal.   *** NOT APPLIED. Run by hand after review. ***
--
-- Adds ONE private storage bucket, `deal-documents`, and ONE table, `public.deal_documents`, that lists what is in it. Nothing existing changes.
--
-- Who can see a file: only the account that uploaded it. The bucket is private (no public links) and its policies require the first
-- folder of the file's path to be the caller's own user id. Files are read through short-lived signed links made by the app.
-- Rules inside the database (the browser cannot skip them):
--   * 50 MB per file (the free plan's own cap), and only PDF, CSV, Excel, Word and plain text
--   * a file can be added and removed by its owner; it cannot be edited in place (replace it by uploading again)
--   * a document row can only point at a deal the caller owns
--
-- Things this does NOT do yet (follow-ups, noted on purpose):
--   * rpc_transfer_deal_ownership (draft 10) re-points the table rows but not the files, whose path starts with the old owner's id.
--     After a transfer the new owner would see the list but could not open the files. Extend the function to move the objects first.
--   * Deleting a deal deletes its document rows (ON DELETE CASCADE) but not the files themselves. Remove the files in the same step.
--   * Deal shares do not grant access to documents. They contain names and contact details the parser redacts before reading.
-- Rolling back: DROP TABLE public.deal_documents; DELETE FROM storage.objects WHERE bucket_id = 'deal-documents';
--               DELETE FROM storage.buckets WHERE id = 'deal-documents';  (and drop the four policies below)

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

-- Owner-only access to the files: <user id>/<deal id>/<file>
CREATE POLICY deal_documents_files_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deal-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY deal_documents_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deal-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY deal_documents_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'deal-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE TABLE public.deal_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
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
  USING (user_id = auth.uid());
CREATE POLICY deal_documents_insert ON public.deal_documents FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.user_id = auth.uid())
  );
CREATE POLICY deal_documents_delete ON public.deal_documents FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMIT;
