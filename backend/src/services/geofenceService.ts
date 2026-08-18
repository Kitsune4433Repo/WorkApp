import { pool } from '../config/database';

export interface LatLng {
  lat: number;
  lng: number;
}

export function toGeographyPoint(p: LatLng): string {
  return `SRID=4326;POINT(${p.lng} ${p.lat})`;
}

/** Closes the ring (first point repeated last) and formats as WKT for ST_GeogFromText. Throws on
 * fewer than 3 points — a polygon geofence can't be drawn with less. */
export function polygonToWkt(points: LatLng[]): string {
  if (points.length < 3) throw new Error('polygon_requires_at_least_3_points');
  const ring = [...points, points[0]].map((p) => `${p.lng} ${p.lat}`).join(', ');
  return `SRID=4326;POLYGON((${ring}))`;
}

/**
 * Returns true/false if the job has a geofence configured, or null if no
 * geofence exists (caller decides whether to allow, warn, or block).
 */
export async function isPointInJobGeofence(jobId: string, point: LatLng): Promise<boolean | null> {
  const { rows } = await pool.query<{ in_fence: boolean | null }>(
    `SELECT fn_point_in_job_geofence($1, ST_GeogFromText($2)) AS in_fence`,
    [jobId, toGeographyPoint(point)],
  );
  return rows[0]?.in_fence ?? null;
}

export async function recordLocationPing(params: {
  userId: string;
  jobId?: string | null;
  point: LatLng;
  accuracyM?: number;
  recordedAt: Date;
  batteryPct?: number;
}) {
  await pool.query(
    `INSERT INTO location_pings (user_id, job_id, location, accuracy_m, recorded_at, battery_pct)
     VALUES ($1, $2, ST_GeogFromText($3), $4, $5, $6)`,
    [
      params.userId,
      params.jobId ?? null,
      toGeographyPoint(params.point),
      params.accuracyM ?? null,
      params.recordedAt,
      params.batteryPct ?? null,
    ],
  );
}
