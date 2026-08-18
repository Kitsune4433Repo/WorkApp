import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface Document {
  id: string;
  title: string;
  doc_type: string;
  is_map: boolean;
  current_version: number;
  updated_at: string;
}

export function UploadCenter() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('map');
  const [isMap, setIsMap] = useState(true);
  const [file, setFile] = useState<File | null>(null);

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
      form.append('docType', docType);
      form.append('isMap', String(isMap));
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setTitle('');
      setFile(null);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    uploadMutation.mutate();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Resource Uploads</h1>
        <p className="text-sm text-slate-500">Add site maps, manuals, and field images to the shared library.</p>
      </div>

      <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input required placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          {['pdf', 'png', 'jpg', 'map', 'manual', 'compliance'].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isMap} onChange={(e) => setIsMap(e.target.checked)} /> Is site map
        </label>
        <input required type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <button type="submit" disabled={uploadMutation.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 lg:col-span-4">
          {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {documents?.map((doc) => (
          <div key={doc.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="font-medium text-slate-900">{doc.title}</div>
            <div className="text-xs text-slate-500">
              {doc.doc_type} · v{doc.current_version} {doc.is_map && '· map'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
