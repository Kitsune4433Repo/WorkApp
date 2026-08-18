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

// Resolves relative to the repo root regardless of whether this runs from ts-node (backend/src)
// or compiled output (backend/dist) — both are one level below backend/, which sits next to database/.
function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), '..', relativePath), 'utf8');
}
