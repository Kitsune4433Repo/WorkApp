import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { uploadBuffer, getSignedDownloadUrl } from '../services/objectStorageService';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });

// 'broadcast' channels are open rooms — every user can see and post in them regardless of a
// chat_channel_members row (including users created after the room was), so they're unioned in
// here rather than requiring membership like direct/job channels do.
chatRouter.get(
  '/channels',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT c.id, c.type, c.name, c.job_id, c.created_by, c.created_at
         FROM chat_channels c
         LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $1
        WHERE m.user_id IS NOT NULL OR c.type = 'broadcast'
        ORDER BY c.created_at DESC`,
      [req.user!.id],
    );
    res.json(rows);
  }),
);

const createChannelSchema = z.object({
  type: z.enum(['direct', 'job', 'broadcast']),
  name: z.string().optional(),
  jobId: z.string().uuid().optional(),
  memberUserIds: z.array(z.string().uuid()).default([]),
});

chatRouter.post(
  '/channels',
  asyncHandler(async (req, res) => {
    const body = createChannelSchema.parse(req.body);
    // Broadcast (open, admin-made) rooms don't need an explicit member list — everyone already has
    // access per the query above — but every other channel type still needs at least one other member.
    if (body.type === 'broadcast' && req.user!.role !== 'admin') throw new ApiError(403, 'admin_only');
    if (body.type !== 'broadcast' && !body.memberUserIds.length) throw new ApiError(400, 'member_user_ids_required');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO chat_channels (type, name, job_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
        [body.type, body.name ?? null, body.jobId ?? null, req.user!.id],
      );
      const members = new Set([req.user!.id, ...body.memberUserIds]);
      for (const userId of members) {
        await client.query(`INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1,$2)`, [rows[0].id, userId]);
      }
      await client.query('COMMIT');
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

chatRouter.get(
  '/channels/:channelId/messages',
  asyncHandler(async (req, res) => {
    const before = req.query.before as string | undefined;
    const { rows: access } = await pool.query(
      `SELECT 1 FROM chat_channels c
         LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $2
        WHERE c.id = $1 AND (m.user_id IS NOT NULL OR c.type = 'broadcast')`,
      [req.params.channelId, req.user!.id],
    );
    if (!access.length) throw new ApiError(403, 'not_a_channel_member');

    // Joins in the sender's name (never their role — messages should read like a conversation
    // between people, not a org chart) so both clients can label who sent what.
    const { rows } = await pool.query(
      `SELECT cm.id, cm.sender_id, u.full_name AS sender_full_name, cm.body, cm.attachment_url, cm.sent_at, cm.read_by
         FROM chat_messages cm
         LEFT JOIN users u ON u.id = cm.sender_id
        WHERE cm.channel_id = $1 ${before ? 'AND cm.sent_at < $3' : ''}
        ORDER BY cm.sent_at DESC LIMIT $2`,
      before ? [req.params.channelId, 50, before] : [req.params.channelId, 50],
    );
    res.json(rows.reverse());
  }),
);

// Creator or an admin can remove a room; membership/messages cascade-delete with it.
chatRouter.delete(
  '/channels/:channelId',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT created_by FROM chat_channels WHERE id = $1`, [req.params.channelId]);
    if (!rows.length) throw new ApiError(404, 'channel_not_found');
    if (rows[0].created_by !== req.user!.id && req.user!.role !== 'admin') throw new ApiError(403, 'not_authorized');

    await pool.query(`DELETE FROM chat_channels WHERE id = $1`, [req.params.channelId]);
    res.status(204).end();
  }),
);

// Photo attachments (feature parity with the resource library's uploads): the message itself only
// ever carries a storage key, never a signed URL — those expire, so a client resolves one just
// before display via the /sign endpoint below, same split as documents.ts's download flow.
chatRouter.post(
  '/attachments',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'file_required');
    let key: string;
    try {
      key = await uploadBuffer('chat', req.file.buffer, req.file.mimetype);
    } catch (err) {
      throw new ApiError(502, 'upload_failed', { message: err instanceof Error ? err.message : String(err) });
    }
    res.status(201).json({ key });
  }),
);

chatRouter.get(
  '/attachments/sign',
  asyncHandler(async (req, res) => {
    const key = req.query.key as string | undefined;
    if (!key) throw new ApiError(400, 'key_required');
    res.json({ url: await getSignedDownloadUrl(key) });
  }),
);
