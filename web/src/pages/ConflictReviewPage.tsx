import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface SyncConflict {
  id: string;
  entity_type: string;
  entity_id: string;
  device_id: string;
  user_id: string | null;
  client_payload: unknown;
  server_payload: unknown;
  client_version: number;
  server_version: number;
  created_at: string;
}

/** Admin/dispatcher review queue for offline edits that couldn't merge automatically (feature 9)
 * — currently map redline layers, flagged when a device's local version trails the server's. */
export function ConflictReviewPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mergedJson, setMergedJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const { data: conflicts, isLoading } = useQuery<SyncConflict[]>({
    queryKey: ['sync-conflicts'],
    queryFn: async () => (await api.get('/sync/conflicts')).data,
    refetchInterval: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: (params: { id: string; resolution: 'client_wins' | 'server_wins' | 'merged'; resolvedPayload?: unknown }) =>
      api.post(`/sync/conflicts/${params.id}/resolve`, { resolution: params.resolution, resolvedPayload: params.resolvedPayload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-conflicts'] });
      setEditingId(null);
    },
  });

  function startMerge(conflict: SyncConflict) {
    setEditingId(conflict.id);
    setJsonError(null);
    setMergedJson(JSON.stringify(conflict.server_payload, null, 2));
  }

  function submitMerge(id: string) {
    try {
      const parsed = JSON.parse(mergedJson);
      setJsonError(null);
      resolveMutation.mutate({ id, resolution: 'merged', resolvedPayload: parsed });
    } catch {
      setJsonError('Not valid JSON — fix the syntax before resolving.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Conflict Review</h1>
        <p className="text-sm text-slate-500">
          Offline edits that couldn't merge automatically. Choose which version wins, or hand-edit a merge.
        </p>
      </div>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {!isLoading && !conflicts?.length && (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-400">
          Nothing pending — every offline edit merged cleanly.
        </p>
      )}

      <div className="space-y-4">
        {conflicts?.map((conflict) => (
          <div key={conflict.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">{conflict.entity_type}</span>
                <span className="ml-2 text-xs text-slate-400">
                  entity {conflict.entity_id.slice(0, 8)} · device {conflict.device_id} · {new Date(conflict.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => resolveMutation.mutate({ id: conflict.id, resolution: 'client_wins' })}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Use device version (v{conflict.client_version})
                </button>
                <button
                  onClick={() => resolveMutation.mutate({ id: conflict.id, resolution: 'server_wins' })}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Keep server version (v{conflict.server_version})
                </button>
                <button
                  onClick={() => startMerge(conflict)}
                  className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                >
                  Edit &amp; merge
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">Device version (v{conflict.client_version})</div>
                <pre className="max-h-48 overflow-auto rounded-md bg-slate-50 p-2 text-xs">{JSON.stringify(conflict.client_payload, null, 2)}</pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">Server version (v{conflict.server_version})</div>
                <pre className="max-h-48 overflow-auto rounded-md bg-slate-50 p-2 text-xs">{JSON.stringify(conflict.server_payload, null, 2)}</pre>
              </div>
            </div>

            {editingId === conflict.id && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <textarea
                  value={mergedJson}
                  onChange={(e) => setMergedJson(e.target.value)}
                  rows={8}
                  className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
                />
                {jsonError && <p className="mt-1 text-xs text-red-600">{jsonError}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => submitMerge(conflict.id)}
                    disabled={resolveMutation.isPending}
                    className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                  >
                    Save merged version
                  </button>
                  <button onClick={() => setEditingId(null)} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
