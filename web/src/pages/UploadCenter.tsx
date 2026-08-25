import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
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
  job_id: string | null;
  updated_at: string;
}

interface Job {
  id: string;
  job_number: string;
  title: string;
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

// The zip is assembled on the backend and comes back as a blob — this is what actually saves it
// to disk client-side. Using a client-picked `download` name (rather than relying on the fixed
// Content-Disposition the backend sends) lets "download all" and "download selected" each get a
// filename that reflects what's actually in the zip.
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Numeric-aware ("#2" before "#10") so the list holds a stable position — sorting by recency
// (the old behavior) meant renaming, re-describing, or assigning any single resource to a job
// bumped it to the top and reshuffled the whole library on every edit.
function compareTitles(a: Document, b: Document): number {
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
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
  // Metadata is set synchronously on click (so the viewer opens instantly, before the signed URL
  // has even been requested) — the URL itself comes from a react-query keyed on the doc, which
  // caches it and lets neighbors be prefetched (see the effect below) for near-instant swiping.
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignJobSelect, setAssignJobSelect] = useState('');
  // 'all' | 'unassigned' | a job id — lets anyone browse the library scoped to one job's resources.
  const [jobFilter, setJobFilter] = useState('all');

  const { data: documents } = useQuery<Document[]>({
    queryKey: ['documents'],
    queryFn: async () => (await api.get('/documents')).data,
  });

  // Available to every role, not just admin/crew_lead — filtering by job is a read-only view,
  // separate from the (manage-only) ability to assign a resource to one.
  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: async () => (await api.get('/jobs')).data,
    enabled: !!user,
  });
  const jobsById = new Map((jobs ?? []).map((j) => [j.id, j]));

  const visibleDocuments = [...(documents ?? [])]
    .sort(compareTitles)
    .filter((doc) => {
      if (jobFilter === 'all') return true;
      if (jobFilter === 'unassigned') return !doc.job_id;
      return doc.job_id === jobFilter;
    });

  // The swipeable gallery is exactly the images currently on screen, in the same order — flat even
  // though the cards above cluster some of them into "same location" groups, since groupDocuments
  // only reshapes how they're rendered, not the underlying (already title-sorted) array.
  const imageGallery = visibleDocuments.filter((d) => IMAGE_EXTENSIONS.has(d.doc_type.toLowerCase()));
  const viewingIndex = viewingDoc ? imageGallery.findIndex((d) => d.id === viewingDoc.id) : -1;
  const nextDoc = viewingIndex >= 0 ? imageGallery[viewingIndex + 1] : undefined;
  const prevDoc = viewingIndex >= 1 ? imageGallery[viewingIndex - 1] : undefined;

  function downloadUrlQueryKey(doc: Document) {
    return ['documents', doc.id, 'download', doc.current_version];
  }

  const { data: viewingUrl } = useQuery({
    queryKey: viewingDoc ? downloadUrlQueryKey(viewingDoc) : ['documents', 'none'],
    queryFn: async () => (await api.get(`/documents/${viewingDoc!.id}/download`)).data.url as string,
    enabled: !!viewingDoc,
  });

  // Warms the cache for whichever image a swipe/arrow-key would land on next, so the common case —
  // moving one step at a time through the gallery — feels instant instead of waiting on a fresh
  // signed-URL round trip (and the image itself re-downloading) on every step.
  useEffect(() => {
    for (const doc of [nextDoc, prevDoc]) {
      if (!doc) continue;
      queryClient.prefetchQuery({
        queryKey: downloadUrlQueryKey(doc),
        queryFn: async () => (await api.get(`/documents/${doc.id}/download`)).data.url as string,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextDoc?.id, prevDoc?.id]);

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
      // Scales with file count — several phone photos over cellular can legitimately take a while
      // even when nothing's broken, and a flat short timeout would misreport that as "stuck".
      const timeout = 60_000 + (files.length - 1) * 30_000;
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setTitle('');
      setDescription('');
      setFiles([]);
    },
  });

  // Non-image files (PDFs, etc.) still need a resolved URL before a new tab can even be opened —
  // there's no gallery to make "instant" for those, so this one-off round trip is unavoidable.
  const openFileMutation = useMutation({
    mutationFn: async (doc: Document) => (await api.get(`/documents/${doc.id}/download`)).data.url as string,
    onSuccess: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
  });

  function openDoc(doc: Document) {
    if (IMAGE_EXTENSIONS.has(doc.doc_type.toLowerCase())) setViewingDoc(doc);
    else openFileMutation.mutate(doc);
  }

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => api.delete(`/documents/${documentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  // Edits the whole group at once — the title/description describe the location/shoot, not one
  // individual file, so keeping every member in sync is the expected behavior after an edit too.
  const updateMetadataMutation = useMutation({
    mutationFn: (params: { ids: string[]; title: string; description: string }) =>
      Promise.all(params.ids.map((id) => api.patch(`/documents/${id}`, { title: params.title, description: params.description }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setEditingId(null);
    },
  });

  const assignJobMutation = useMutation({
    mutationFn: (params: { ids: string[]; jobId: string | null }) =>
      Promise.all(params.ids.map((id) => api.patch(`/documents/${id}`, { jobId: params.jobId }))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  // Available to every role — downloading is a read action, same as the existing per-file "Open".
  // Bounded generously (unlike the upload timeout) since the backend is streaming a zip of
  // potentially many, possibly large files, not a single request/response round trip.
  const downloadMutation = useMutation({
    mutationFn: async (params: { ids: string[]; filename: string }) => {
      const response = await api.post(
        '/documents/zip',
        { documentIds: params.ids },
        { responseType: 'blob', timeout: 5 * 60_000 },
      );
      return { blob: response.data as Blob, filename: params.filename };
    },
    onSuccess: ({ blob, filename }) => triggerBlobDownload(blob, filename),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    uploadMutation.mutate();
  }

  // Adds to the existing selection rather than replacing it — a phone's file picker often launches
  // the camera, which only ever returns one photo per tap, so building a multi-file batch means
  // reopening the picker repeatedly. Resetting the input's value afterward makes that work even
  // when the same filename comes back twice (some browsers won't fire onChange otherwise).
  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
    e.target.value = '';
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function onDelete(doc: Document) {
    if (window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) {
      deleteMutation.mutate(doc.id);
    }
  }

  function startEditing(groupKey: string, currentTitle: string, currentDescription: string | null) {
    setEditingId(groupKey);
    setEditTitle(currentTitle);
    setEditDescription(currentDescription ?? '');
  }

  // A group's checkbox toggles every member id together — checked only once ALL of them are
  // already selected, so a partially-selected group still reads as "click to select the rest".
  function toggleSelection(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function assignSelectedToJob() {
    if (!assignJobSelect) return;
    assignJobMutation.mutate(
      { ids: [...selectedIds], jobId: assignJobSelect },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setAssignJobSelect('');
        },
      },
    );
  }

  function downloadSelected() {
    downloadMutation.mutate({ ids: [...selectedIds], filename: `resources-${selectedIds.size}-selected.zip` });
  }

  // Downloads whatever is currently visible — respecting the job filter, so "download all" scoped
  // to one job just downloads that job's resources instead of everything in the library.
  function downloadVisible() {
    const filename =
      jobFilter === 'all' ? 'resources-all.zip' : jobFilter === 'unassigned' ? 'resources-unassigned.zip' : `resources-${jobsById.get(jobFilter)?.job_number ?? jobFilter}.zip`;
    downloadMutation.mutate({ ids: visibleDocuments.map((d) => d.id), filename });
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
        <div className="sm:col-span-2 lg:col-span-1">
          <input id="upload-file-input" type="file" multiple onChange={onPickFiles} className="hidden" />
          <label
            htmlFor="upload-file-input"
            className="inline-block w-full cursor-pointer rounded-md border border-slate-300 px-3 py-2 text-center text-sm text-slate-600 hover:bg-slate-50"
          >
            {files.length ? 'Add another file' : 'Choose file(s)'}
          </label>
        </div>
        <textarea
          placeholder="Description (optional) — e.g. what each annotation color means"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2 lg:col-span-3"
        />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 sm:col-span-2 lg:col-span-4">
            {files.map((f, i) => (
              <span key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                {f.name}
                <button type="button" onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="font-bold text-slate-400 hover:text-red-600">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {files.length > 1 && (
          <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
            {files.length} files selected — same title, category, and description will apply to all, and they'll show up grouped
            together as the same location. On a phone, tap "Add another file" once per photo — your camera only hands back one
            at a time.
          </p>
        )}
        <button type="submit" disabled={uploadMutation.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          {uploadMutation.isPending ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
        </button>
        {uploadMutation.isError && (
          <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">{uploadErrorMessage(uploadMutation.error)}</p>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="job-filter" className="text-sm font-medium text-slate-600">
          Filter by job
        </label>
        <select
          id="job-filter"
          value={jobFilter}
          onChange={(e) => setJobFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="all">All resources</option>
          <option value="unassigned">Unassigned</option>
          {jobs?.map((j) => (
            <option key={j.id} value={j.id}>
              {j.job_number} — {j.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!visibleDocuments.length || downloadMutation.isPending}
          onClick={downloadVisible}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {downloadMutation.isPending ? 'Zipping…' : `Download ${jobFilter === 'all' ? 'all' : 'these'} (${visibleDocuments.length})`}
        </button>
        {downloadMutation.isError && <span className="text-xs text-red-600">Download failed — try again.</span>}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-800">{selectedIds.size} selected</span>
          <button
            type="button"
            disabled={downloadMutation.isPending}
            onClick={downloadSelected}
            className="rounded-md border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            {downloadMutation.isPending ? 'Zipping…' : 'Download selected'}
          </button>
          {canManage && (
            <>
              <select
                value={assignJobSelect}
                onChange={(e) => setAssignJobSelect(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Assign to job…</option>
                {jobs?.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_number} — {j.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!assignJobSelect || assignJobMutation.isPending}
                onClick={assignSelectedToJob}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Assign
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Cancel selection
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groupDocuments(visibleDocuments).map((entry) =>
          Array.isArray(entry) ? (
            <GroupedDocumentCard
              key={entry[0].location_group_id}
              docs={entry}
              canManage={canManage}
              editing={editingId === entry[0].location_group_id}
              editTitle={editTitle}
              editDescription={editDescription}
              onEditTitleChange={setEditTitle}
              onEditDescriptionChange={setEditDescription}
              onStartEditing={() => startEditing(entry[0].location_group_id!, entry[0].title, entry[0].description)}
              onCancelEditing={() => setEditingId(null)}
              onSave={() => updateMetadataMutation.mutate({ ids: entry.map((d) => d.id), title: editTitle, description: editDescription })}
              saving={updateMetadataMutation.isPending}
              onOpen={openDoc}
              onDelete={onDelete}
              deletingId={deleteMutation.isPending ? (deleteMutation.variables as string) : null}
              selected={entry.every((d) => selectedIds.has(d.id))}
              onToggleSelect={() => toggleSelection(entry.map((d) => d.id))}
              job={entry[0].job_id ? jobsById.get(entry[0].job_id) : undefined}
              onUnassign={() => assignJobMutation.mutate({ ids: entry.map((d) => d.id), jobId: null })}
            />
          ) : (
            <DocumentCard
              key={entry.id}
              doc={entry}
              canManage={canManage}
              editing={editingId === entry.id}
              editTitle={editTitle}
              editDescription={editDescription}
              onEditTitleChange={setEditTitle}
              onEditDescriptionChange={setEditDescription}
              onStartEditing={() => startEditing(entry.id, entry.title, entry.description)}
              onCancelEditing={() => setEditingId(null)}
              onSave={() => updateMetadataMutation.mutate({ ids: [entry.id], title: editTitle, description: editDescription })}
              saving={updateMetadataMutation.isPending}
              onOpen={() => openDoc(entry)}
              onDelete={() => onDelete(entry)}
              deleting={deleteMutation.isPending && deleteMutation.variables === entry.id}
              selected={selectedIds.has(entry.id)}
              onToggleSelect={() => toggleSelection([entry.id])}
              job={entry.job_id ? jobsById.get(entry.job_id) : undefined}
              onUnassign={() => assignJobMutation.mutate({ ids: [entry.id], jobId: null })}
            />
          ),
        )}
        {!visibleDocuments.length && (
          <p className="text-slate-400">
            {documents?.length ? 'No resources match this job filter.' : 'Nothing uploaded yet.'}
          </p>
        )}
      </div>

      {viewingDoc && user && (
        <ImageAnnotationViewer
          documentId={viewingDoc.id}
          documentVersion={viewingDoc.current_version}
          title={viewingDoc.title}
          description={viewingDoc.description}
          imageUrl={viewingUrl ?? null}
          currentUserId={user.id}
          onClose={() => setViewingDoc(null)}
          onNext={nextDoc ? () => setViewingDoc(nextDoc) : undefined}
          onPrev={prevDoc ? () => setViewingDoc(prevDoc) : undefined}
          position={viewingIndex >= 0 ? { index: viewingIndex, total: imageGallery.length } : undefined}
        />
      )}
    </div>
  );
}

interface MetadataEditProps {
  canManage: boolean;
  editing: boolean;
  editTitle: string;
  editDescription: string;
  onEditTitleChange: (v: string) => void;
  onEditDescriptionChange: (v: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  saving: boolean;
}

/** Renders either the title + description as plain text, or (while editing) a form for both —
 * renaming and re-describing are the same "edit details" action, since both describe what this
 * resource (or, for a group, this location) is. */
function MetadataBlock({ description, ...props }: { description: string | null } & MetadataEditProps) {
  if (props.editing) {
    return (
      <div className="mt-2 space-y-1.5">
        <input
          autoFocus
          value={props.editTitle}
          onChange={(e) => props.onEditTitleChange(e.target.value)}
          placeholder="Title"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium"
        />
        <textarea
          value={props.editDescription}
          onChange={(e) => props.onEditDescriptionChange(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="flex gap-1.5">
          <button
            onClick={props.onSave}
            disabled={props.saving || !props.editTitle.trim()}
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

/** Small pill showing the job a resource is assigned to, with a one-tap way to unassign it. */
function JobChip({ job, canManage, onUnassign }: { job: Job | undefined; canManage: boolean; onUnassign: () => void }) {
  if (!job) return null;
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
      {job.job_number} — {job.title}
      {canManage && (
        <button type="button" onClick={onUnassign} aria-label={`Remove from job ${job.job_number}`} className="font-bold text-emerald-500 hover:text-red-600">
          ×
        </button>
      )}
    </span>
  );
}

function DocumentCard({
  doc,
  onOpen,
  onDelete,
  deleting,
  selected,
  onToggleSelect,
  job,
  onUnassign,
  ...editProps
}: {
  doc: Document;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  job: Job | undefined;
  onUnassign: () => void;
} & MetadataEditProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm">
      {editProps.editing ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 uppercase">{doc.doc_type}</span>
          {doc.category && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{doc.category}</span>}
          <span>v{doc.current_version}</span>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${doc.title}`}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
          />
          <button onClick={onOpen} className="w-full text-left">
            <div className="font-medium text-slate-900">{doc.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 uppercase">{doc.doc_type}</span>
              {doc.category && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{doc.category}</span>}
              <span>v{doc.current_version}</span>
              {IMAGE_EXTENSIONS.has(doc.doc_type.toLowerCase()) && <span className="text-brand-600">draw/highlight</span>}
            </div>
          </button>
        </div>
      )}

      <JobChip job={job} canManage={editProps.canManage} onUnassign={onUnassign} />
      <MetadataBlock description={doc.description} {...editProps} />

      <div className="mt-2 flex gap-1.5">
        {editProps.canManage && !editProps.editing && (
          <button onClick={editProps.onStartEditing} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Rename / edit
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
  selected,
  onToggleSelect,
  job,
  onUnassign,
  ...editProps
}: {
  docs: Document[];
  onOpen: (doc: Document) => void;
  onDelete: (doc: Document) => void;
  deletingId: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  job: Job | undefined;
  onUnassign: () => void;
} & MetadataEditProps) {
  const first = docs[0];
  return (
    <div className="rounded-lg border-2 border-brand-200 bg-brand-50/40 p-4 sm:col-span-2">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
        <span aria-hidden>📍</span>
        Same location · {docs.length} files
      </div>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${first.title} group`}
          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
        />
        <div>
          {!editProps.editing && <div className="font-medium text-slate-900">{first.title}</div>}
          {first.category && <span className="mt-1 inline-block rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">{first.category}</span>}
        </div>
      </div>

      <JobChip job={job} canManage={editProps.canManage} onUnassign={onUnassign} />
      <MetadataBlock description={first.description} {...editProps} />

      {editProps.canManage && !editProps.editing && (
        <button onClick={editProps.onStartEditing} className="mt-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
          Rename / edit
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
