import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ImageAnnotationViewer } from '../components/ImageAnnotationViewer';

interface Document {
  id: string;
  title: string;
  doc_type: string;
  category: string | null;
  description: string | null;
  is_map: boolean;
  current_version: number;
  updated_at: string;
}

const CATEGORIES = ['Production', 'Property Map'] as const;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);
const MANAGE_ROLES = ['admin', 'crew_lead'];

// Surfaces the backend's specific reason (e.g. "object storage isn't configured") instead of a
// generic "Failed to upload" — the only diagnostic available on a live deploy without shell/log access.
function uploadErrorMessage(error: unknown): string {
  const err = error as { code?: string; response?: { data?: { error?: string; details?: { message?: string } } } };
  if (err.code === 'ECONNABORTED') return 'Upload timed out — the object storage endpoint may be unreachable.';
  const detail = err.response?.data?.details?.message;
  if (detail) return detail;
  if (err.response?.data?.error === 'file_required') return 'Choose a file first.';
  return 'Failed to upload.';
}

// Any file type is allowed — this just labels what was uploaded, derived from the file itself
// rather than asked of the user.
function deriveDocType(file: File): string {
  const extMatch = /\.([a-z0-9]+)$/i.exec(file.name);
  if (extMatch) return extMatch[1].toLowerCase();
  const subtype = file.type.split('/')[1];
  return subtype || 'file';
}

export function UploadCenter() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Production');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [viewingImage, setViewingImage] = useState<{ doc: Document; url: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');

  const { data: documents } = useQuery<Document[]>({
    queryKey: ['documents'],
    queryFn: async () => (await api.get('/documents')).data,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('file required');
      const form = new FormData();
      form.append('file', file);
      form.append('title', title);
      form.append('docType', deriveDocType(file));
      form.append('category', category);
      if (description) form.append('description', description);
      form.append('isMap', String(category === 'Property Map'));
      // Bounded so a broken object-store connection fails with a visible error instead of the
      // button being stuck on "Uploading…" forever with nothing to tell the user what's wrong.
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 45_000 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setTitle('');
      setDescription('');
      setFile(null);
    },
  });

  const openMutation = useMutation({
    mutationFn: async (doc: Document) => ({ doc, url: (await api.get(`/documents/${doc.id}/download`)).data.url as string }),
    onSuccess: ({ doc, url }) => {
      if (IMAGE_EXTENSIONS.has(doc.doc_type.toLowerCase())) setViewingImage({ doc, url });
      else window.open(url, '_blank', 'noopener,noreferrer');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => api.delete(`/documents/${documentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: string; description: string }) => api.patch(`/documents/${params.id}`, { description: params.description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setEditingId(null);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    uploadMutation.mutate();
  }

  function onDelete(doc: Document) {
    if (window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) {
      deleteMutation.mutate(doc.id);
    }
  }

  function startEditingDescription(doc: Document) {
    setEditingId(doc.id);
    setEditDescription(doc.description ?? '');
  }

  const canManage = !!user && MANAGE_ROLES.includes(user.role);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Resource Library</h1>
        <p className="text-sm text-slate-500">Upload site maps, photos, and other job files — any file type is accepted.</p>
      </div>

      <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input required placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <select value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input required type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm sm:col-span-2 lg:col-span-1" />
        <textarea
          placeholder="Description (optional) — e.g. what each annotation color means"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2 lg:col-span-3"
        />
        <button type="submit" disabled={uploadMutation.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
        </button>
        {uploadMutation.isError && (
          <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">{uploadErrorMessage(uploadMutation.error)}</p>
        )}
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {documents?.map((doc) => (
          <div key={doc.id} className="rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm">
            <button onClick={() => openMutation.mutate(doc)} className="w-full text-left">
              <div className="font-medium text-slate-900">{doc.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 uppercase">{doc.doc_type}</span>
                {doc.category && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{doc.category}</span>}
                <span>v{doc.current_version}</span>
                {IMAGE_EXTENSIONS.has(doc.doc_type.toLowerCase()) && <span className="text-brand-600">draw/highlight</span>}
              </div>
            </button>

            {editingId === doc.id ? (
              <div className="mt-2 space-y-1.5">
                <textarea
                  autoFocus
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={() => updateMutation.mutate({ id: doc.id, description: editDescription })}
                    disabled={updateMutation.isPending}
                    className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700"
                  >
                    Save
                  </button>
                  <button onClick={() => setEditingId(null)} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              doc.description && <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-500">{doc.description}</p>
            )}

            <div className="mt-2 flex gap-1.5">
              {canManage && editingId !== doc.id && (
                <button onClick={() => startEditingDescription(doc)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  {doc.description ? 'Edit description' : 'Add description'}
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => onDelete(doc)}
                  disabled={deleteMutation.isPending}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {!documents?.length && <p className="text-slate-400">Nothing uploaded yet.</p>}
      </div>

      {viewingImage && user && (
        <ImageAnnotationViewer
          documentId={viewingImage.doc.id}
          documentVersion={viewingImage.doc.current_version}
          title={viewingImage.doc.title}
          description={viewingImage.doc.description}
          imageUrl={viewingImage.url}
          currentUserId={user.id}
          onClose={() => setViewingImage(null)}
        />
      )}
    </div>
  );
}
