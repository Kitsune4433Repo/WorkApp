import { PoolClient } from 'pg';
import { pool } from '../config/database';

/**
 * Generic optimistic-concurrency merge used by every offline-editable entity
 * (truck_inventory rows, map_annotations layers, job_required_materials).
 *
 * Strategy: last-write-wins on the *version* the client last saw, otherwise
 * flag for admin review. Additive counters (inventory quantities) instead use
 * `resolveAdditiveConflict`, which merges deterministically without ever
 * discarding a technician's edit.
 */
export async function recordConflict(params: {
  entityType: string;
  entityId: string;
  deviceId: string;
  userId?: string;
  clientPayload: unknown;
  serverPayload: unknown;
  clientVersion: number | bigint;
  serverVersion: number | bigint;
  client?: PoolClient;
}) {
  const db = params.client ?? pool;
  await db.query(
    `INSERT INTO sync_conflicts
        (entity_type, entity_id, device_id, user_id, client_payload, server_payload, client_version, server_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      params.entityType,
      params.entityId,
      params.deviceId,
      params.userId ?? null,
      JSON.stringify(params.clientPayload),
      JSON.stringify(params.serverPayload),
      params.clientVersion,
      params.serverVersion,
    ],
  );
}

/**
 * Deterministic merge for purely additive/subtractive counters: instead of
 * comparing whole-row versions, replay the ledger of transactions since the
 * device's last checkpoint. Because inventory_transactions is append-only and
 * idempotent (client_txn_id), two devices editing the same material offline
 * never lose an edit — both deltas apply, in transaction-timestamp order.
 */
export async function resolveAdditiveConflict(materialId: string, userId: string, client: PoolClient) {
  const { rows } = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(
              CASE
                WHEN type IN ('add', 'transfer_in', 'qr_transfer') AND to_user_id = $2 THEN quantity
                WHEN type IN ('subtract', 'transfer_out', 'job_consumption') AND from_user_id = $2 THEN -quantity
                ELSE 0
              END
            ), 0) AS balance
       FROM inventory_transactions
      WHERE material_id = $1 AND (from_user_id = $2 OR to_user_id = $2)`,
    [materialId, userId],
  );
  const balance = Number(rows[0].balance);

  await client.query(
    `INSERT INTO truck_inventory (user_id, material_id, quantity_have, version, updated_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (user_id, material_id)
     DO UPDATE SET quantity_have = EXCLUDED.quantity_have, version = truck_inventory.version + 1, updated_at = now()`,
    [userId, materialId, Math.max(0, balance)],
  );
  return balance;
}
