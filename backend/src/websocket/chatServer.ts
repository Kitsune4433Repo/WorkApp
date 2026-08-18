import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { pool } from '../config/database';
import { AccessTokenPayload } from '../types';
import { sendPushToUsers } from '../services/pushNotificationService';

interface AuthedSocket extends Socket {
  userId?: string;
}

export function attachChatServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/ws/chat',
  });

  io.use((socket: AuthedSocket, next) => {
    try {
      const token = socket.handshake.auth.token as string;
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessTokenPayload;
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    socket.join(`user:${socket.userId}`);

    socket.on('channel:join', async (channelId: string) => {
      // Broadcast (open, admin-made) rooms don't require a chat_channel_members row — every user
      // has access, including ones created after the room was.
      const { rows } = await pool.query(
        `SELECT 1 FROM chat_channels c
           LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $2
          WHERE c.id = $1 AND (m.user_id IS NOT NULL OR c.type = 'broadcast')`,
        [channelId, socket.userId],
      );
      if (rows.length) socket.join(`channel:${channelId}`);
    });

    socket.on(
      'message:send',
      async (
        payload: { channelId: string; body?: string; attachmentUrl?: string; clientMsgId: string },
        ack?: (result: unknown) => void,
      ) => {
        try {
          const { rows: channelRows } = await pool.query(
            `SELECT c.type FROM chat_channels c
               LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $2
              WHERE c.id = $1 AND (m.user_id IS NOT NULL OR c.type = 'broadcast')`,
            [payload.channelId, socket.userId],
          );
          if (!channelRows.length) {
            ack?.({ error: 'not_a_channel_member' });
            return;
          }
          const isBroadcast = channelRows[0].type === 'broadcast';

          const { rows: existing } = await pool.query(
            `SELECT id, sent_at FROM chat_messages WHERE channel_id = $1 AND client_msg_id = $2`,
            [payload.channelId, payload.clientMsgId],
          );
          let message = existing[0];

          if (!message) {
            const { rows } = await pool.query(
              `INSERT INTO chat_messages (id, channel_id, sender_id, body, attachment_url, client_msg_id)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, sent_at`,
              [uuid(), payload.channelId, socket.userId, payload.body ?? null, payload.attachmentUrl ?? null, payload.clientMsgId],
            );
            message = rows[0];

            // Broadcast rooms have no bulk chat_channel_members rows (that's the point — every user
            // has access without one), so notify every other active user instead of just members.
            const { rows: members } = await pool.query(
              isBroadcast
                ? `SELECT id AS user_id FROM users WHERE is_active AND id <> $1`
                : `SELECT user_id FROM chat_channel_members WHERE channel_id = $2 AND user_id <> $1`,
              isBroadcast ? [socket.userId] : [socket.userId, payload.channelId],
            );
            io.to(`channel:${payload.channelId}`).emit('message:new', {
              id: message.id,
              channelId: payload.channelId,
              senderId: socket.userId,
              body: payload.body,
              attachmentUrl: payload.attachmentUrl,
              sentAt: message.sent_at,
            });
            await sendPushToUsers(members.map((m) => m.user_id), {
              title: 'New message',
              body: payload.body?.slice(0, 100) ?? 'Sent an attachment',
              data: { channelId: payload.channelId, type: 'chat_message' },
            });
          }

          ack?.({ id: message.id, sentAt: message.sent_at });
        } catch (err) {
          ack?.({ error: 'send_failed' });
          console.error('chat message:send failed', err);
        }
      },
    );

    socket.on('message:read', async (payload: { channelId: string; messageId: string }) => {
      await pool.query(
        `UPDATE chat_messages SET read_by = read_by || jsonb_build_object($3, now()) WHERE id = $1 AND channel_id = $2`,
        [payload.messageId, payload.channelId, socket.userId],
      );
      await pool.query(
        `UPDATE chat_channel_members SET last_read_at = now() WHERE channel_id = $1 AND user_id = $2`,
        [payload.channelId, socket.userId],
      );
      io.to(`channel:${payload.channelId}`).emit('message:read_receipt', { ...payload, userId: socket.userId });
    });

    socket.on('typing', (payload: { channelId: string; isTyping: boolean }) => {
      socket.to(`channel:${payload.channelId}`).emit('typing', { ...payload, userId: socket.userId });
    });
  });

  return io;
}
