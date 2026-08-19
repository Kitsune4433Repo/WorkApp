-- Simplifies the role system to admin / crew_lead / crew: renames 'technician' to 'crew', and
-- folds 'dispatcher' into 'crew_lead' (its permissions were already a subset of crew_lead's
-- almost everywhere). Safe to run repeatedly — guarded so a rename that already happened, or a
-- reassignment with nothing left to reassign, is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'technician' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role RENAME VALUE 'technician' TO 'crew';
  END IF;
END $$;

UPDATE users SET role = 'crew_lead' WHERE role = 'dispatcher';

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'crew';
