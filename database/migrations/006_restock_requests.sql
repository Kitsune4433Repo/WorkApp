-- "Out of Inventory" list — materials to buy or replace. Safe to run repeatedly: CREATE TABLE IF NOT
-- EXISTS. Backend/src/db/bootstrap.ts runs this automatically on every boot, so a live deploy
-- self-heals without manual intervention.
CREATE TABLE IF NOT EXISTS restock_requests (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id        UUID REFERENCES material_catalog(id) ON DELETE SET NULL,
    item_name          TEXT NOT NULL,
    unit               TEXT NOT NULL DEFAULT 'unit',
    quantity_needed    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity_needed >= 0),
    note               TEXT,
    requested_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
