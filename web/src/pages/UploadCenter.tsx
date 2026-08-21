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
  location_group_id: string | null;
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
  if (err.response?.data?.error === 'file_required') return 'Choose at least one file.';
  return 'Failed to upload.';
}

/** Clusters documents that came from the same multi-file upload (shared, non-null
 * location_group_id) into one entry, so the library can render them as one connected group
 * instead of several identical-looking, seemingly-unrelated cards. */
function groupDocuments(docs: Document[]): (Document | Document[])[] {
  const seen = new Set<string>();
  const result: (Document | Document[])[] = [];
  for (const doc of docs) {
    if (!doc.location_group_id) {
      result.push(doc);
      continue;
    }
    if (seen.has(doc.location_group_id)) continue;
    seen.add(doc.location_group_id);
    result.push(docs.filter((d) => d.location_group_id === doc.location_group_id));
  }
  return result;
}

export function UploadCenter() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Production');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [viewingImage, setViewingImage] = useState<{ doc: Document; url: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');

  const { data: documents } = useQuery<Document[]>({
    queryKey: ['documents'],
    queryFn: async () => (await api.get('/documents')).data,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!files.length) throw new Error('file required');
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      form.append('title', title);
      form.append('category', category);
      if (description) form.append('description', description);
      form.append('isMap', String(category === 'Property Map'));
      // Bounded so a broken object-store connection fails with a visible error instead of the
      // button being stuck on "Uploading…" forever with nothing to tell the user what's wrong.
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setTitle('');
      setDescription('');
      setFiles([]);
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

  // Edits the whole group at once — the description describes the location/shoot, not one
  // individual file, so keeping every member in sync is the expected behavior after an edit too.
  const updateDescriptionMutation = useMutation({
    mutationFn: (params: { ids: string[]; description: string }) =>
      Promise.all(params.ids.map((id) => api.patch(`/documents/${id}`, { description: params.description }))),
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

  function startEditingDescription(groupKey: string, currentDescription: string | null) {
    setEditingId(groupKey);
    setEditDescription(currentDescription ?? '');
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
        <input
          required
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="text-sm sm:col-span-2 lg:col-span-1"
        />
        <textarea
          placeholder="Description (optional) — e.g. what each annotation color means"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2 lg:col-span-3"
        />
        {files.length > 1 && (
          <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
            {files.length} files selected — same title, category, and description will apply to all, and they'll show up grouped
            together as the same location.
          </p>
        )}
        <button type="submit" disabled={uploadMutation.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          {uploadMutation.isPending ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
        </button>
        {uploadMutation.isError && (
          <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">{uploadErrorMessage(uploadMutation.error)}</p>
        )}
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groupDocuments(documents ?? []).map((entry) =>
          Array.isArray(entry) ? (
            <GroupedDocumentCard
              key={entry[0].location_group_id}
              docs={entry}
              canManage={canManage}
              editing={editingId === entry[0].location_group_id}
              editDescription={editDescription}
              onEditDescriptionChange={setEditDescription}
              onStartEditing={() => startEditingDescription(entry[0].location_group_id!, entry[0].description)}
              onCancelEditing={() => setEditingId(null)}
              onSaveDescription={() => updateDescriptionMutation.mutate({ ids: entry.map((d) => d.id), description: editDescription })}
              savingDescription={updateDescriptionMutation.isPending}
              onOpen={(doc) => openMutation.mutate(doc)}
              onDelete={onDelete}
              deletingId={deleteMutation.isPending ? (deleteMutation.variables as string) : null}
            />
          ) : (
            <DocumentCard
              key={entry.id}
              doc={entry}
              canManage={canManage}
              editing={editingId === entry.id}
              editDescription={editDescription}
              onEditDescriptionChange={setEditDescription}
              onStartEditing={() => startEditingDescription(entry.id, entry.description)}
              onCancelEditing={() => setEditingId(null)}
              onSaveDescription={() => updateDescriptionMutation.mutate({ ids: [entry.id], description: editDescription })}
              savingDescription={updateDescriptionMutation.isPending}
              onOpen={() => openMutation.mutate(entry)}
              onDelete={() => onDelete(entry)}
              deleting={deleteMutation.isPending && deleteMutation.variables === entry.id}
            />
          ),
        )}
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

interface DescriptionEditProps {
  canManage: boolean;
  editing: boolean;
  editDescription: string;
  onEditDescriptionChange: (v: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSaveDescription: () => void;
  savingDescription: boolean;
}

function DescriptionBlock({ description, ...props }: { description: string | null } & DescriptionEditProps) {
  if (props.editing) {
    return (
      <div className="mt-2 space-y-1.5">
        <textarea
          autoFocus
          value={props.editDescription}
          onChange={(e) => props.onEditDescriptionChange(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="flex gap-1.5">
          <button
            onClick={props.onSaveDescription}
            disabled={props.savingDescription}
            className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700"
          >
            Save
          </button>
          <button onClick={props.onCancelEditing} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600">
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return description ? <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-500">{description}</p> : null;
}

function DocumentCard({
  doc,
  onOpen,
  onDelete,
  deleting,
  ...editProps
}: {
  doc: Document;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
} & DescriptionEditProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm">
      <button onClick={onOpen} className="w-full text-left">
        <div className="font-medium text-slate-900">{doc.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 uppercase">{doc.doc_type}</span>
          {doc.category && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{doc.category}</span>}
          <span>v{doc.current_version}</span>
          {IMAGE_EXTENSIONS.has(doc.doc_type.toLowerCase()) && <span className="text-brand-600">draw/highlight</span>}
        </div>
      </button>

      <DescriptionBlock description={doc.description} {...editProps} />

      <div className="mt-2 flex gap-1.5">
        {editProps.canManage && !editProps.editing && (
          <button onClick={editProps.onStartEditing} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {doc.description ? 'Edit description' : 'Add description'}
          </button>
        )}
        {editProps.canManage && (
          <button onClick={onDelete} disabled={deleting} className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/** Same-location file group: one shared title/description/category header (from the upload that
 * created them together), with each individual file still openable and deletable on its own. The
 * colored border + "Same location" label is the visible connection the files share. */
function GroupedDocumentCard({
  docs,
  onOpen,
  onDelete,
  deletingId,
  ...editProps
}: {
  docs: Document[];
  onOpen: (doc: Document) => void;
  onDelete: (doc: Document) => void;
  deletingId: string | null;
} & DescriptionEditProps) {
  const first = docs[0];
  return (
    <div className="rounded-lg border-2 border-brand-200 bg-brand-50/40 p-4 sm:col-span-2">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
        <span aria-hidden>📍</span>
        Same location · {docs.length} files
      </div>
      <div className="font-medium text-slate-900">{first.title}</div>
      {first.category && <span className="mt-1 inline-block rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">{first.category}</span>}

      <DescriptionBlock description={first.description} {...editProps} />

      {editProps.canManage && !editProps.editing && (
        <button onClick={editProps.onStartEditing} className="mt-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
          {first.description ? 'Edit description' : 'Add description'}
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {docs.map((doc) => (
          <div key={doc.id} className="rounded-md border border-slate-200 bg-white p-2">
            <button onClick={() => onOpen(doc)} className="w-full text-left">
              <div className="truncate text-xs font-medium text-slate-700 uppercase">{doc.doc_type}</div>
              <div className="text-[11px] text-slate-400">v{doc.current_version}</div>
            </button>
            {editProps.canManage && (
              <button
                onClick={() => onDelete(doc)}
                disabled={deletingId === doc.id}
                className="mt-1 w-full rounded-md border border-red-200 px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
