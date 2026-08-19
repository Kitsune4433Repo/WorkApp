import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_ORIGIN } from '../api/config';

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderFullName?: string | null;
  body?: string;
  attachmentUrl?: string;
  sentAt: string;
}

export function useChatSocket(channelId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const socket = io(SOCKET_ORIGIN, { path: '/ws/chat', auth: { token: localStorage.getItem('accessToken') } });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !channelId) return;

    socket.emit('channel:join', channelId);
    setMessages([]);

    const onNew = (msg: ChatMessage) => {
      if (msg.channelId === channelId) setMessages((prev) => [...prev, msg]);
    };
    socket.on('message:new', onNew);
    return () => {
      socket.off('message:new', onNew);
    };
  }, [channelId]);

  function sendMessage(body: string, clientMsgId: string, attachmentUrl?: string) {
    if (!channelId) return;
    socketRef.current?.emit('message:send', { channelId, body, clientMsgId, attachmentUrl });
  }

  function setInitialMessages(initial: ChatMessage[]) {
    setMessages(initial);
  }

  return { messages, sendMessage, setInitialMessages };
}
