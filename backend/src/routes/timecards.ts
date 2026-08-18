import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { isPointInJobGeofence, toGeographyPoint, recordLocationPing } from '../services/geofenceService';
import { detectTamper } from '../services/tamperDetectionService';
import { getPayrollPeriodContaining, computePeriodTotals } from '../services/payrollPeriodService';

const PAYROLL_VIEW_ROLES = ['admin', 'dispatcher', 'crew_lead'] as const;

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
    // Anyone can pull their own history; seeing someone else's requires an elevated role.
    if (req.params.userId !== req.user!.id && !(PAYROLL_VIEW_ROLES as readonly string[]).includes(req.user!.role)) {
      throw new ApiError(403, 'forbidden');
    }
    const { rows } = await pool.query(
      `SELECT t.id, t.job_id, t.clock_in_at, t.clock_out_at, t.total_minutes, t.earnings_cents, t.tamper_flag,
              t.clock_in_in_geofence, t.clock_out_in_geofence, u.full_name
         FROM timecards t JOIN users u ON u.id = t.user_id
        WHERE t.user_id = $1 ORDER BY t.clock_in_at DESC LIMIT 100`,
      [req.params.userId],
    );
    res.json(rows);
  }),
);

// Lets an admin clear out mistaken/test entries (own or anyone's) — hard delete, since a timecard
// has no soft-delete concept and this is meant for cleaning up bad data, not an audit-preserving action.
timecardsRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`DELETE FROM timecards WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows.length) throw new ApiError(404, 'timecard_not_found');
    res.status(204).end();
  }),
);

// Live totals for the payroll week currently in progress — days worked, hours, and earnings per
// person, plus the total wage cost across everyone. Only counts completed (clocked-out) shifts, same
// rule the Wednesday-11pm close-out uses, so this view and the archived one stay consistent.
timecardsRouter.get(
  '/weekly-summary',
  requireRole(...PAYROLL_VIEW_ROLES),
  asyncHandler(async (_req, res) => {
    const period = getPayrollPeriodContaining();
    const { people, totalWageCents } = await computePeriodTotals(period);
    res.json({
      periodStart: period.startYMD,
      periodEnd: period.endYMD,
      label: period.label,
      people,
      totalWageCents,
    });
  }),
);

// Clears a person's entry from the current, still-in-progress week (which isn't in payroll_periods
// yet — it's computed live from timecards) by deleting their timecards within this week's range.
timecardsRouter.delete(
  '/weekly-summary/:userId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const period = getPayrollPeriodContaining();
    await pool.query(`DELETE FROM timecards WHERE user_id = $1 AND clock_in_at >= $2 AND clock_in_at < $3`, [
      req.params.userId,
      period.start.toISOString(),
      period.end.toISOString(),
    ]);
    res.status(204).end();
  }),
);

timecardsRouter.get(
  '/payroll-periods',
  requireRole(...PAYROLL_VIEW_ROLES),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, period_start, period_end, label, total_wage_cents, finalized_at
         FROM payroll_periods ORDER BY period_start DESC LIMIT 52`,
    );
    res.json(rows);
  }),
);

timecardsRouter.get(
  '/payroll-periods/:id',
  requireRole(...PAYROLL_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const { rows: periodRows } = await pool.query(
      `SELECT id, period_start, period_end, label, total_wage_cents, finalized_at FROM payroll_periods WHERE id = $1`,
      [req.params.id],
    );
    if (!periodRows.length) throw new ApiError(404, 'payroll_period_not_found');
    const { rows: entryRows } = await pool.query(
      `SELECT user_id, user_full_name_snapshot, days_worked, total_minutes, earnings_cents
         FROM payroll_period_entries WHERE period_id = $1 ORDER BY user_full_name_snapshot`,
      [req.params.id],
    );
    res.json({ ...periodRows[0], people: entryRows });
  }),
);

// If the underlying timecards for this week are still around and the week falls within the
// self-heal lookback (the last ~12 weeks), the automatic close-out will simply recompute and
// re-archive it next time it runs — delete the timecards first (or wait past the lookback window)
// for this to stick.
timecardsRouter.delete(
  '/payroll-periods/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`DELETE FROM payroll_periods WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows.length) throw new ApiError(404, 'payroll_period_not_found');
    res.status(204).end();
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
