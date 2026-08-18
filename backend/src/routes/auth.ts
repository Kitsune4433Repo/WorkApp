import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../config/database';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { AccessTokenPayload, UserRole } from '../types';

export const authRouter = Router();

function signTokens(sub: string, email: string, role: UserRole) {
  const base = { sub, email, role };
  const accessTtl = (process.env.JWT_ACCESS_TTL ?? '15m') as jwt.SignOptions['expiresIn'];
  const refreshTtl = (process.env.JWT_REFRESH_TTL ?? '30d') as jwt.SignOptions['expiresIn'];

  const access = jwt.sign({ ...base, type: 'access' } satisfies AccessTokenPayload, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: accessTtl,
  });
  const refresh = jwt.sign({ ...base, type: 'refresh' } satisfies AccessTokenPayload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: refreshTtl,
  });
  return { access, refresh };
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, role, full_name, is_active FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    if (!user || !user.is_active) throw new ApiError(401, 'invalid_credentials');

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new ApiError(401, 'invalid_credentials');

    const tokens = signTokens(user.id, user.email, user.role);
    res.json({
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
    });
  }),
);

const refreshSchema = z.object({ refreshToken: z.string() });

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as AccessTokenPayload;
    } catch {
      throw new ApiError(401, 'invalid_refresh_token');
    }
    if (payload.type !== 'refresh') throw new ApiError(401, 'invalid_refresh_token');

    const tokens = signTokens(payload.sub, payload.email, payload.role);
    res.json(tokens);
  }),
);

// Admin/dispatcher-only user provisioning happens via routes/users.ts (createUser); this endpoint
// is intentionally omitted here to keep account creation centrally governed.
