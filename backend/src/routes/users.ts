import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get(
  '/',
  requireRole('admin', 'dispatcher', 'crew_lead'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, email, full_name, role, phone, hourly_rate_cents, is_active
         FROM users ORDER BY full_name`,
    );
    res.json(rows);
  }),
);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: z.enum(['admin', 'dispatcher', 'crew_lead', 'technician']),
  phone: z.string().optional(),
  hourlyRateCents: z.number().int().min(0).default(0),
});

usersRouter.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone, hourly_rate_cents)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, full_name, role, phone, hourly_rate_cents`,
      [body.email, passwordHash, body.fullName, body.role, body.phone ?? null, body.hourlyRateCents],
    );
    res.status(201).json(rows[0]);
  }),
);

const setActiveSchema = z.object({ isActive: z.boolean() });

// Soft-delete: reversible, and login already rejects inactive accounts
// (`if (!user || !user.is_active) throw ...` in routes/auth.ts), so this takes effect immediately.
// Prefer this over the hard DELETE below when the account might need to come back.
usersRouter.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = setActiveSchema.parse(req.body);
    if (req.params.id === req.user!.id && !body.isActive) {
      throw new ApiError(400, 'cannot_deactivate_self');
    }
    const { rows } = await pool.query(
      `UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1
       RETURNING id, email, full_name, role, phone, hourly_rate_cents, is_active`,
      [req.params.id, body.isActive],
    );
    if (!rows.length) throw new ApiError(404, 'user_not_found');
    res.json(rows[0]);
  }),
);

// Hard delete: permanently removes the login and every purely-personal row that's meaningless
// without it (timecards, truck inventory, device tokens, crew membership, job assignments,
// location pings — all ON DELETE CASCADE from users.id). Content the user created (jobs, chat
// messages, documents, knowledge-base articles, inventory transactions, ...) is kept but its
// "who did this" attribution becomes NULL — see database/migrations/004_users_hard_delete_set_null.sql.
// Irreversible, unlike deactivating above.
usersRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) throw new ApiError(400, 'cannot_delete_self');
    const { rows } = await pool.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows.length) throw new ApiError(404, 'user_not_found');
    res.status(204).end();
  }),
);

usersRouter.post(
  '/devices',
  asyncHandler(async (req, res) => {
    const schema = z.object({ deviceId: z.string(), pushToken: z.string(), platform: z.enum(['android', 'ios', 'web']) });
    const body = schema.parse(req.body);
    await pool.query(
      `INSERT INTO device_tokens (user_id, device_id, push_token, platform, last_seen_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, device_id) DO UPDATE SET push_token = EXCLUDED.push_token, last_seen_at = now()`,
      [req.user!.id, body.deviceId, body.pushToken, body.platform],
    );
    res.status(204).end();
  }),
);
