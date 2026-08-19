export type UserRole = 'admin' | 'crew_lead' | 'crew';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: 'access' | 'refresh';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      deviceId?: string;
    }
  }
}
