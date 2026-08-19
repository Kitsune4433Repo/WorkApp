import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { v4 as uuid } from 'uuid';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { QuantityStepper } from '../components/QuantityStepper';

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

  const canManageCatalog = user?.role === 'admin' || user?.role === 'crew_lead';

  function onRemove(row: HaveRow) {
    if (window.confirm(`Remove "${row.name}" from the material catalog? This won't affect past usage history.`)) {
      removeMutation.mutate(row.material_id);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Material Ledger</h1>
        <p className="text-sm text-slate-500">What you have on hand. Use +/- to adjust by one, or click the number to type an exact amount.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {have?.map((row) => (
          <MaterialRow
            key={row.material_id}
            row={row}
            onAdjust={(delta) => adjustMutation.mutate({ materialId: row.material_id, delta })}
            onRemove={canManageCatalog ? () => onRemove(row) : undefined}
            removing={removeMutation.isPending}
          />
        ))}
        {!have?.length && <p className="text-slate-400">No materials tracked yet.</p>}
      </div>

      <AddMaterialForm />
    </div>
  );
}

function MaterialRow({
  row,
  onAdjust,
  onRemove,
  removing,
}: {
  row: HaveRow;
  onAdjust: (delta: number) => void;
  onRemove?: () => void;
  removing: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <div className="font-medium text-slate-900">{row.name}</div>
      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper
          value={Number(row.quantity_have)}
          unit={row.unit}
          onDecrement={() => onAdjust(-1)}
          onIncrement={() => onAdjust(1)}
          onDirectEdit={(next) => onAdjust(next - Number(row.quantity_have))}
        />
        {onRemove && (
          <button
            onClick={onRemove}
            disabled={removing}
            className="ml-1 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        )}
      </div>
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
