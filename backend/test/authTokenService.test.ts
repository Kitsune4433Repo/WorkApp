import { beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { AccessTokenPayload } from '../src/types';

describe('signTokens', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.JWT_ACCESS_TTL = '15m';
    process.env.JWT_REFRESH_TTL = '30d';
  });

  it('issues an access token and a refresh token carrying matching claims but distinct types', async () => {
    const { signTokens } = await import('../src/services/authTokenService');
    const { access, refresh } = signTokens('user-1', 'tech@crewops.dev', 'technician');

    const accessPayload = jwt.verify(access, 'test-access-secret') as AccessTokenPayload;
    const refreshPayload = jwt.verify(refresh, 'test-refresh-secret') as AccessTokenPayload;

    expect(accessPayload).toMatchObject({ sub: 'user-1', email: 'tech@crewops.dev', role: 'technician', type: 'access' });
    expect(refreshPayload).toMatchObject({ sub: 'user-1', email: 'tech@crewops.dev', role: 'technician', type: 'refresh' });
  });

  it('signs the access token with a secret the refresh secret cannot verify', async () => {
    const { signTokens } = await import('../src/services/authTokenService');
    const { access } = signTokens('user-2', 'lead@crewops.dev', 'crew_lead');

    expect(() => jwt.verify(access, 'test-refresh-secret')).toThrow();
  });
});
