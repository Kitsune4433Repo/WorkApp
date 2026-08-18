import jwt from 'jsonwebtoken';
import { AccessTokenPayload, UserRole } from '../types';

export function signTokens(sub: string, email: string, role: UserRole) {
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
