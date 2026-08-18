import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AccessTokenPayload, UserRole } from '../types';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_bearer_token' });
  }

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_ACCESS_SECRET!) as AccessTokenPayload;
    if (payload.type !== 'access') throw new Error('wrong_token_type');

    req.user = { id: payload.sub, email: payload.email, role: payload.role, fullName: '' };
    req.deviceId = (req.headers['x-device-id'] as string) ?? 'unknown';
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'insufficient_role', required: roles });
    }
    next();
  };
}
