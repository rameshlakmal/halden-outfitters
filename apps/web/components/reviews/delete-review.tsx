'use client';
// Confirm before deleting a review: it can't be undone, and the product rating changes straight away.
import { X } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { reviewKeys, send } from '@/lib/reviews';
import { errorMessage } from '../account/forms';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';

export function DeleteReviewDialog({
  reviewId,
  productName,
  open,
  onClose,
  onDeleted,
}: {
  reviewId: string;
  productName: string;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await send('DELETE', `/reviews/${reviewId}`);
      void qc.invalidateQueries({ queryKey: reviewKeys.all });
      toast.show('Review deleted');
      onDeleted?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Delete your review"
      className="pop mx-auto mt-[12vh] w-[min(460px,calc(100vw-32px))] rounded-[2px] border border-ink bg-surface p-0 text-ink shadow-[6px_6px_0_var(--ink)]"
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-2xl">Delete your review?</h2>
        <button
          type="button"
          onClick={onClose}
          className="press grid size-11 place-items-center rounded-[2px] text-ink-2 hover:bg-surface-2"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </header>
      <div className="grid gap-4 px-5 py-5">
        {error && <FormAlert>{error}</FormAlert>}
        <p className="text-[15px] text-ink-2">
          Your review of {productName} and its helpful votes go for good. You can write a new one later.
        </p>
      </div>
      <footer className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          Keep it
        </Button>
        <Button variant="danger" busy={busy} onClick={remove}>
          Delete review
        </Button>
      </footer>
    </dialog>
  );
}
