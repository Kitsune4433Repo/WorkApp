import admin from 'firebase-admin';
import { pool } from '../config/database';

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const path = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!path) {
    console.warn('FCM_SERVICE_ACCOUNT_JSON not set; push notifications are disabled');
    return;
  }
  admin.initializeApp({ credential: admin.credential.cert(require(path)) });
  initialized = true;
}

export async function sendPushToUser(userId: string, notification: { title: string; body: string; data?: Record<string, string> }) {
  ensureInit();
  if (!initialized) return;

  const { rows } = await pool.query<{ push_token: string }>(
    `SELECT push_token FROM device_tokens WHERE user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return;

  await admin.messaging().sendEachForMulticast({
    tokens: rows.map((r) => r.push_token),
    notification: { title: notification.title, body: notification.body },
    data: notification.data ?? {},
  });
}

export async function sendPushToUsers(userIds: string[], notification: { title: string; body: string; data?: Record<string, string> }) {
  await Promise.all(userIds.map((id) => sendPushToUser(id, notification)));
}
