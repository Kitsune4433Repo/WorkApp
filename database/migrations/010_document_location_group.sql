-- Lets multiple files uploaded together (e.g. several photos of the same site) be visually grouped
-- in the Resource Library as "the same location" instead of appearing as unrelated entries. NULL for
-- every document uploaded solo (the common case) — grouping is purely a multi-file-upload artifact.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS location_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_documents_location_group ON documents (location_group_id);
