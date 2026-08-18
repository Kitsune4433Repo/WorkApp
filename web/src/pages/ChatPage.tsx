import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');

  const { data: channels } = useQuery<Channel[]>({
    queryKey: ['chat', 'channels'],
    queryFn: async () => (await api.get('/chat/channels')).data,
  });

  // Broadcast channels are open rooms an admin creates — every user (present and future) can see
  // and post in them with no per-user invite step, unlike direct/job channels.
  const createRoomMutation = useMutation({
    mutationFn: () => api.post('/chat/channels', { type: 'broadcast', name: newRoomName.trim() }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'channels'] });
      setNewRoomName('');
      setShowCreateRoom(false);
      setActiveChannelId(res.data.id);
    },
  });

  function onCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    createRoomMutation.mutate();
  }

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
    <div className="flex h-[80vh] flex-col gap-4 md:h-[calc(100vh-6rem)] md:flex-row">
      <aside className="flex max-h-40 shrink-0 flex-col overflow-y-auto rounded-lg border border-slate-200 bg-white md:h-full md:max-h-none md:w-56">
        <div className="flex overflow-x-auto md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-visible">
          {channels?.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveChannelId(c.id)}
              className={`shrink-0 whitespace-nowrap border-b border-slate-100 px-4 py-3 text-left text-sm md:block md:w-full md:whitespace-normal ${activeChannelId === c.id ? 'bg-brand-50 font-medium text-brand-700' : 'hover:bg-slate-50'}`}
            >
              {c.name ?? `${c.type} channel`}
            </button>
          ))}
        </div>
        {user?.role === 'admin' && (
          <div className="border-t border-slate-200 p-2">
            {showCreateRoom ? (
              <form onSubmit={onCreateRoom} className="space-y-2">
                <input
                  autoFocus
                  required
                  placeholder="Room name"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createRoomMutation.isPending}
                    className="flex-1 rounded-md bg-brand-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                  >
                    {createRoomMutation.isPending ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateRoom(false)}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
                {createRoomMutation.isError && <p className="text-xs text-red-600">Failed to create room.</p>}
              </form>
            ) : (
              <button
                onClick={() => setShowCreateRoom(true)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                + New room (everyone)
              </button>
            )}
          </div>
        )}
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
