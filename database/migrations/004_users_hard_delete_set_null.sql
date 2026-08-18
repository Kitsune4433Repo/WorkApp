-- Lets an admin permanently delete a user account (not just deactivate it). Every column below was
-- a "who did this" attribution FK to users(id) with no ON DELETE clause (default: block the delete),
-- several NOT NULL — so deleting a user who had ever created a job, sent a chat message, uploaded a
-- document, etc. would fail with a foreign-key violation. Content the user created stays; only the
-- attribution becomes NULL ("deleted user"). Purely personal rows that are meaningless without their
-- owner (timecards, truck inventory, device tokens, crew membership, job assignments, location
-- pings) already CASCADE and are untouched here — deleting the user removes those along with them.
-- Safe to run repeatedly: DROP NOT NULL on an already-nullable column is a no-op, and dropping +
-- recreating a same-named FK constraint is idempotent. Backend/src/db/bootstrap.ts runs this
-- automatically on every boot, so a live deploy self-heals without manual intervention.

ALTER TABLE jobs ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_created_by_fkey;
ALTER TABLE jobs ADD CONSTRAINT jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE job_assignments ALTER COLUMN assigned_by DROP NOT NULL;
ALTER TABLE job_assignments DROP CONSTRAINT IF EXISTS job_assignments_assigned_by_fkey;
ALTER TABLE job_assignments ADD CONSTRAINT job_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE material_catalog DROP CONSTRAINT IF EXISTS material_catalog_created_by_fkey;
ALTER TABLE material_catalog ADD CONSTRAINT material_catalog_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_from_user_id_fkey;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_to_user_id_fkey;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE qr_transfers ALTER COLUMN from_user_id DROP NOT NULL;
ALTER TABLE qr_transfers DROP CONSTRAINT IF EXISTS qr_transfers_from_user_id_fkey;
ALTER TABLE qr_transfers ADD CONSTRAINT qr_transfers_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE qr_transfers DROP CONSTRAINT IF EXISTS qr_transfers_to_user_id_fkey;
ALTER TABLE qr_transfers ADD CONSTRAINT qr_transfers_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE chat_channels ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE chat_channels DROP CONSTRAINT IF EXISTS chat_channels_created_by_fkey;
ALTER TABLE chat_channels ADD CONSTRAINT chat_channels_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE chat_messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_sender_id_fkey;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE documents ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_uploaded_by_fkey;
ALTER TABLE documents ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE document_versions ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS document_versions_uploaded_by_fkey;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE map_annotations ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE map_annotations DROP CONSTRAINT IF EXISTS map_annotations_created_by_fkey;
ALTER TABLE map_annotations ADD CONSTRAINT map_annotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE knowledge_base_articles ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE knowledge_base_articles DROP CONSTRAINT IF EXISTS knowledge_base_articles_created_by_fkey;
ALTER TABLE knowledge_base_articles ADD CONSTRAINT knowledge_base_articles_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE photo_proofs ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE photo_proofs DROP CONSTRAINT IF EXISTS photo_proofs_uploaded_by_fkey;
ALTER TABLE photo_proofs ADD CONSTRAINT photo_proofs_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE sync_conflicts DROP CONSTRAINT IF EXISTS sync_conflicts_user_id_fkey;
ALTER TABLE sync_conflicts ADD CONSTRAINT sync_conflicts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sync_conflicts DROP CONSTRAINT IF EXISTS sync_conflicts_resolved_by_fkey;
ALTER TABLE sync_conflicts ADD CONSTRAINT sync_conflicts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
