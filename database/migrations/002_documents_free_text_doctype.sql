-- Relaxes documents.doc_type from a fixed enum to free text, so uploads aren't limited to a
-- hardcoded whitelist (pdf/png/jpg/map/manual/compliance) — any file type is now allowed. Safe to
-- run repeatedly: the guard skips it once already applied. Backend/src/db/bootstrap.ts also runs
-- this automatically on every boot, so a live deploy self-heals without manual intervention.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'documents' AND column_name = 'doc_type' AND udt_name = 'document_type'
  ) THEN
    ALTER TABLE documents ALTER COLUMN doc_type TYPE TEXT USING doc_type::text;
  END IF;
END $$;

DROP TYPE IF EXISTS document_type;
