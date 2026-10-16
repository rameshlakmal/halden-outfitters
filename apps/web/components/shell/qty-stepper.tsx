'use client';
import { Minus, Plus } from '@phosphor-icons/react';

export function QtyStepper({
  qty,
  max,
  onChange,
  disabled,
  label,
}: {
  qty: number;
  max: number;
  onChange: (qty: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div
      className="inline-flex h-9 items-center rounded-[2px] border border-line-strong pointer-coarse:h-11"
      role="group"
      aria-label={`Quantity of ${label}`}
    >
      <button
        type="button"
        className="press grid size-9 place-items-center rounded-[2px] text-ink-2 hover:text-ink disabled:opacity-40 pointer-coarse:size-11"
        onClick={() => onChange(qty - 1)}
        disabled={disabled || qty <= 1}
        aria-label="One less"
      >
        <Minus className="size-4" />
      </button>
      <span className="w-7 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        className="press grid size-9 place-items-center rounded-[2px] text-ink-2 hover:text-ink disabled:opacity-40 pointer-coarse:size-11"
        onClick={() => onChange(qty + 1)}
        disabled={disabled || qty >= max}
        aria-label="One more"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
