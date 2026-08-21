import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { pool, withTransaction } from '../config/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { uploadBuffer, getSignedDownloadUrl, deleteObject } from '../services/objectStorageService';
import { recordConflict } from '../services/conflictResolutionService';

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const upload = multer({ limits: { fileSize: 200 * 1024 * 1024 } });

// --- Dynamic upload: new maps, manuals, compliance docs (feature 8) ---------

const createDocSchema = z.object({
  title: z.string().min(1),
  // Optional now that docType is derived per-file server-side (see deriveDocType) — a single
  // client-supplied value never made sense once one request can carry files of different types.
  // Still accepted so an already-built client (e.g. Android) that sends it keeps working unchanged.
  docType: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(), // e.g. a color legend for an annotated map/photo
  jobId: z.string().uuid().optional(),
  isMap: z.coerce.boolean().default(false),
});

// Any file type is allowed — this just labels what was uploaded. Mirrors web's deriveDocType.
function deriveDocType(originalName: string, mimetype: string): string {
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(originalName);
  if (extMatch) return extMatch[1].toLowerCase();
  return mimetype.split('/')[1] ?? 'file';
}

documentsRouter.post(
  '/',
  requireRole('admin', 'crew_lead'),
  // 'files' is the multi-upload field (web's "put 2+ files in one upload" flow); 'file' is the
  // original single-file field, kept so already-built clients (Android) don't need to change.
  upload.fields([
    { name: 'files', maxCount: 20 },
    { name: 'file', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const fileFields = req.files as Record<string, Express.Multer.File[]> | undefined;
    const files = [...(fileFields?.files ?? []), ...(fileFields?.file ?? [])];
    if (!files.length) throw new ApiError(400, 'file_required');
    const body = createDocSchema.parse(req.body);

    // A shared id lets the Resource Library visually cluster files from the same upload as "the
    // same location" — only meaningful when there's more than one, so a solo upload stays ungrouped
    // exactly as it always has.
    const locationGroupId = files.length > 1 ? uuid() : null;

    const ids = await withTransaction(async (client) => {
      const docIds: string[] = [];
      for (const file of files) {
        const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
        let key: string;
        try {
          key = await uploadBuffer('documents', file.buffer, file.mimetype);
        } catch (err) {
          throw new ApiError(502, 'upload_failed', { message: err instanceof Error ? err.message : String(err) });
        }

        const { rows } = await client.query(
          `INSERT INTO documents (title, doc_type, category, description, job_id, is_map, uploaded_by, location_group_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            body.title,
            deriveDocType(file.originalname, file.mimetype),
            body.category ?? null,
            body.description ?? null,
            body.jobId ?? null,
            body.isMap,
            req.user!.id,
            locationGroupId,
          ],
        );
        await client.query(
          `INSERT INTO document_versions (document_id, version_number, file_url, file_size_bytes, checksum_sha256, uploaded_by)
           VALUES ($1,1,$2,$3,$4,$5)`,
          [rows[0].id, key, file.size, checksum, req.user!.id],
        );
        docIds.push(rows[0].id);
      }
      return docIds;
    });

    res.status(201).json({ ids, locationGroupId });
  }),
);

// Append a new version to an existing document (re-upload / revised map).
documentsRouter.post(
  '/:documentId/versions',
  requireRole('admin', 'crew_lead'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'file_required');
    const changeNote = (req.body.changeNote as string) ?? null;
    const checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    let key: string;
    try {
      key = await uploadBuffer('documents', req.file.buffer, req.file.mimetype);
    } catch (err) {
      throw new ApiError(502, 'upload_failed', { message: err instanceof Error ? err.message : String(err) });
    }

    const version = await withTransaction(async (client) => {
      const { rows: docRows } = await client.query(
        `SELECT current_version FROM documents WHERE id = $1 FOR UPDATE`,
        [req.params.documentId],
      );
      if (!docRows.length) throw new ApiError(404, 'document_not_found');
      const nextVersion = docRows[0].current_version + 1;

      await client.query(
        `INSERT INTO document_versions (document_id, version_number, file_url, file_size_bytes, checksum_sha256, uploaded_by, change_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.params.documentId, nextVersion, key, req.file!.size, checksum, req.user!.id, changeNote],
      );
      await client.query(`UPDATE documents SET current_version = $2, updated_at = now() WHERE id = $1`, [
        req.params.documentId,
        nextVersion,
      ]);
      return nextVersion;
    });

    res.status(201).json({ documentId: req.params.documentId, versionNumber: version });
  }),
);

const updateDocSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().optional(),
  description: z.string().optional(),
});

documentsRouter.patch(
  '/:documentId',
  requireRole('admin', 'crew_lead'),
  asyncHandler(async (req, res) => {
    const body = updateDocSchema.parse(req.body);
    const { rows } = await pool.query(
      `UPDATE documents SET
          title = COALESCE($2, title),
          category = COALESCE($3, category),
          description = COALESCE($4, description),
          updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [req.params.documentId, body.title ?? null, body.category ?? null, body.description ?? null],
    );
    if (!rows.length) throw new ApiError(404, 'document_not_found');
    res.status(204).end();
  }),
);

// document_versions and map_annotations both cascade on document_id, so removing the documents
// row cleans up the DB side; the object storage files aren't referenced anywhere else, so they're
// removed too (best-effort — see deleteObject).
documentsRouter.delete(
  '/:documentId',
  requireRole('admin', 'crew_lead'),
  asyncHandler(async (req, res) => {
    const { rows: versionRows } = await pool.query(`SELECT file_url FROM document_versions WHERE document_id = $1`, [
      req.params.documentId,
    ]);
    const { rows } = await pool.query(`DELETE FROM documents WHERE id = $1 RETURNING id`, [req.params.documentId]);
    if (!rows.length) throw new ApiError(404, 'document_not_found');
    await Promise.all(versionRows.map((v) => deleteObject(v.file_url)));
    res.status(204).end();
  }),
);

documentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { jobId, isMap } = req.query;
    const params: unknown[] = [];
    const where: string[] = [];
    if (jobId) {
      params.push(jobId);
      where.push(`job_id = $${params.length}`);
    }
    if (isMap !== undefined) {
      params.push(isMap === 'true');
      where.push(`is_map = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT id, title, doc_type, category, description, job_id, current_version, is_map, location_group_id, updated_at
         FROM documents ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC`,
      params,
    );
    res.json(rows);
  }),
);

documentsRouter.get(
  '/:documentId/download',
  asyncHandler(async (req, res) => {
    const version = req.query.version ? Number(req.query.version) : undefined;
    const { rows } = await pool.query(
      `SELECT dv.file_url FROM document_versions dv
         JOIN documents d ON d.id = dv.document_id
        WHERE dv.document_id = $1 AND dv.version_number = COALESCE($2, d.current_version)`,
      [req.params.documentId, version ?? null],
    );
    if (!rows.length) throw new ApiError(404, 'document_version_not_found');
    res.json({ url: await getSignedDownloadUrl(rows[0].file_url) });
  }),
);

// --- Offline-drawn map annotations / redlines (feature 7), with conflict handling (feature 9) --

const annotationSchema = z.object({
  documentVersion: z.number().int(),
  layerData: z.any(),
  // node-pg returns BIGINT columns (map_annotations.version) as strings — coerce defensively here
  // in case a client ever round-trips one back without converting it (see the ::int casts below,
  // which fix this at the source for both endpoints in this file).
  clientVersion: z.coerce.number().int(),
  clientId: z.string(),
});

documentsRouter.put(
  '/:documentId/annotations',
  asyncHandler(async (req, res) => {
    const body = annotationSchema.parse(req.body);

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, version::int AS version, layer_data FROM map_annotations
          WHERE document_id = $1 AND created_by = $2
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [req.params.documentId, req.user!.id],
      );

      if (rows.length && rows[0].version > body.clientVersion) {
        // Server has a newer version than the device last synced from: don't silently overwrite,
        // flag for admin review and keep the server copy authoritative until resolved.
        await recordConflict({
          entityType: 'map_annotations',
          entityId: rows[0].id,
          deviceId: body.clientId,
          userId: req.user!.id,
          clientPayload: body.layerData,
          serverPayload: rows[0].layer_data,
          clientVersion: body.clientVersion,
          serverVersion: rows[0].version,
          client,
        });
        throw new ApiError(409, 'annotation_conflict_flagged_for_review');
      }

      await client.query(
        `INSERT INTO map_annotations (document_id, document_version, created_by, layer_data, version, client_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.params.documentId, body.documentVersion, req.user!.id, body.layerData, body.clientVersion + 1, body.clientId],
      );
    });

    res.status(204).end();
  }),
);

documentsRouter.get(
  '/:documentId/annotations',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (created_by) created_by, layer_data, version::int AS version, updated_at
         FROM map_annotations WHERE document_id = $1
         ORDER BY created_by, created_at DESC`,
      [req.params.documentId],
    );
    res.json(rows);
  }),
);
