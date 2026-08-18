-- Renames job_priority's 'normal'/'emergency' labels to 'medium'/'urgent' (same underlying values,
-- so existing rows keep their meaning), and adds columns for weekly recurring schedules and
-- explicit start/stop timestamps. Safe to run repeatedly. Backend/src/db/bootstrap.ts runs this
-- automatically on every boot, so a live deploy self-heals without manual intervention.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'job_priority'::regtype AND enumlabel = 'normal') THEN
    ALTER TYPE job_priority RENAME VALUE 'normal' TO 'medium';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'job_priority'::regtype AND enumlabel = 'emergency') THEN
    ALTER TYPE job_priority RENAME VALUE 'emergency' TO 'urgent';
  END IF;
END $$;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurring_days_of_week SMALLINT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurring_start_time   TIME;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurring_end_time     TIME;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurring_until        DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at             TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stopped_at             TIMESTAMPTZ;
