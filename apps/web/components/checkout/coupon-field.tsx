'use client';
// The coupon box, shared by the cart page and checkout. Applying checks the code against the cart straight
// away; a code that stopped working since shows why. Type-only contract imports keep the cart page light.
import type { Cart } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { Tag, X } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError, del, post } from '@/lib/api';
import { keys } from '@/lib/queries';
import { Spinner } from '../ui/button';

export function CouponField({ cart, onChange }: { cart: Cart; onChange?: () => void }) {
  const qc = useQueryClient();
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<Cart>) => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(keys.cart, await fn());
      setCode('');
      onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.code ?? err.message) : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (cart.coupon) {
    const c = cart.coupon;
    return (
      <div className="grid gap-1.5">
        <div
          className={`flex items-center justify-between gap-3 rounded-[2px] border px-3 py-2 ${c.applied ? 'border-line-strong' : 'border-danger'}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Tag weight="fill" className={`size-4 shrink-0 ${c.applied ? 'text-accent' : 'text-ink-3'}`} />
            <span className="truncate text-sm font-bold tracking-[0.06em] uppercase">{c.code}</span>
            {c.applied && c.kind !== 'free_shipping' && (
              <span className="text-sm text-accent tabular-nums">-{formatAmount(c.discount)}</span>
            )}
            {c.applied && c.kind === 'free_shipping' && <span className="text-sm text-accent">Free shipping</span>}
          </span>
          <button
            type="button"
            onClick={() => run(() => del<Cart>('/cart/coupon'))}
            disabled={busy}
            className="press grid size-9 shrink-0 place-items-center rounded-[2px] text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:size-11"
            aria-label={`Remove code ${c.code}`}
          >
            {busy ? <Spinner /> : <X className="size-4" />}
          </button>
        </div>
        {c.problem && (
          <p className="text-[13px] font-medium text-danger" role="alert">
            {c.problem}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) void run(() => post<Cart>('/cart/coupon', { code: code.trim() }));
      }}
    >
      <label htmlFor={id} className="text-[12px] font-bold tracking-[0.08em] uppercase">
        Discount code
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-11 min-w-0 flex-1 rounded-[2px] border bg-surface px-3 text-[15px] uppercase outline-none focus:border-ink ${error ? 'border-danger' : 'border-line-strong'}`}
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="press inline-flex h-11 items-center gap-2 rounded-[2px] border border-line-strong px-4 text-[12px] font-bold tracking-[0.08em] uppercase hover:bg-surface-2 disabled:opacity-50"
        >
          {busy && <Spinner />} Apply
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-[13px] font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
