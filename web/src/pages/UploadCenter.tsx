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
  is_map: boolean;
  current_version: number;
  updated_at: string;
}

const CATEGORIES = ['Production', 'Property Map'] as const;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);

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
  const [file, setFile] = useState<File | null>(null);
  const [viewingImage, setViewingImage] = useState<{ doc: Document; url: string } | null>(null);

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
      form.append('isMap', String(category === 'Property Map'));
      // Bounded so a broken object-store connection fails with a visible error instead of the
      // button being stuck on "Uploading…" forever with nothing to tell the user what's wrong.
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 45_000 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setTitle('');
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

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    uploadMutation.mutate();
  }

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
        <button type="submit" disabled={uploadMutation.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
        </button>
        {uploadMutation.isError && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">Failed to upload.</p>}
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {documents?.map((doc) => (
          <button
            key={doc.id}
            onClick={() => openMutation.mutate(doc)}
            className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-brand-300 hover:shadow-sm"
          >
            <div className="font-medium text-slate-900">{doc.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 uppercase">{doc.doc_type}</span>
              {doc.category && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{doc.category}</span>}
              <span>v{doc.current_version}</span>
              {IMAGE_EXTENSIONS.has(doc.doc_type.toLowerCase()) && <span className="text-brand-600">draw/highlight</span>}
            </div>
          </button>
        ))}
        {!documents?.length && <p className="text-slate-400">Nothing uploaded yet.</p>}
      </div>

      {viewingImage && user && (
        <ImageAnnotationViewer
          documentId={viewingImage.doc.id}
          documentVersion={viewingImage.doc.current_version}
          title={viewingImage.doc.title}
          imageUrl={viewingImage.url}
          currentUserId={user.id}
          onClose={() => setViewingImage(null)}
        />
      )}
    </div>
  );
}
