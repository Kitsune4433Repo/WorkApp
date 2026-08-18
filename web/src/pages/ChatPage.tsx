import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { v4 as uuid } from 'uuid';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useChatSocket } from '../hooks/useChatSocket';

interface Channel {
  id: string;
  type: string;
  name: string | null;
  job_id: string | null;
}

export function ChatPage() {
  const { user } = useAuth();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const { data: channels } = useQuery<Channel[]>({
    queryKey: ['chat', 'channels'],
    queryFn: async () => (await api.get('/chat/channels')).data,
  });

  const { messages, sendMessage, setInitialMessages } = useChatSocket(activeChannelId);

  useEffect(() => {
    if (!activeChannelId) return;
    api.get(`/chat/channels/${activeChannelId}/messages`).then((r) => setInitialMessages(r.data));
  }, [activeChannelId]);

  function onSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    sendMessage(draft.trim(), uuid());
    setDraft('');
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-4">
      <aside className="w-56 shrink-0 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {channels?.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveChannelId(c.id)}
            className={`block w-full border-b border-slate-100 px-4 py-3 text-left text-sm ${activeChannelId === c.id ? 'bg-brand-50 font-medium text-brand-700' : 'hover:bg-slate-50'}`}
          >
            {c.name ?? `${c.type} channel`}
          </button>
        ))}
      </aside>

      <div className="flex flex-1 flex-col rounded-lg border border-slate-200 bg-white">
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {messages.map((m) => (
            <div key={m.id} className={`max-w-md rounded-lg px-3 py-2 text-sm ${m.senderId === user?.id ? 'ml-auto bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
              {m.body}
            </div>
          ))}
          {!activeChannelId && <p className="text-slate-400">Select a channel to start messaging.</p>}
        </div>
        {activeChannelId && (
          <form onSubmit={onSend} className="flex gap-2 border-t border-slate-200 p-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message dispatch or crew…"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Send
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
