import 'dotenv/config';
import http from 'http';
import { createApp } from './app';
import { attachChatServer } from './websocket/chatServer';
import { bootstrapDatabaseIfNeeded } from './db/bootstrap';

async function main() {
  await bootstrapDatabaseIfNeeded();

  const app = createApp();
  const server = http.createServer(app);
  attachChatServer(server);

  const port = Number(process.env.PORT ?? 4000);
  server.listen(port, () => {
    console.log(`Crew management API listening on :${port}`);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
