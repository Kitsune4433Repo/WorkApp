import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { resolveAdditiveConflict } from '../services/conflictResolutionService';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

// --- Material catalog (dynamic ingestion, feature 8) ------------------------

const materialSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  unit: z.string().min(1).default('unit'),
  description: z.string().optional(),
});

// SKUs are an internal catalog identifier, not something a dispatcher should have to type when
// adding a material on the fly — generate one so material_catalog.sku (NOT NULL UNIQUE) is
// satisfied without asking for it in the UI.
function generateSku(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return `${slug || 'MAT'}-${uuid().slice(0, 8).toUpperCase()}`;
}

inventoryRouter.get(
  '/catalog',
  asyncHandler(async (req, res) => {
    const search = (req.query.q as string) ?? '';
    const { rows } = await pool.query(
      `SELECT id, sku, name, category, unit, description FROM material_catalog
        WHERE is_active AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR sku ILIKE '%' || $1 || '%')
        ORDER BY name LIMIT 200`,
      [search],
    );
    res.json(rows);
  }),
);

inventoryRouter.post(
  '/catalog',
  requireRole('admin', 'crew_lead'),
  asyncHandler(async (req, res) => {
    const body = materialSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO material_catalog (sku, name, category, unit, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [generateSku(body.name), body.name, body.category, body.unit, body.description ?? null, req.user!.id],
    );
    res.status(201).json({ id: rows[0].id });
  }),
);

// Soft-delete: material_catalog.id is referenced by truck_inventory, job_required_materials, and
// inventory_transactions with no cascade, so a hard DELETE would fail (FK violation) the moment a
// material has any usage history. is_active already gates both /catalog and /have above, so
// flipping it off here removes the material from view everywhere immediately without touching history.
inventoryRouter.delete(
  '/catalog/:id',
  requireRole('admin', 'crew_lead'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE material_catalog SET is_active = false WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!rows.length) throw new ApiError(404, 'material_not_found');
    res.status(204).end();
  }),
);

// --- "Have" ledger: per-technician truck inventory ---------------------------

inventoryRouter.get(
  '/have/:userId',
  asyncHandler(async (req, res) => {
    // LEFT JOIN from the catalog (not an inner join starting at truck_inventory) so a
    // freshly-added material shows up immediately at quantity 0, ready to adjust — otherwise it's
    // invisible until the technician has a truck_inventory row for it, which nothing ever creates
    // on its own.
    // sku is still returned (unused by the web UI) so the Android client's HaveRowDto, which
    // requires it, keeps working — this endpoint is shared by both clients.
    const { rows } = await pool.query(
      `SELECT m.id AS material_id, m.sku, m.name, m.unit, COALESCE(ti.quantity_have, 0) AS quantity_have,
              COALESCE(ti.version, 0) AS version, ti.updated_at
         FROM material_catalog m
         LEFT JOIN truck_inventory ti ON ti.material_id = m.id AND ti.user_id = $1
        WHERE m.is_active
        ORDER BY m.name`,
      [req.params.userId],
    );
    res.json(rows);
  }),
);

// Plus/minus adjustment. Idempotent via clientTxnId so retried offline syncs never double-apply.
const adjustSchema = z.object({
  materialId: z.string().uuid(),
  delta: z.number().refine((n) => n !== 0, 'delta_must_be_nonzero'),
  jobId: z.string().uuid().optional(),
  clientTxnId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});

inventoryRouter.post(
  '/have/adjust',
  asyncHandler(async (req, res) => {
    const body = adjustSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const type = body.delta > 0 ? 'add' : 'subtract';
      const { rows: existing } = await client.query(`SELECT id FROM inventory_transactions WHERE client_txn_id = $1`, [
        body.clientTxnId,
      ]);
      if (!existing.length) {
        await client.query(
          `INSERT INTO inventory_transactions
              (material_id, type, quantity, from_user_id, to_user_id, job_id, client_txn_id, device_id, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            body.materialId,
            type,
            Math.abs(body.delta),
            type === 'subtract' ? req.user!.id : null,
            type === 'add' ? req.user!.id : null,
            body.jobId ?? null,
            body.clientTxnId,
            req.deviceId,
            body.occurredAt,
          ],
        );
      }
      const balance = await resolveAdditiveConflict(body.materialId, req.user!.id, client);
      await client.query('COMMIT');
      res.json({ materialId: body.materialId, quantityHave: balance });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

// --- "Need" ledger: materials required per job -------------------------------

inventoryRouter.get(
  '/need/:jobId',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT jrm.material_id, m.sku, m.name, m.unit, jrm.quantity_needed, jrm.quantity_staged
         FROM job_required_materials jrm JOIN material_catalog m ON m.id = jrm.material_id
        WHERE jrm.job_id = $1 ORDER BY m.name`,
      [req.params.jobId],
    );
    res.json(rows);
  }),
);

const needSchema = z.object({ materialId: z.string().uuid(), quantityNeeded: z.number().min(0) });

inventoryRouter.put(
  '/need/:jobId',
  requireRole('admin', 'crew_lead'),
  asyncHandler(async (req, res) => {
    const body = needSchema.parse(req.body);
    await pool.query(
      `INSERT INTO job_required_materials (job_id, material_id, quantity_needed)
       VALUES ($1,$2,$3)
       ON CONFLICT (job_id, material_id) DO UPDATE SET quantity_needed = EXCLUDED.quantity_needed, updated_at = now()`,
      [req.params.jobId, body.materialId, body.quantityNeeded],
    );
    res.status(204).end();
  }),
);

// --- QR peer-to-peer transfer (feature 12) -----------------------------------

const qrCreateSchema = z.object({ materialId: z.string().uuid(), quantity: z.number().positive(), ttlSeconds: z.number().int().positive().default(120) });

inventoryRouter.post(
  '/qr-transfer',
  asyncHandler(async (req, res) => {
    const body = qrCreateSchema.parse(req.body);
    const id = uuid();
    const expiresAt = new Date(Date.now() + body.ttlSeconds * 1000);
    const token = jwt.sign({ transferId: id }, process.env.QR_TRANSFER_SECRET!, { expiresIn: body.ttlSeconds });

    await pool.query(
      `INSERT INTO qr_transfers (id, from_user_id, material_id, quantity, qr_payload_token, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, req.user!.id, body.materialId, body.quantity, token, expiresAt],
    );
    res.status(201).json({ transferId: id, qrToken: token, expiresAt });
  }),
);

inventoryRouter.post(
  '/qr-transfer/:token/claim',
  asyncHandler(async (req, res) => {
    let payload: { transferId: string };
    try {
      payload = jwt.verify(req.params.token, process.env.QR_TRANSFER_SECRET!) as { transferId: string };
    } catch {
      throw new ApiError(400, 'qr_token_invalid_or_expired');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM qr_transfers WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [payload.transferId],
      );
      const transfer = rows[0];
      if (!transfer) throw new ApiError(409, 'qr_transfer_already_claimed_or_missing');
      if (transfer.from_user_id === req.user!.id) throw new ApiError(400, 'cannot_claim_own_transfer');

      const txnId = uuid();
      const clientTxnId = uuid();
      await client.query(
        `INSERT INTO inventory_transactions
            (id, material_id, type, quantity, from_user_id, to_user_id, client_txn_id, device_id, occurred_at)
         VALUES ($1,$2,'qr_transfer',$3,$4,$5,$6,$7, now())`,
        [txnId, transfer.material_id, transfer.quantity, transfer.from_user_id, req.user!.id, clientTxnId, req.deviceId],
      );
      await resolveAdditiveConflict(transfer.material_id, transfer.from_user_id, client);
      await resolveAdditiveConflict(transfer.material_id, req.user!.id, client);

      await client.query(
        `UPDATE qr_transfers SET status = 'completed', to_user_id = $1, completed_txn_id = $2, completed_at = now() WHERE id = $3`,
        [req.user!.id, txnId, transfer.id],
      );
      await client.query('COMMIT');
      res.json({ materialId: transfer.material_id, quantity: transfer.quantity, fromUserId: transfer.from_user_id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

// --- "Out of Inventory": materials to buy or replace (feature request, not job- or user-scoped) ---

inventoryRouter.get(
  '/restock',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, material_id, item_name, unit, quantity_needed, note, requested_by, created_at
         FROM restock_requests ORDER BY created_at DESC`,
    );
    res.json(rows);
  }),
);

const createRestockSchema = z.object({
  itemName: z.string().min(1),
  unit: z.string().min(1).default('unit'),
  quantityNeeded: z.number().min(0).default(1),
  note: z.string().optional(),
  materialId: z.string().uuid().optional(),
});

inventoryRouter.post(
  '/restock',
  asyncHandler(async (req, res) => {
    const body = createRestockSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO restock_requests (material_id, item_name, unit, quantity_needed, note, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [body.materialId ?? null, body.itemName, body.unit, body.quantityNeeded, body.note ?? null, req.user!.id],
    );
    res.status(201).json({ id: rows[0].id });
  }),
);

const updateRestockSchema = z.object({
  quantityNeeded: z.number().min(0).optional(),
  note: z.string().optional(),
});

inventoryRouter.patch(
  '/restock/:id',
  asyncHandler(async (req, res) => {
    const body = updateRestockSchema.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, col] of [
      ['quantityNeeded', 'quantity_needed'],
      ['note', 'note'],
    ] as const) {
      const value = (body as Record<string, unknown>)[key];
      if (value !== undefined) {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) throw new ApiError(400, 'no_fields_to_update');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE restock_requests SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING id`,
      params,
    );
    if (!rows.length) throw new ApiError(404, 'restock_request_not_found');
    res.status(204).end();
  }),
);

// Removing a request means it's been bought/resolved — no soft-delete needed, this list is a
// working queue, not a historical ledger.
inventoryRouter.delete(
  '/restock/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`DELETE FROM restock_requests WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows.length) throw new ApiError(404, 'restock_request_not_found');
    res.status(204).end();
  }),
);

// Marks a request restocked AND actually credits the material to whoever's fulfilling it — a plain
// delete (the old "Restocked" behavior) resolved the request but the material never landed
// anywhere. If the request wasn't linked to a real catalog material (the add-request form is
// free-text), auto-creates one so the credit has somewhere to go.
inventoryRouter.post(
  '/restock/:id/fulfill',
  asyncHandler(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: requestRows } = await client.query(
        `SELECT id, material_id, item_name, unit, quantity_needed FROM restock_requests WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      );
      if (!requestRows.length) throw new ApiError(404, 'restock_request_not_found');
      const request = requestRows[0];

      let materialId = request.material_id as string | null;
      if (!materialId) {
        const { rows: existingMaterial } = await client.query(
          `SELECT id FROM material_catalog WHERE is_active AND name ILIKE $1 LIMIT 1`,
          [request.item_name],
        );
        if (existingMaterial.length) {
          materialId = existingMaterial[0].id;
        } else {
          const { rows: newMaterial } = await client.query(
            `INSERT INTO material_catalog (sku, name, category, unit, created_by)
             VALUES ($1,$2,'restocked',$3,$4) RETURNING id`,
            [generateSku(request.item_name), request.item_name, request.unit, req.user!.id],
          );
          materialId = newMaterial[0].id;
        }
      }

      await client.query(
        `INSERT INTO inventory_transactions
            (material_id, type, quantity, to_user_id, client_txn_id, device_id, occurred_at)
         VALUES ($1,'add',$2,$3,$4,$5,now())`,
        [materialId, request.quantity_needed, req.user!.id, uuid(), req.deviceId ?? null],
      );
      const quantityHave = await resolveAdditiveConflict(materialId!, req.user!.id, client);

      await client.query(`DELETE FROM restock_requests WHERE id = $1`, [req.params.id]);
      await client.query('COMMIT');
      res.json({ materialId, quantityHave });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);
