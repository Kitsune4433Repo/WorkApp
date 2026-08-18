import { useState } from 'react';

interface Props {
  value: number;
  unit: string;
  onDecrement: () => void;
  onIncrement: () => void;
  onDirectEdit: (next: number) => void;
}

/** Shared by the Material Ledger and Out Of Inventory pages so the +/- and direct-edit controls
 * always look and behave identically between them. */
export function QuantityStepper({ value, unit, onDecrement, onIncrement, onDirectEdit }: Props) {
  const [editValue, setEditValue] = useState<string | null>(null);

  function commitEdit() {
    if (editValue === null) return;
    const next = Number(editValue);
    setEditValue(null);
    if (Number.isFinite(next) && next >= 0 && next !== value) onDirectEdit(next);
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onDecrement}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-sm font-bold leading-none text-slate-600 hover:bg-slate-100"
      >
        −
      </button>
      <input
        type="number"
        min={0}
        value={editValue ?? value}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-16 rounded-md border border-slate-300 px-1.5 py-1 text-center text-sm font-semibold"
      />
      <span className="text-xs text-slate-500">{unit}</span>
      <button
        type="button"
        onClick={onIncrement}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-sm font-bold leading-none text-slate-600 hover:bg-slate-100"
      >
        +
      </button>
    </div>
  );
}
