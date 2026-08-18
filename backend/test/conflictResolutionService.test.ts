import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';
import { recordConflict, resolveAdditiveConflict } from '../src/services/conflictResolutionService';

function fakeClient(queryImpl: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) {
  return { query: vi.fn(queryImpl) } as unknown as PoolClient;
}

describe('resolveAdditiveConflict', () => {
  it('replays the transaction ledger into a materialized balance and persists it', async () => {
    const client = fakeClient(async (sql) => {
      if (sql.includes('SELECT COALESCE(SUM')) return { rows: [{ balance: '12.5' }] };
      return { rows: [] }; // the upsert
    });

    const balance = await resolveAdditiveConflict('material-1', 'user-1', client);

    expect(balance).toBe(12.5);
    expect(client.query).toHaveBeenCalledTimes(2);
    const upsertCall = (client.query as any).mock.calls[1];
    expect(upsertCall[0]).toContain('ON CONFLICT (user_id, material_id)');
    expect(upsertCall[1]).toEqual(['user-1', 'material-1', 12.5]);
  });

  it('clamps a negative replayed balance to zero before persisting, but still returns the raw value', async () => {
    const client = fakeClient(async (sql) => {
      if (sql.includes('SELECT COALESCE(SUM')) return { rows: [{ balance: '-3' }] };
      return { rows: [] };
    });

    const balance = await resolveAdditiveConflict('material-1', 'user-1', client);

    expect(balance).toBe(-3);
    const upsertCall = (client.query as any).mock.calls[1];
    expect(upsertCall[1]).toEqual(['user-1', 'material-1', 0]);
  });
});

describe('recordConflict', () => {
  let client: PoolClient;
  let calls: any[][];

  beforeEach(() => {
    calls = [];
    client = fakeClient(async (sql, params) => {
      calls.push([sql, params]);
      return { rows: [] };
    });
  });

  it('serializes client/server payloads as JSON and preserves version numbers', async () => {
    await recordConflict({
      entityType: 'map_annotations',
      entityId: 'annotation-1',
      deviceId: 'device-1',
      userId: 'user-1',
      clientPayload: { strokes: 3 },
      serverPayload: { strokes: 5 },
      clientVersion: 2,
      serverVersion: 4,
      client,
    });

    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toContain('INSERT INTO sync_conflicts');
    expect(params).toEqual([
      'map_annotations',
      'annotation-1',
      'device-1',
      'user-1',
      JSON.stringify({ strokes: 3 }),
      JSON.stringify({ strokes: 5 }),
      2,
      4,
    ]);
  });

  it('defaults userId to null when the conflict has no attributable user', async () => {
    await recordConflict({
      entityType: 'truck_inventory',
      entityId: 'row-1',
      deviceId: 'device-2',
      clientPayload: {},
      serverPayload: {},
      clientVersion: 1,
      serverVersion: 1,
      client,
    });

    const [, params] = calls[0];
    expect(params[3]).toBeNull();
  });
});
