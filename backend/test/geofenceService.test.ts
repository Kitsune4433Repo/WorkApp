import { describe, expect, it, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../src/config/database', () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

import { isPointInJobGeofence, polygonToWkt, toGeographyPoint } from '../src/services/geofenceService';

describe('toGeographyPoint', () => {
  it('formats lng before lat, per WKT POINT convention', () => {
    expect(toGeographyPoint({ lat: 44.9778, lng: -93.265 })).toBe('SRID=4326;POINT(-93.265 44.9778)');
  });
});

describe('polygonToWkt', () => {
  it('closes the ring by repeating the first point', () => {
    const wkt = polygonToWkt([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
    ]);
    expect(wkt).toBe('SRID=4326;POLYGON((0 0, 1 0, 1 1, 0 0))');
  });

  it('rejects fewer than 3 points — not a valid polygon', () => {
    expect(() => polygonToWkt([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toThrow();
  });
});

describe('isPointInJobGeofence', () => {
  beforeEach(() => queryMock.mockReset());

  it('returns true when the PostGIS function reports the point is covered', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ in_fence: true }] });
    const result = await isPointInJobGeofence('job-1', { lat: 44.97, lng: -93.26 });
    expect(result).toBe(true);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('fn_point_in_job_geofence'), ['job-1', expect.stringContaining('POINT')]);
  });

  it('returns null when the job has no geofence configured', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ in_fence: null }] });
    const result = await isPointInJobGeofence('job-2', { lat: 44.97, lng: -93.26 });
    expect(result).toBeNull();
  });

  it('returns false when the point falls outside the geofence', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ in_fence: false }] });
    const result = await isPointInJobGeofence('job-3', { lat: 0, lng: 0 });
    expect(result).toBe(false);
  });
});
