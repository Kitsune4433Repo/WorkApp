import 'dotenv/config';
import http from 'http';
import { createApp } from './app';
import { attachChatServer } from './websocket/chatServer';
import { bootstrapDatabaseIfNeeded, applyIncrementalMigrations } from './db/bootstrap';
import { ensurePastPeriodsFinalized } from './services/payrollPeriodService';

async function main() {
  await bootstrapDatabaseIfNeeded();
  await applyIncrementalMigrations();
  await ensurePastPeriodsFinalized().catch((err) => console.error('[payroll] finalize-on-boot failed:', err));

  const app = createApp();
  const server = http.createServer(app);
  attachChatServer(server);

  const port = Number(process.env.PORT ?? 4000);
  server.listen(port, () => {
    console.log(`Crew management API listening on :${port}`);
  });

  // Render's free web plan can spin the dyno down when idle, so a wall-clock cron firing at exactly
  // 11pm Wednesday isn't guaranteed — this interval (while awake) plus the opportunistic check on
  // every request (see app.ts) together cover the case where nothing happens to be running right at
  // the deadline; see payrollPeriodService.ensurePastPeriodsFinalized for how the catch-up works.
  const payrollCheckInterval = setInterval(() => {
    ensurePastPeriodsFinalized().catch((err) => console.error('[payroll] periodic finalize check failed:', err));
  }, 30 * 60 * 1000);
  payrollCheckInterval.unref();

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
