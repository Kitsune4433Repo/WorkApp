import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { sendPushToUsers } from '../services/pushNotificationService';
import { polygonToWkt } from '../services/geofenceService';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

const pointSchema = z.object({ lat: z.number(), lng: z.number() });
const polygonSchema = z.array(pointSchema).min(3);

const createJobSchema = z.object({
  jobNumber: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'emergency']).default('normal'),
  siteAddress: z.string().optional(),
  siteLocation: pointSchema,
  geofencePolygon: polygonSchema.optional(),
  geofenceRadiusM: z.number().int().positive().optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  crewId: z.string().uuid().optional(),
  assigneeUserIds: z.array(z.string().uuid()).default([]),
});

jobsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE j.status = $${params.length}`;
    } else if (req.user!.role === 'technician' || req.user!.role === 'crew_lead') {
      // Field roles only see jobs assigned to them by default.
      params.push(req.user!.id);
      where = `WHERE EXISTS (SELECT 1 FROM job_assignments a WHERE a.job_id = j.id AND a.user_id = $${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT j.id, j.job_number, j.title, j.status, j.priority,
              ST_Y(j.site_location::geometry) AS lat, ST_X(j.site_location::geometry) AS lng,
              j.scheduled_start, j.scheduled_end, j.crew_id
         FROM jobs j
         ${where}
         ORDER BY j.scheduled_start NULLS LAST`,
      params,
    );
    res.json(rows);
  }),
);

jobsRouter.post(
  '/',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const body = createJobSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO jobs (job_number, title, description, priority, site_address, site_location,
                            geofence, geofence_radius_m, scheduled_start, scheduled_end, created_by, crew_id, status)
         VALUES ($1,$2,$3,$4,$5, ST_GeogFromText($6), ST_GeogFromText($7), $8, $9, $10, $11, $12, 'scheduled')
         RETURNING id`,
        [
          body.jobNumber,
          body.title,
          body.description ?? null,
          body.priority,
          body.siteAddress ?? null,
          `SRID=4326;POINT(${body.siteLocation.lng} ${body.siteLocation.lat})`,
          body.geofencePolygon ? polygonToWkt(body.geofencePolygon) : null,
          body.geofenceRadiusM ?? Number(process.env.GEOFENCE_DEFAULT_RADIUS_M ?? 75),
          body.scheduledStart ?? null,
          body.scheduledEnd ?? null,
          req.user!.id,
          body.crewId ?? null,
        ],
      );
      const jobId = rows[0].id;

      for (const userId of body.assigneeUserIds) {
        await client.query(
          `INSERT INTO job_assignments (job_id, user_id, assigned_by) VALUES ($1, $2, $3)`,
          [jobId, userId, req.user!.id],
        );
      }
      await client.query('COMMIT');

      if (body.assigneeUserIds.length) {
        await sendPushToUsers(body.assigneeUserIds, {
          title: 'New job dispatched',
          body: `${body.title} (${body.jobNumber})`,
          data: { jobId, type: 'job_dispatch' },
        });
      }
      res.status(201).json({ id: jobId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

jobsRouter.post(
  '/:jobId/dispatch',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const { rows } = await pool.query(
      `UPDATE jobs SET status = 'dispatched', dispatched_at = now(), updated_at = now() WHERE id = $1 RETURNING id`,
      [jobId],
    );
    if (!rows.length) throw new ApiError(404, 'job_not_found');

    const { rows: assignees } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM job_assignments WHERE job_id = $1`,
      [jobId],
    );
    await sendPushToUsers(assignees.map((a) => a.user_id), {
      title: 'Job dispatched',
      body: 'A job on your schedule has been dispatched.',
      data: { jobId, type: 'job_dispatch' },
    });
    res.status(204).end();
  }),
);

jobsRouter.patch(
  '/:jobId',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(['draft', 'scheduled', 'dispatched', 'in_progress', 'blocked', 'completed', 'closed', 'cancelled']).optional(),
      scheduledStart: z.string().datetime().optional(),
      scheduledEnd: z.string().datetime().optional(),
      priority: z.enum(['low', 'normal', 'high', 'emergency']).optional(),
    });
    const body = schema.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, col] of [
      ['status', 'status'],
      ['scheduledStart', 'scheduled_start'],
      ['scheduledEnd', 'scheduled_end'],
      ['priority', 'priority'],
    ] as const) {
      const value = (body as Record<string, unknown>)[key];
      if (value !== undefined) {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) throw new ApiError(400, 'no_fields_to_update');
    params.push(req.params.jobId);
    await pool.query(`UPDATE jobs SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
    res.status(204).end();
  }),
);

// Hard delete: every table referencing jobs.id (assignments, materials, timecards, chat, documents,
// photo proofs) already declares ON DELETE CASCADE/SET NULL in schema.sql, so removing a job cleanly
// removes its dependent rows without a foreign-key violation.
jobsRouter.delete(
  '/:jobId',
  requireRole('admin', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`DELETE FROM jobs WHERE id = $1 RETURNING id`, [req.params.jobId]);
    if (!rows.length) throw new ApiError(404, 'job_not_found');
    res.status(204).end();
  }),
);
