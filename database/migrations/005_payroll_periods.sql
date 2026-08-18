-- Weekly payroll close-out tables (Thu-Wed periods) — see backend/src/services/payrollPeriodService.ts.
-- Safe to run repeatedly: CREATE TABLE IF NOT EXISTS. Backend/src/db/bootstrap.ts runs this
-- automatically on every boot, so a live deploy self-heals without manual intervention.

CREATE TABLE IF NOT EXISTS payroll_periods (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_start       DATE NOT NULL UNIQUE,
    period_end         DATE NOT NULL,
    label              TEXT NOT NULL,
    total_wage_cents   BIGINT NOT NULL,
    finalized_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_period_entries (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id                UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    user_id                  UUID REFERENCES users(id) ON DELETE SET NULL,
    user_full_name_snapshot  TEXT NOT NULL,
    days_worked              INTEGER NOT NULL,
    total_minutes            INTEGER NOT NULL,
    earnings_cents           BIGINT NOT NULL,
    UNIQUE (period_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_period_entries_period ON payroll_period_entries (period_id);
