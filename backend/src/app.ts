import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Options as RateLimitOptions } from 'express-rate-limit';
import { createApiRateLimiter } from './middleware/rateLimiter';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { jobsRouter } from './routes/jobs';
import { inventoryRouter } from './routes/inventory';
import { timecardsRouter } from './routes/timecards';
import { documentsRouter } from './routes/documents';
import { knowledgeBaseRouter } from './routes/knowledgeBase';
import { photoProofsRouter } from './routes/photoProofs';
import { syncRouter } from './routes/sync';
import { chatRouter } from './routes/chat';
import { errorHandler, notFound } from './middleware/errorHandler';
import { ensurePastPeriodsFinalized } from './services/payrollPeriodService';

// Cheap opportunistic catch-up: at most once every 5 minutes of real traffic, check whether the
// current payroll week's Wednesday-11pm close-out deadline has passed and archive it if so. This is
// what makes the close-out actually happen if the free-tier dyno was asleep right at the deadline —
// the next request to wake it (even just a health check) triggers the check. See
// payrollPeriodService.ensurePastPeriodsFinalized for the idempotent finalize-and-walk-backward logic.
let lastPayrollCheckAt = 0;
function checkPayrollPeriodsOpportunistically() {
  const now = Date.now();
  if (now - lastPayrollCheckAt < 5 * 60 * 1000) return;
  lastPayrollCheckAt = now;
  ensurePastPeriodsFinalized().catch((err) => console.error('[payroll] opportunistic finalize check failed:', err));
}

export function createApp(options: { rateLimiterOptions?: Partial<RateLimitOptions> } = {}) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(createApiRateLimiter(options.rateLimiterOptions));
  app.use((_req, _res, next) => {
    checkPayrollPeriodsOpportunistically();
    next();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/timecards', timecardsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/knowledge-base', knowledgeBaseRouter);
  app.use('/api/photo-proofs', photoProofsRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/chat', chatRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
