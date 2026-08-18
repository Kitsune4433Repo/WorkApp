import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

// The rate limiter is mounted ahead of every route, including /health, so it can be exercised
// without a database connection — the point of the test is the limiter itself, not any route logic.
describe('rate limiting', () => {
  it('allows requests under the configured budget', async () => {
    const app = createApp({ rateLimiterOptions: { windowMs: 60_000, max: 5 } });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('returns 429 once the configured request budget is exhausted within the window', async () => {
    const app = createApp({ rateLimiterOptions: { windowMs: 60_000, max: 3 } });

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }

    const limited = await request(app).get('/health');
    expect(limited.status).toBe(429);
  });

  it('scopes the budget independently per app instance (regression guard for shared state)', async () => {
    const appA = createApp({ rateLimiterOptions: { windowMs: 60_000, max: 1 } });
    const appB = createApp({ rateLimiterOptions: { windowMs: 60_000, max: 1 } });

    await request(appA).get('/health');
    const secondOnA = await request(appA).get('/health');
    const firstOnB = await request(appB).get('/health');

    expect(secondOnA.status).toBe(429);
    expect(firstOnB.status).toBe(200);
  });
});
