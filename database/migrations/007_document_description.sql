-- Free-text notes on a resource — e.g. a color legend for an annotated map/photo. Safe to run
-- repeatedly: ADD COLUMN IF NOT EXISTS. Backend/src/db/bootstrap.ts runs this automatically on
-- every boot, so a live deploy self-heals without manual intervention.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS description TEXT;
