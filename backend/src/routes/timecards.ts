import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { isPointInJobGeofence, toGeographyPoint, recordLocationPing } from '../services/geofenceService';
import { detectTamper } from '../services/tamperDetectionService';

export const timecardsRouter = Router();
timecardsRouter.use(requireAuth);

const pointSchema = z.object({ lat: z.number(), lng: z.number() });

const clockInSchema = z.object({
  jobId: z.string().uuid().optional(),
  location: pointSchema,
  deviceTime: z.string().datetime(),
  clientEventId: z.string().uuid(),
  signature: z.string().optional(),
});

timecardsRouter.post(
  '/clock-in',
  asyncHandler(async (req, res) => {
    const body = clockInSchema.parse(req.body);
    const { rows: openCards } = await pool.query(
      `SELECT id FROM timecards WHERE user_id = $1 AND clock_out_at IS NULL`,
      [req.user!.id],
    );
    if (openCards.length) throw new ApiError(409, 'already_clocked_in');

    const { rows: existing } = await pool.query(`SELECT id FROM timecards WHERE client_event_id = $1`, [body.clientEventId]);
    if (existing.length) return res.status(200).json({ id: existing[0].id, idempotent: true });

    const { rows: rateRows } = await pool.query(`SELECT hourly_rate_cents FROM users WHERE id = $1`, [req.user!.id]);
    const inGeofence = body.jobId ? await isPointInJobGeofence(body.jobId, body.location) : null;
    const tamper = detectTamper(new Date(body.deviceTime));

    const { rows } = await pool.query(
      `INSERT INTO timecards
          (user_id, job_id, clock_in_at, clock_in_location, clock_in_in_geofence,
           hourly_rate_cents_snapshot, device_id, tamper_flag, tamper_reason, client_event_id)
       VALUES ($1,$2, now(), ST_GeogFromText($3), $4, $5, $6, $7, $8, $9)
       RETURNING id, clock_in_at`,
      [
        req.user!.id,
        body.jobId ?? null,
        toGeographyPoint(body.location),
        inGeofence,
        rateRows[0].hourly_rate_cents,
        req.deviceId,
        tamper.flagged,
        tamper.reason ?? null,
        body.clientEventId,
      ],
    );
    const timecard = rows[0];

    await pool.query(
      `INSERT INTO timecard_events (timecard_id, event_type, location, in_geofence, device_id, device_time, signature)
       VALUES ($1,'clock_in',ST_GeogFromText($2),$3,$4,$5,$6)`,
      [timecard.id, toGeographyPoint(body.location), inGeofence, req.deviceId, body.deviceTime, body.signature ?? null],
    );

    res.status(201).json({ id: timecard.id, clockInAt: timecard.clock_in_at, inGeofence, tamperFlag: tamper.flagged });
  }),
);

const breakSchema = z.object({ location: pointSchema.optional(), deviceTime: z.string().datetime() });

for (const [path, event, column] of [
  ['break-start', 'break_start', 'break_start_at'],
  ['break-end', 'break_end', 'break_end_at'],
] as const) {
  timecardsRouter.post(
    `/${path}`,
    asyncHandler(async (req, res) => {
      const body = breakSchema.parse(req.body);
      const { rows } = await pool.query(
        `UPDATE timecards SET ${column} = now(), updated_at = now()
          WHERE user_id = $1 AND clock_out_at IS NULL RETURNING id`,
        [req.user!.id],
      );
      if (!rows.length) throw new ApiError(409, 'no_open_timecard');
      if (event === 'break_end') {
        await pool.query(
          `UPDATE timecards SET total_break_minutes = total_break_minutes +
              GREATEST(0, EXTRACT(EPOCH FROM (break_end_at - break_start_at))::INT / 60)
            WHERE id = $1`,
          [rows[0].id],
        );
      }
      await pool.query(
        `INSERT INTO timecard_events (timecard_id, event_type, location, device_id, device_time)
         VALUES ($1,$2,${body.location ? 'ST_GeogFromText($3)' : 'NULL'},$4,$5)`,
        body.location
          ? [rows[0].id, event, toGeographyPoint(body.location), req.deviceId, body.deviceTime]
          : [rows[0].id, event, req.deviceId, body.deviceTime],
      );
      res.status(204).end();
    }),
  );
}

const clockOutSchema = z.object({ location: pointSchema, deviceTime: z.string().datetime(), signature: z.string().optional() });

timecardsRouter.post(
  '/clock-out',
  asyncHandler(async (req, res) => {
    const body = clockOutSchema.parse(req.body);
    const { rows: open } = await pool.query(
      `SELECT id, job_id FROM timecards WHERE user_id = $1 AND clock_out_at IS NULL`,
      [req.user!.id],
    );
    if (!open.length) throw new ApiError(409, 'no_open_timecard');
    const timecard = open[0];

    const inGeofence = timecard.job_id ? await isPointInJobGeofence(timecard.job_id, body.location) : null;
    const tamper = detectTamper(new Date(body.deviceTime));

    const { rows } = await pool.query(
      `UPDATE timecards
          SET clock_out_at = now(), clock_out_location = ST_GeogFromText($2), clock_out_in_geofence = $3,
              tamper_flag = tamper_flag OR $4, tamper_reason = COALESCE(tamper_reason, $5), updated_at = now()
        WHERE id = $1
        RETURNING total_minutes, earnings_cents`,
      [timecard.id, toGeographyPoint(body.location), inGeofence, tamper.flagged, tamper.reason ?? null],
    );

    await pool.query(
      `INSERT INTO timecard_events (timecard_id, event_type, location, in_geofence, device_id, device_time, signature)
       VALUES ($1,'clock_out',ST_GeogFromText($2),$3,$4,$5,$6)`,
      [timecard.id, toGeographyPoint(body.location), inGeofence, req.deviceId, body.deviceTime, body.signature ?? null],
    );

    res.json({ id: timecard.id, totalMinutes: rows[0].total_minutes, earningsCents: rows[0].earnings_cents, inGeofence });
  }),
);

// Money-to-hours calculator: live earnings for the technician's currently open shift (feature 4).
timecardsRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, job_id, clock_in_at, break_start_at, break_end_at, total_break_minutes, hourly_rate_cents_snapshot
         FROM timecards WHERE user_id = $1 AND clock_out_at IS NULL`,
      [req.user!.id],
    );
    if (!rows.length) return res.json(null);
    const tc = rows[0];
    const onBreak = tc.break_start_at && !tc.break_end_at;
    const elapsedMs = Date.now() - new Date(tc.clock_in_at).getTime();
    const activeMinutes = Math.max(0, elapsedMs / 60000 - tc.total_break_minutes);
    const earningsCents = Math.round((activeMinutes / 60) * tc.hourly_rate_cents_snapshot);
    res.json({ ...tc, onBreak, liveActiveMinutes: Math.round(activeMinutes), liveEarningsCents: earningsCents });
  }),
);

timecardsRouter.get(
  '/history/:userId',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, job_id, clock_in_at, clock_out_at, total_minutes, earnings_cents, tamper_flag,
              clock_in_in_geofence, clock_out_in_geofence
         FROM timecards WHERE user_id = $1 ORDER BY clock_in_at DESC LIMIT 100`,
      [req.params.userId],
    );
    res.json(rows);
  }),
);

// Background location pings (feature 3), throttled/batched on-device.
const pingSchema = z.object({
  points: z
    .array(z.object({ location: pointSchema, recordedAt: z.string().datetime(), accuracyM: z.number().optional(), batteryPct: z.number().int().optional() }))
    .min(1)
    .max(500),
  jobId: z.string().uuid().optional(),
});

timecardsRouter.post(
  '/location-pings',
  asyncHandler(async (req, res) => {
    const body = pingSchema.parse(req.body);
    for (const p of body.points) {
      await recordLocationPing({
        userId: req.user!.id,
        jobId: body.jobId,
        point: p.location,
        accuracyM: p.accuracyM,
        recordedAt: new Date(p.recordedAt),
        batteryPct: p.batteryPct,
      });
    }
    res.status(204).end();
  }),
);
