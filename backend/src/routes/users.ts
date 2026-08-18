import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

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
