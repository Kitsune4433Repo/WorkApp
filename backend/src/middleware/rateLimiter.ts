import rateLimit, { Options } from 'express-rate-limit';

/** Extracted into a factory (rather than inlined in app.ts) so tests can mount a tiny-budget
 * limiter against a real Express app instead of firing hundreds of requests to prove the
 * production 300/min budget actually works. */
export function createApiRateLimiter(overrides: Partial<Options> = {}) {
  return rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    ...overrides,
  });
}
