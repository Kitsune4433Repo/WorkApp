import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';

export const syncRouter = Router();
syncRouter.use(requireAuth);

// Full field set the Android/web clients cache locally for offline use. geofence_points is the
// polygon's exterior ring flattened to [{lat,lng}, ...] (ST_DumpPoints) so devices don't need a
// GeoJSON parser just to run the on-device GeofenceEvaluator fallback.
const JOBS_PULL_QUERY = `
  SELECT j.id, j.job_number, j.title, j.description, j.status, j.priority,
         ST_Y(j.site_location::geometry) AS lat, ST_X(j.site_location::geometry) AS lng,
         j.geofence_radius_m,
         (SELECT json_agg(json_build_object('lat', ST_Y(pt.geom), 'lng', ST_X(pt.geom)) ORDER BY pt.path)
            FROM ST_DumpPoints(j.geofence::geometry) AS pt) AS geofence_points,
         j.scheduled_start, j.scheduled_end, j.updated_at
    FROM jobs j
   WHERE j.updated_at > $1`;

const ENTITY_QUERIES: Record<string, string> = {
  material_catalog: `SELECT id, sku, name, category, unit, created_at AS updated_at FROM material_catalog WHERE created_at > $1 ORDER BY created_at`,
  truck_inventory: `SELECT id, user_id, material_id, quantity_have, version, updated_at FROM truck_inventory WHERE updated_at > $1 ORDER BY updated_at`,
  documents: `SELECT id, title, doc_type, current_version, updated_at FROM documents WHERE updated_at > $1 ORDER BY updated_at`,
  knowledge_base_articles: `SELECT id, title, category, updated_at FROM knowledge_base_articles WHERE updated_at > $1 ORDER BY updated_at`,
};

const PULLABLE_ENTITY_TYPES = new Set([...Object.keys(ENTITY_QUERIES), 'jobs']);

// Incremental pull sync: device requests everything changed since its last checkpoint per entity type.
syncRouter.get(
  '/pull/:entityType',
  asyncHandler(async (req, res) => {
    const { entityType } = req.params;
    if (!PULLABLE_ENTITY_TYPES.has(entityType)) throw new ApiError(400, 'unknown_entity_type');

    const deviceId = req.deviceId!;
    const { rows: cp } = await pool.query(
      `SELECT last_synced_at FROM sync_checkpoints WHERE device_id = $1 AND entity_type = $2`,
      [deviceId, entityType],
    );
    const since = cp[0]?.last_synced_at ?? new Date(0);

    let rows: unknown[];
    if (entityType === 'jobs') {
      // Field roles only pull jobs assigned to them; office roles see the full changed set.
      const isFieldRole = req.user!.role === 'technician' || req.user!.role === 'crew_lead';
      const params: unknown[] = [since];
      let assignmentFilter = '';
      if (isFieldRole) {
        params.push(req.user!.id);
        assignmentFilter = `AND EXISTS (SELECT 1 FROM job_assignments a WHERE a.job_id = j.id AND a.user_id = $${params.length})`;
      }
      ({ rows } = await pool.query(`${JOBS_PULL_QUERY} ${assignmentFilter} ORDER BY j.updated_at`, params));
    } else {
      ({ rows } = await pool.query(ENTITY_QUERIES[entityType], [since]));
    }
    const now = new Date();

    await pool.query(
      `INSERT INTO sync_checkpoints (device_id, user_id, entity_type, last_synced_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (device_id, entity_type) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at`,
      [deviceId, req.user!.id, entityType, now],
    );

    res.json({ entityType, since, records: rows, syncedAt: now });
  }),
);

// Admin review queue for flagged offline-merge conflicts (feature 9).
syncRouter.get(
  '/conflicts',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, entity_type, entity_id, device_id, user_id, client_payload, server_payload,
              client_version, server_version, created_at
         FROM sync_conflicts WHERE resolution = 'pending' ORDER BY created_at`,
    );
    res.json(rows);
  }),
);

const resolveSchema = z.object({ resolution: z.enum(['client_wins', 'server_wins', 'merged']), resolvedPayload: z.any().optional() });

syncRouter.post(
  '/conflicts/:id/resolve',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const body = resolveSchema.parse(req.body);
    const { rows } = await pool.query(`SELECT * FROM sync_conflicts WHERE id = $1`, [req.params.id]);
    const conflict = rows[0];
    if (!conflict) throw new ApiError(404, 'conflict_not_found');

    const payload = body.resolution === 'client_wins' ? conflict.client_payload
      : body.resolution === 'server_wins' ? conflict.server_payload
      : body.resolvedPayload;

    if (conflict.entity_type === 'map_annotations') {
      await pool.query(
        `UPDATE map_annotations SET layer_data = $2, is_conflicted = FALSE, updated_at = now() WHERE id = $1`,
        [conflict.entity_id, JSON.stringify(payload)],
      );
    }

    await pool.query(
      `UPDATE sync_conflicts SET resolution = $2, resolved_payload = $3, resolved_by = $4, resolved_at = now() WHERE id = $1`,
      [req.params.id, body.resolution, JSON.stringify(payload), req.user!.id],
    );
    res.status(204).end();
  }),
);
