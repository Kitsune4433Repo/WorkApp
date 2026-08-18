import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { uploadBuffer, getSignedDownloadUrl } from '../services/objectStorageService';
import { toGeographyPoint } from '../services/geofenceService';

export const photoProofsRouter = Router();
photoProofsRouter.use(requireAuth);

const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });

const metaSchema = z.object({
  jobId: z.string().uuid(),
  takenAt: z.string().datetime(),
  clientPhotoId: z.string().uuid(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

// Compresses on the server as a safety net; the Android client also compresses before upload
// to minimize bandwidth in low-signal conditions (see android MediaCompressionUtil).
photoProofsRouter.post(
  '/',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'photo_required');
    const body = metaSchema.parse(req.body);

    const { rows: existing } = await pool.query(`SELECT id FROM photo_proofs WHERE client_photo_id = $1`, [body.clientPhotoId]);
    if (existing.length) return res.status(200).json({ id: existing[0].id, idempotent: true });

    const originalSize = req.file.size;
    const compressed = await sharp(req.file.buffer).rotate().resize({ width: 1920, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    const thumbnail = await sharp(req.file.buffer).rotate().resize({ width: 320 }).jpeg({ quality: 60 }).toBuffer();

    const fileKey = await uploadBuffer('photo-proofs', compressed, 'image/jpeg');
    const thumbKey = await uploadBuffer('photo-proofs/thumbs', thumbnail, 'image/jpeg');

    const { rows } = await pool.query(
      `INSERT INTO photo_proofs
          (job_id, uploaded_by, file_url, thumbnail_url, original_size_bytes, compressed_size_bytes, taken_at, location, client_photo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,${body.lat !== undefined ? 'ST_GeogFromText($8)' : 'NULL'},$9)
       RETURNING id`,
      body.lat !== undefined
        ? [
            body.jobId, req.user!.id, fileKey, thumbKey, originalSize, compressed.length, body.takenAt,
            toGeographyPoint({ lat: body.lat, lng: body.lng! }), body.clientPhotoId,
          ]
        : [body.jobId, req.user!.id, fileKey, thumbKey, originalSize, compressed.length, body.takenAt, body.clientPhotoId],
    );

    res.status(201).json({ id: rows[0].id, compressedSizeBytes: compressed.length });
  }),
);

photoProofsRouter.get(
  '/job/:jobId',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, uploaded_by, file_url, thumbnail_url, taken_at, compressed_size_bytes FROM photo_proofs
        WHERE job_id = $1 ORDER BY taken_at DESC`,
      [req.params.jobId],
    );
    const withUrls = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        url: await getSignedDownloadUrl(r.file_url),
        thumbnailUrl: r.thumbnail_url ? await getSignedDownloadUrl(r.thumbnail_url) : null,
      })),
    );
    res.json(withUrls);
  }),
);
