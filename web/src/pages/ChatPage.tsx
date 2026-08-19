import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { v4 as uuid } from 'uuid';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ChatMessage, useChatSocket } from '../hooks/useChatSocket';

interface Channel {
  id: string;
  type: string;
  name: string | null;
  job_id: string | null;
  created_by: string | null;
}

interface ChatMessageRow {
  id: string;
  sender_id: string;
  sender_full_name: string | null;
  body: string | null;
  attachment_url: string | null;
  sent_at: string;
}

function toChatMessage(row: ChatMessageRow, channelId: string): ChatMessage {
  return {
    id: row.id,
    channelId,
    senderId: row.sender_id,
    senderFullName: row.sender_full_name,
    body: row.body ?? undefined,
    attachmentUrl: row.attachment_url ?? undefined,
    sentAt: row.sent_at,
  };
}

/** Resolves an attachment's storage key to a short-lived signed URL just before display — the key
 * itself (what's actually stored on the message) never expires, but a signed URL does. */
function ChatAttachmentImage({ attachmentKey }: { attachmentKey: string }) {
  const { data } = useQuery({
    queryKey: ['chat', 'attachment-url', attachmentKey],
    queryFn: async () => (await api.get('/chat/attachments/sign', { params: { key: attachmentKey } })).data.url as string,
    staleTime: 30 * 60 * 1000,
  });
  if (!data) return <div className="h-32 w-32 animate-pulse rounded-md bg-slate-200" />;
  return <img src={data} alt="Attachment" className="max-h-64 max-w-full rounded-md" />;
}

export function ChatPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: channels } = useQuery<Channel[]>({
    queryKey: ['chat', 'channels'],
    queryFn: async () => (await api.get('/chat/channels')).data,
    refetchInterval: 30_000,
  });
  const activeChannel = channels?.find((c) => c.id === activeChannelId);
  const canDeleteActiveChannel = !!activeChannel && (user?.role === 'admin' || activeChannel.created_by === user?.id);

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

  const deleteRoomMutation = useMutation({
    mutationFn: (channelId: string) => api.delete(`/chat/channels/${channelId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'channels'] });
      setActiveChannelId(null);
    },
  });

  function onCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    createRoomMutation.mutate();
  }

  function onDeleteRoom() {
    if (!activeChannelId) return;
    if (!window.confirm('Delete this room for everyone? This cannot be undone.')) return;
    deleteRoomMutation.mutate(activeChannelId);
  }

  const { messages, sendMessage, setInitialMessages } = useChatSocket(activeChannelId);

  useEffect(() => {
    if (!activeChannelId) return;
    api
      .get(`/chat/channels/${activeChannelId}/messages`)
      .then((r) => setInitialMessages((r.data as ChatMessageRow[]).map((row) => toChatMessage(row, activeChannelId))));
  }, [activeChannelId]);

  const uploadPhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (await api.post('/chat/attachments', form, { headers: { 'Content-Type': 'multipart/form-data' } })).data.key as string;
    },
  });

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() && !pendingPhoto) return;
    const attachmentKey = pendingPhoto ? await uploadPhotoMutation.mutateAsync(pendingPhoto) : undefined;
    sendMessage(draft.trim(), uuid(), attachmentKey);
    setDraft('');
    setPendingPhoto(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onPickPhoto(e: ChangeEvent<HTMLInputElement>) {
    setPendingPhoto(e.target.files?.[0] ?? null);
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
        {activeChannel && (
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
            <span className="text-sm font-medium text-slate-700">{activeChannel.name ?? `${activeChannel.type} channel`}</span>
            {canDeleteActiveChannel && (
              <button
                onClick={onDeleteRoom}
                disabled={deleteRoomMutation.isPending}
                className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                {deleteRoomMutation.isPending ? 'Deleting…' : 'Delete room'}
              </button>
            )}
          </div>
        )}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((m) => {
            const isMine = m.senderId === user?.id;
            return (
              <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                {!isMine && m.senderFullName && <span className="mb-0.5 px-1 text-xs font-medium text-slate-500">{m.senderFullName}</span>}
                <div className={`max-w-md space-y-2 rounded-lg px-3 py-2 text-sm ${isMine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {m.attachmentUrl && <ChatAttachmentImage attachmentKey={m.attachmentUrl} />}
                  {m.body && <div>{m.body}</div>}
                </div>
              </div>
            );
          })}
          {!activeChannelId && <p className="text-slate-400">Select a channel to start messaging.</p>}
        </div>
        {activeChannelId && (
          <form onSubmit={onSend} className="space-y-2 border-t border-slate-200 p-3">
            {pendingPhoto && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>📎 {pendingPhoto.name}</span>
                <button type="button" onClick={() => { setPendingPhoto(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-red-600 hover:underline">
                  Remove
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" id="chat-photo-input" />
              <label
                htmlFor="chat-photo-input"
                className="flex cursor-pointer items-center rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                title="Attach a photo"
              >
                📷
              </label>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message dispatch or crew…"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={uploadPhotoMutation.isPending}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                {uploadPhotoMutation.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
