import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';

export const chatRouter = Router();
chatRouter.use(requireAuth);

// 'broadcast' channels are open rooms — every user can see and post in them regardless of a
// chat_channel_members row (including users created after the room was), so they're unioned in
// here rather than requiring membership like direct/job channels do.
chatRouter.get(
  '/channels',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT c.id, c.type, c.name, c.job_id, c.created_at
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

    const { rows } = await pool.query(
      `SELECT id, sender_id, body, attachment_url, sent_at, read_by FROM chat_messages
        WHERE channel_id = $1 ${before ? 'AND sent_at < $3' : ''}
        ORDER BY sent_at DESC LIMIT $2`,
      before ? [req.params.channelId, 50, before] : [req.params.channelId, 50],
    );
    res.json(rows.reverse());
  }),
);
