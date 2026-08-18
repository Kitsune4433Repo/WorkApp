import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { v4 as uuid } from 'uuid';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface HaveRow {
  material_id: string;
  name: string;
  unit: string;
  quantity_have: number;
}

export function InventoryLedger() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: have } = useQuery<HaveRow[]>({
    queryKey: ['inventory', 'have', user?.id],
    queryFn: async () => (await api.get(`/inventory/have/${user!.id}`)).data,
    enabled: !!user,
  });

  const adjustMutation = useMutation({
    mutationFn: (params: { materialId: string; delta: number }) =>
      api.post('/inventory/have/adjust', {
        materialId: params.materialId,
        delta: params.delta,
        clientTxnId: uuid(),
        occurredAt: new Date().toISOString(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'have', user?.id] }),
  });

  const removeMutation = useMutation({
    mutationFn: (materialId: string) => api.delete(`/inventory/catalog/${materialId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'have', user?.id] }),
  });

  const canManageCatalog = user?.role === 'admin' || user?.role === 'dispatcher' || user?.role === 'crew_lead';

  function onRemove(row: HaveRow) {
    if (window.confirm(`Remove "${row.name}" from the material catalog? This won't affect past usage history.`)) {
      removeMutation.mutate(row.material_id);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Material Ledger</h1>
        <p className="text-sm text-slate-500">What you have on hand. Use +/- to adjust as material is used or restocked.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {have?.map((row) => (
          <div key={row.material_id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
            <div className="font-medium text-slate-900">{row.name}</div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => adjustMutation.mutate({ materialId: row.material_id, delta: -1 })}
                className="h-8 w-8 rounded-full border border-slate-300 text-lg font-bold text-slate-600 hover:bg-slate-100"
              >
                −
              </button>
              <span className="w-14 text-center font-semibold">
                {row.quantity_have} {row.unit}
              </span>
              <button
                onClick={() => adjustMutation.mutate({ materialId: row.material_id, delta: 1 })}
                className="h-8 w-8 rounded-full border border-slate-300 text-lg font-bold text-slate-600 hover:bg-slate-100"
              >
                +
              </button>
              {canManageCatalog && (
                <button
                  onClick={() => onRemove(row)}
                  disabled={removeMutation.isPending}
                  className="ml-1 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
        {!have?.length && <p className="text-slate-400">No materials tracked yet.</p>}
      </div>

      <AddMaterialForm />
    </div>
  );
}

function AddMaterialForm() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', category: '' });

  const createMutation = useMutation({
    mutationFn: () => api.post('/inventory/catalog', { ...form, unit: 'unit' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'have', user?.id] });
      setForm({ name: '', category: '' });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4">
      <h2 className="col-span-full text-sm font-semibold text-slate-700">Add material to catalog</h2>
      <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input required placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <button type="submit" disabled={createMutation.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
        {createMutation.isPending ? 'Adding…' : 'Add'}
      </button>
      {createMutation.isError && <p className="col-span-full text-sm text-red-600">Failed to add material.</p>}
    </form>
  );
}
