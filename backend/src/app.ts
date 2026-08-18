import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(rateLimit({ windowMs: 60_000, max: 300 }));

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
