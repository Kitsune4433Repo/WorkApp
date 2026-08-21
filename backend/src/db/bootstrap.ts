import fs from 'fs';
import path from 'path';
import { pool } from '../config/database';

/**
 * Applies schema.sql (and optionally seed.sql) on startup when the database is empty, so a fresh
 * cloud deploy (e.g. a Render Blueprint with a brand-new managed Postgres) needs no manual
 * migration step. Gated behind explicit env vars and OFF by default — auto-applying schema/seed
 * data is a demo/first-deploy convenience, not something a real production database should do
 * silently on every boot.
 */
export async function bootstrapDatabaseIfNeeded(): Promise<void> {
  if (process.env.AUTO_MIGRATE !== 'true') return;

  const { rows } = await pool.query<{ exists: string | null }>(`SELECT to_regclass('public.users') AS exists`);
  if (rows[0].exists) return; // schema already present

  console.log('[bootstrap] No schema detected — applying database/schema.sql...');
  await pool.query(readRepoFile('database/schema.sql'));
  console.log('[bootstrap] Schema applied.');

  if (process.env.SEED_DEMO_DATA === 'true') {
    console.log('[bootstrap] SEED_DEMO_DATA=true — applying database/seed.sql (demo accounts, all password "password123")...');
    await pool.query(readRepoFile('database/seed.sql'));
    console.log('[bootstrap] Seed data applied.');
  }
}

// Small, individually-guarded/idempotent schema fixes that a *running* deployment needs to pick up
// even though its database already exists (so bootstrapDatabaseIfNeeded's "only touch an empty
// DB" gate doesn't apply). Unlike that function, this always runs — each migration is written to
// safely no-op once already applied, so this is what makes an already-live deploy self-heal on its
// next boot after a schema-affecting code change, without anyone needing shell access to run
// `psql -f` by hand.
const INCREMENTAL_MIGRATIONS = [
  'database/migrations/002_documents_free_text_doctype.sql',
  'database/migrations/003_job_priority_recurrence_start_stop.sql',
  'database/migrations/004_users_hard_delete_set_null.sql',
  'database/migrations/005_payroll_periods.sql',
  'database/migrations/006_restock_requests.sql',
  'database/migrations/007_document_description.sql',
  'database/migrations/008_consolidate_roles.sql',
  'database/migrations/009_reset_stale_sync_checkpoints.sql',
  'database/migrations/010_document_location_group.sql',
];

export async function applyIncrementalMigrations(): Promise<void> {
  for (const relativePath of INCREMENTAL_MIGRATIONS) {
    await pool.query(readRepoFile(relativePath));
  }
}

// Resolves relative to the repo root regardless of whether this runs from ts-node (backend/src)
// or compiled output (backend/dist) — both are one level below backend/, which sits next to database/.
function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), '..', relativePath), 'utf8');
}
