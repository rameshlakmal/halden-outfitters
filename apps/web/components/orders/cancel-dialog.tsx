'use client';
// Cancel an order before it ships: a reason (a note is needed for "Something else") and a confirm.
import type { CancelReason, Order } from '@halden/contracts';
import { X } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { CUSTOMER_REASONS, orderKeys, REASON_LABEL } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';

export function CancelDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; note?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!reason) next.reason = 'Choose a reason.';
    if (reason === 'other' && !note.trim()) next.note = 'Tell us a little more.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const updated = await post<Order>(`/orders/${order.id}/cancel`, { reason, note: note.trim() || undefined });
      qc.setQueryData(orderKeys.one(order.id), updated);
      void qc.invalidateQueries({ queryKey: orderKeys.list });
      void qc.invalidateQueries({ queryKey: orderKeys.latest });
      toast.show('Order cancelled');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (err.fields.reason || err.fields.note)) {
        setErrors({ reason: err.fields.reason, note: err.fields.note });
      } else {
        setErrors({ form: errorMessage(err) });
        // The order may have moved on (packed, shipped) while the dialog was open.
        if (err instanceof ApiError && err.code !== 'validation_failed')
          void qc.invalidateQueries({ queryKey: orderKeys.one(order.id) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Cancel this order"
      className="pop mx-auto mt-[8vh] max-h-[86dvh] w-[min(520px,calc(100vw-32px))] overflow-y-auto rounded-[2px] border border-ink bg-surface p-0 text-ink shadow-[6px_6px_0_var(--ink)]"
    >
      <form onSubmit={submit} noValidate className="grid">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-2xl">Cancel this order?</h2>
          <button
            type="button"
            onClick={onClose}
            className="press grid size-11 place-items-center rounded-[2px] text-ink-2 hover:bg-surface-2"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="grid gap-5 px-5 py-5">
          {errors.form && <FormAlert>{errors.form}</FormAlert>}
          <p className="text-[15px] text-ink-2">
            The hold on your card is released straight away and nothing is charged.
          </p>
          <fieldset className="grid gap-2" aria-describedby={errors.reason ? 'cancel-reason-error' : undefined}>
            <legend className="mb-2 text-[12px] font-bold tracking-[0.08em] uppercase">Why are you cancelling?</legend>
            {CUSTOMER_REASONS.map((r) => (
              <label
                key={r}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[2px] px-1 text-[15px] hover:bg-surface-2"
              >
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="size-5 accent-[var(--ink)]"
                />
                {REASON_LABEL[r]}
              </label>
            ))}
            {errors.reason && (
              <p id="cancel-reason-error" className="text-[13px] font-medium text-danger">
                {errors.reason}
              </p>
            )}
          </fieldset>
          <div className="grid gap-1.5">
            <label htmlFor="cancel-note" className="text-[12px] font-bold tracking-[0.08em] uppercase">
              Note
              {reason !== 'other' && (
                <span className="ml-1.5 font-semibold tracking-normal text-ink-3 normal-case">optional</span>
              )}
            </label>
            <textarea
              id="cancel-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={errors.note ? 'cancel-note-error' : undefined}
              className={`w-full rounded-[2px] border bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-brand ${errors.note ? 'border-danger' : 'border-line-strong'}`}
            />
            {errors.note && (
              <p id="cancel-note-error" className="text-[13px] font-medium text-danger">
                {errors.note}
              </p>
            )}
          </div>
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Keep order
          </Button>
          <Button type="submit" variant="danger" busy={busy}>
            Cancel order
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
