import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface Article {
  id: string;
  title: string;
  category: string;
  tags: string[];
  snippet: string;
}

export function KnowledgeBasePage() {
  const [query, setQuery] = useState('');

  const { data: results } = useQuery<Article[]>({
    queryKey: ['knowledge-base', query],
    queryFn: async () => (await api.get('/knowledge-base/search', { params: { q: query } })).data,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Knowledge Base</h1>
        <p className="text-sm text-slate-500">Splicing diagrams, equipment manuals, and compliance documentation.</p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search articles…"
        className="w-full max-w-lg rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />

      <div className="space-y-3">
        {results?.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">{a.title}</h3>
              <span className="text-xs text-slate-400">{a.category}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: a.snippet }} />
          </div>
        ))}
        {!results?.length && <p className="text-slate-400">No matching articles.</p>}
      </div>
    </div>
  );
}
