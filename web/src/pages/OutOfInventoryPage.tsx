import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { QuantityStepper } from '../components/QuantityStepper';

interface RestockItem {
  id: string;
  material_id: string | null;
  item_name: string;
  unit: string;
  quantity_needed: number;
  note: string | null;
  requested_by: string | null;
  created_at: string;
}

/** Same shape as the Material Ledger, but for what's missing rather than what's on hand — a shared
 * running list of things to buy or replace. Anyone can add to it, adjust the amount needed, or clear
 * an item once it's been restocked; it isn't tied to a specific job or technician. */
export function OutOfInventoryPage() {
  const queryClient = useQueryClient();

  const { data: items } = useQuery<RestockItem[]>({
    queryKey: ['inventory', 'restock'],
    queryFn: async () => (await api.get('/inventory/restock')).data,
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: string; quantityNeeded: number }) =>
      api.patch(`/inventory/restock/${params.id}`, { quantityNeeded: params.quantityNeeded }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'restock'] }),
  });

  // "Restocked" used to just clear the request — the material never actually landed anywhere.
  // Now it credits the quantity to whoever's fulfilling it, so it shows up in their Material Ledger.
  const fulfillMutation = useMutation({
    mutationFn: (id: string) => api.post(`/inventory/restock/${id}/fulfill`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'restock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'have'] });
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Out Of Inventory</h1>
        <p className="text-sm text-slate-500">Materials to buy or replace. Clear an item once it's restocked.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((item) => (
          <RestockRow
            key={item.id}
            item={item}
            onSetQuantity={(quantityNeeded) => updateMutation.mutate({ id: item.id, quantityNeeded })}
            onRestocked={() => fulfillMutation.mutate(item.id)}
            restocking={fulfillMutation.isPending}
          />
        ))}
        {!items?.length && <p className="text-slate-400">Nothing flagged as out of stock.</p>}
      </div>

      <AddRestockForm />
    </div>
  );
}

function RestockRow({
  item,
  onSetQuantity,
  onRestocked,
  restocking,
}: {
  item: RestockItem;
  onSetQuantity: (quantity: number) => void;
  onRestocked: () => void;
  restocking: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="font-medium text-slate-900">{item.item_name}</div>
        <button
          onClick={onRestocked}
          disabled={restocking}
          title="Adds this quantity to your Material Ledger and clears the request"
          className="rounded-md border border-green-300 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
        >
          Restocked
        </button>
      </div>
      {item.note && <p className="mt-1 text-sm text-slate-500">{item.note}</p>}
      <div className="mt-3 flex items-center gap-3">
        <QuantityStepper
          value={Number(item.quantity_needed)}
          unit={item.unit}
          onDecrement={() => onSetQuantity(Math.max(0, Number(item.quantity_needed) - 1))}
          onIncrement={() => onSetQuantity(Number(item.quantity_needed) + 1)}
          onDirectEdit={onSetQuantity}
        />
      </div>
    </div>
  );
}

function AddRestockForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ itemName: '', quantityNeeded: '1', note: '' });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/inventory/restock', {
        itemName: form.itemName,
        quantityNeeded: Number(form.quantityNeeded) || 0,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'restock'] });
      setForm({ itemName: '', quantityNeeded: '1', note: '' });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-5">
      <h2 className="col-span-full text-sm font-semibold text-slate-700">Flag something as needed</h2>
      <input
        required
        placeholder="Item"
        value={form.itemName}
        onChange={(e) => setForm({ ...form, itemName: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
      />
      <input
        type="number"
        min={0}
        placeholder="Qty needed"
        value={form.quantityNeeded}
        onChange={(e) => setForm({ ...form, quantityNeeded: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Note (optional)"
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button type="submit" disabled={createMutation.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
        {createMutation.isPending ? 'Adding…' : 'Add'}
      </button>
      {createMutation.isError && <p className="col-span-full text-sm text-red-600">Failed to add item.</p>}
    </form>
  );
}
