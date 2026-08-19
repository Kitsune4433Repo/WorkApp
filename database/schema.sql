-- ============================================================================
-- Telecommunications Crew Management System
-- PostgreSQL 15+ / PostGIS 3.3+ schema
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE user_role            AS ENUM ('admin', 'crew_lead', 'crew');
CREATE TYPE job_status           AS ENUM ('draft', 'scheduled', 'dispatched', 'in_progress', 'blocked', 'completed', 'closed', 'cancelled');
CREATE TYPE job_priority         AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE inventory_txn_type   AS ENUM ('add', 'subtract', 'transfer_out', 'transfer_in', 'qr_transfer', 'job_consumption', 'stock_correction');
CREATE TYPE timecard_event_type  AS ENUM ('clock_in', 'break_start', 'break_end', 'clock_out');
CREATE TYPE channel_type         AS ENUM ('direct', 'job', 'broadcast');
CREATE TYPE qr_transfer_status   AS ENUM ('pending', 'completed', 'expired', 'cancelled');
CREATE TYPE sync_resolution      AS ENUM ('client_wins', 'server_wins', 'merged', 'admin_review', 'pending');
CREATE TYPE device_platform      AS ENUM ('android', 'ios', 'web');

-- ============================================================================
-- USERS & AUTH
-- ============================================================================

CREATE TABLE users (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email              CITEXT NOT NULL UNIQUE,
    password_hash      TEXT NOT NULL,
    full_name          TEXT NOT NULL,
    phone              TEXT,
    role               user_role NOT NULL DEFAULT 'crew',
    hourly_rate_cents  INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate_cents >= 0),
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crews (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name               TEXT NOT NULL,
    crew_lead_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crew_members (
    crew_id            UUID NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (crew_id, user_id)
);

CREATE TABLE device_tokens (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id          TEXT NOT NULL,
    push_token         TEXT NOT NULL,
    platform           device_platform NOT NULL,
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id)
);

-- ============================================================================
-- JOBS / DISPATCH / GEOFENCING
-- ============================================================================

CREATE TABLE jobs (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_number         TEXT NOT NULL UNIQUE,
    title              TEXT NOT NULL,
    description        TEXT,
    status             job_status NOT NULL DEFAULT 'draft',
    priority           job_priority NOT NULL DEFAULT 'medium',
    site_address       TEXT,
    site_location      GEOGRAPHY(POINT, 4326) NOT NULL,
    -- Geofence perimeter around the job site; clock-in/out is validated with ST_Covers/ST_DWithin against this.
    geofence           GEOGRAPHY(POLYGON, 4326),
    geofence_radius_m  INTEGER, -- fallback circular geofence when no polygon is drawn
    scheduled_start    TIMESTAMPTZ,
    scheduled_end      TIMESTAMPTZ,
    -- Weekly recurrence: when set, the job repeats every week on these days (0=Sunday..6=Saturday) at
    -- the given time-of-day, instead of (or in addition to) the one-off scheduled_start/scheduled_end.
    recurring_days_of_week SMALLINT[],
    recurring_start_time   TIME,
    recurring_end_time     TIME,
    recurring_until        DATE,
    dispatched_at      TIMESTAMPTZ,
    started_at         TIMESTAMPTZ,
    stopped_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    closed_at          TIMESTAMPTZ,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    crew_id            UUID REFERENCES crews(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_site_location ON jobs USING GIST (site_location);
CREATE INDEX idx_jobs_geofence      ON jobs USING GIST (geofence);
CREATE INDEX idx_jobs_status        ON jobs (status);
CREATE INDEX idx_jobs_crew          ON jobs (crew_id);

CREATE TABLE job_assignments (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at    TIMESTAMPTZ,
    UNIQUE (job_id, user_id)
);
CREATE INDEX idx_job_assignments_user ON job_assignments (user_id);

-- Live/background location pings from Android field devices during work hours.
CREATE TABLE location_pings (
    id                 BIGSERIAL PRIMARY KEY,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id             UUID REFERENCES jobs(id) ON DELETE SET NULL,
    location           GEOGRAPHY(POINT, 4326) NOT NULL,
    accuracy_m         REAL,
    recorded_at        TIMESTAMPTZ NOT NULL,
    received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    battery_pct        SMALLINT
);
CREATE INDEX idx_location_pings_user_time ON location_pings (user_id, recorded_at DESC);
CREATE INDEX idx_location_pings_geo       ON location_pings USING GIST (location);
-- Partition candidate: monthly range partition on recorded_at once volume grows.

-- ============================================================================
-- WORK MATERIAL MANAGEMENT (Inventory)
-- ============================================================================

CREATE TABLE material_catalog (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku                TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    category           TEXT NOT NULL,
    unit               TEXT NOT NULL DEFAULT 'ea',
    description        TEXT,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_material_catalog_name_trgm ON material_catalog USING GIN (name gin_trgm_ops);

-- Per-truck/per-technician "have" ledger. version supports optimistic offline sync.
CREATE TABLE truck_inventory (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    material_id        UUID NOT NULL REFERENCES material_catalog(id),
    quantity_have      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity_have >= 0),
    version            BIGINT NOT NULL DEFAULT 1,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, material_id)
);

-- "Need" ledger: materials required for an upcoming job.
CREATE TABLE job_required_materials (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    material_id        UUID NOT NULL REFERENCES material_catalog(id),
    quantity_needed    NUMERIC(12,2) NOT NULL CHECK (quantity_needed >= 0),
    quantity_staged    NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, material_id)
);

-- "Out of Inventory" list: materials to buy or replace — not tied to a job (unlike
-- job_required_materials above) and not per-technician (unlike truck_inventory) — just a shared
-- running list anyone can add to, adjust, or clear once restocked.
CREATE TABLE restock_requests (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id        UUID REFERENCES material_catalog(id) ON DELETE SET NULL,
    item_name          TEXT NOT NULL, -- snapshot so the row still reads fine if the catalog link is cleared
    unit               TEXT NOT NULL DEFAULT 'unit',
    quantity_needed    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity_needed >= 0),
    note               TEXT,
    requested_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only ledger of every +/- and transfer; truck_inventory is a materialized aggregate of this.
CREATE TABLE inventory_transactions (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id        UUID NOT NULL REFERENCES material_catalog(id),
    type               inventory_txn_type NOT NULL,
    quantity            NUMERIC(12,2) NOT NULL,
    from_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    to_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    job_id             UUID REFERENCES jobs(id) ON DELETE SET NULL,
    client_txn_id      UUID NOT NULL, -- idempotency key generated on-device for offline dedup
    device_id          TEXT,
    occurred_at        TIMESTAMPTZ NOT NULL,
    synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_txn_id)
);
CREATE INDEX idx_inventory_txn_material ON inventory_transactions (material_id, occurred_at DESC);
CREATE INDEX idx_inventory_txn_users    ON inventory_transactions (from_user_id, to_user_id);

-- QR peer-to-peer transfer handshake records (feature 12).
CREATE TABLE qr_transfers (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    to_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    material_id        UUID NOT NULL REFERENCES material_catalog(id),
    quantity           NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    qr_payload_token   TEXT NOT NULL UNIQUE, -- signed short-lived token embedded in the QR code
    status             qr_transfer_status NOT NULL DEFAULT 'pending',
    expires_at         TIMESTAMPTZ NOT NULL,
    completed_txn_id   UUID REFERENCES inventory_transactions(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at       TIMESTAMPTZ
);

-- ============================================================================
-- WORK TIMES / CLOCK IN / EARNINGS
-- ============================================================================

CREATE TABLE timecards (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id                 UUID REFERENCES jobs(id) ON DELETE SET NULL,
    clock_in_at            TIMESTAMPTZ NOT NULL,
    clock_in_location      GEOGRAPHY(POINT, 4326),
    clock_in_in_geofence   BOOLEAN,
    break_start_at         TIMESTAMPTZ,
    break_end_at           TIMESTAMPTZ,
    clock_out_at           TIMESTAMPTZ,
    clock_out_location     GEOGRAPHY(POINT, 4326),
    clock_out_in_geofence  BOOLEAN,
    hourly_rate_cents_snapshot INTEGER NOT NULL,
    total_break_minutes    INTEGER NOT NULL DEFAULT 0,
    total_minutes          INTEGER GENERATED ALWAYS AS (
                               CASE WHEN clock_out_at IS NOT NULL
                                    THEN GREATEST(0, EXTRACT(EPOCH FROM (clock_out_at - clock_in_at))::INT / 60 - total_break_minutes)
                                    ELSE NULL END
                           ) STORED,
    earnings_cents          INTEGER GENERATED ALWAYS AS (
                               CASE WHEN clock_out_at IS NOT NULL
                                    THEN ROUND(
                                        (GREATEST(0, EXTRACT(EPOCH FROM (clock_out_at - clock_in_at))::NUMERIC / 60 - total_break_minutes)
                                         / 60.0) * hourly_rate_cents_snapshot
                                    )::INTEGER
                                    ELSE NULL END
                           ) STORED,
    device_id              TEXT NOT NULL,
    tamper_flag            BOOLEAN NOT NULL DEFAULT FALSE,
    tamper_reason          TEXT,
    client_event_id        UUID NOT NULL UNIQUE, -- offline idempotency key
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_timecards_user_time ON timecards (user_id, clock_in_at DESC);
CREATE INDEX idx_timecards_job       ON timecards (job_id);

-- Raw immutable event stream backing timecards; used for tamper audit trail.
CREATE TABLE timecard_events (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timecard_id        UUID NOT NULL REFERENCES timecards(id) ON DELETE CASCADE,
    event_type         timecard_event_type NOT NULL,
    location            GEOGRAPHY(POINT, 4326),
    in_geofence        BOOLEAN,
    device_id          TEXT NOT NULL,
    device_time        TIMESTAMPTZ NOT NULL, -- device clock at capture, for tamper cross-check
    server_time        TIMESTAMPTZ NOT NULL DEFAULT now(),
    signature          TEXT, -- HMAC of (device_id|event_type|device_time|lat|lon) signed on-device
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_timecard_events_timecard ON timecard_events (timecard_id);

-- Weekly payroll close-out (Thu-Wed periods, see backend/src/services/payrollPeriodService.ts).
-- One row per finalized week, plus one entries row per person who worked that week, archived under
-- a human date-range label like "August 13th-19th". user_id is nullable/SET NULL (not CASCADE) so a
-- later account deletion doesn't erase payroll history — user_full_name_snapshot keeps the name.
CREATE TABLE payroll_periods (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_start       DATE NOT NULL UNIQUE, -- Thursday
    period_end         DATE NOT NULL, -- Wednesday (inclusive)
    label              TEXT NOT NULL, -- e.g. "August 13th-19th"
    total_wage_cents   BIGINT NOT NULL,
    finalized_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payroll_period_entries (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id                UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    user_id                  UUID REFERENCES users(id) ON DELETE SET NULL,
    user_full_name_snapshot  TEXT NOT NULL,
    days_worked              INTEGER NOT NULL,
    total_minutes            INTEGER NOT NULL,
    earnings_cents           BIGINT NOT NULL,
    UNIQUE (period_id, user_id)
);
CREATE INDEX idx_payroll_period_entries_period ON payroll_period_entries (period_id);

-- ============================================================================
-- REAL-TIME MESSAGING
-- ============================================================================

CREATE TABLE chat_channels (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type               channel_type NOT NULL,
    name               TEXT,
    job_id             UUID REFERENCES jobs(id) ON DELETE CASCADE,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_channel_members (
    channel_id         UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at       TIMESTAMPTZ,
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE chat_messages (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id         UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    sender_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    body               TEXT,
    attachment_url     TEXT,
    client_msg_id      UUID NOT NULL, -- offline dedup key
    sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_by            JSONB NOT NULL DEFAULT '{}'::JSONB, -- {user_id: read_at}
    UNIQUE (channel_id, client_msg_id)
);
CREATE INDEX idx_chat_messages_channel_time ON chat_messages (channel_id, sent_at DESC);

-- ============================================================================
-- DOCUMENT / MAP LIBRARY, VERSIONING & ANNOTATIONS
-- ============================================================================

CREATE TABLE documents (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title              TEXT NOT NULL,
    doc_type           TEXT NOT NULL, -- file extension or MIME type; free-form, any file type is allowed
    category           TEXT,
    description        TEXT, -- free-form notes, e.g. a color legend for an annotated map/photo
    job_id             UUID REFERENCES jobs(id) ON DELETE SET NULL,
    current_version    INTEGER NOT NULL DEFAULT 1,
    is_map             BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_job ON documents (job_id);

CREATE TABLE document_versions (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number     INTEGER NOT NULL,
    file_url           TEXT NOT NULL, -- object storage key (S3/GCS/MinIO)
    file_size_bytes    BIGINT,
    checksum_sha256    TEXT NOT NULL,
    uploaded_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    change_note        TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, version_number)
);

-- Freehand redline/highlight overlays drawn on a map document, offline-editable.
CREATE TABLE map_annotations (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    document_version   INTEGER NOT NULL,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    layer_data         JSONB NOT NULL, -- vector paths: [{type, points[], color, width, ts}]
    version            BIGINT NOT NULL DEFAULT 1, -- lamport/local version for conflict detection
    client_id          TEXT NOT NULL, -- originating device
    is_conflicted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_map_annotations_document ON map_annotations (document_id, document_version);

-- ============================================================================
-- KNOWLEDGE BASE
-- ============================================================================

CREATE TABLE knowledge_base_articles (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title              TEXT NOT NULL,
    content            TEXT NOT NULL,
    category           TEXT NOT NULL,
    tags               TEXT[] NOT NULL DEFAULT '{}',
    document_id        UUID REFERENCES documents(id) ON DELETE SET NULL,
    search_vector      TSVECTOR GENERATED ALWAYS AS (
                           setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                           setweight(to_tsvector('english', coalesce(content, '')), 'B')
                       ) STORED,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_search_vector ON knowledge_base_articles USING GIN (search_vector);
CREATE INDEX idx_kb_tags          ON knowledge_base_articles USING GIN (tags);

-- ============================================================================
-- PHOTO PROOF (JOB CLOSEOUT)
-- ============================================================================

CREATE TABLE photo_proofs (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    uploaded_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    file_url           TEXT NOT NULL,
    thumbnail_url      TEXT,
    original_size_bytes   BIGINT,
    compressed_size_bytes BIGINT,
    taken_at           TIMESTAMPTZ NOT NULL,
    location           GEOGRAPHY(POINT, 4326),
    client_photo_id    UUID NOT NULL UNIQUE, -- offline dedup
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_photo_proofs_job ON photo_proofs (job_id);

-- ============================================================================
-- OFFLINE SYNC / CONFLICT RESOLUTION
-- ============================================================================

-- Generic conflict register for any syncable entity (inventory, map_annotations, timecards...).
CREATE TABLE sync_conflicts (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type        TEXT NOT NULL, -- 'truck_inventory' | 'map_annotations' | 'job_required_materials' | ...
    entity_id          UUID NOT NULL,
    device_id          TEXT NOT NULL,
    user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
    client_payload     JSONB NOT NULL,
    server_payload     JSONB NOT NULL,
    client_version     BIGINT NOT NULL,
    server_version     BIGINT NOT NULL,
    resolution         sync_resolution NOT NULL DEFAULT 'pending',
    resolved_payload   JSONB,
    resolved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at        TIMESTAMPTZ
);
CREATE INDEX idx_sync_conflicts_entity  ON sync_conflicts (entity_type, entity_id);
CREATE INDEX idx_sync_conflicts_pending ON sync_conflicts (resolution) WHERE resolution = 'pending';

-- Per-device sync checkpoint cursor for incremental pull sync.
CREATE TABLE sync_checkpoints (
    device_id          TEXT NOT NULL,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type        TEXT NOT NULL,
    last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
    PRIMARY KEY (device_id, entity_type)
);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

CREATE TABLE audit_log (
    id                 BIGSERIAL PRIMARY KEY,
    actor_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    action             TEXT NOT NULL,
    entity_type        TEXT NOT NULL,
    entity_id          TEXT,
    metadata           JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);

-- ============================================================================
-- HELPER: geofence containment check (used by backend clock-in validation)
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_point_in_job_geofence(p_job_id UUID, p_point GEOGRAPHY)
RETURNS BOOLEAN AS $$
DECLARE
    v_geofence GEOGRAPHY(POLYGON, 4326);
    v_radius   INTEGER;
    v_site     GEOGRAPHY(POINT, 4326);
BEGIN
    SELECT geofence, geofence_radius_m, site_location
      INTO v_geofence, v_radius, v_site
      FROM jobs WHERE id = p_job_id;

    IF v_geofence IS NOT NULL THEN
        RETURN ST_Covers(v_geofence::geometry, p_point::geometry);
    ELSIF v_radius IS NOT NULL THEN
        RETURN ST_DWithin(v_site, p_point, v_radius);
    ELSE
        RETURN NULL; -- no geofence configured; caller decides fallback policy
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;
