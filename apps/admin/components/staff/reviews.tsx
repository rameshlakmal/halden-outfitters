'use client';
// Review moderation: reviews held for a look (a link, an email address, a blocked word), hidden ones and
// published ones. Publishing or hiding updates the product rating at once.
import { SHOP_URL } from '@/lib/shop';
import type { ReviewStatus } from '@halden/contracts';
import { Star } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { post } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { type OwnReview, useStaffReviews } from './api';
import { Dialog, ErrorBox, LoadMore, PageHead, Tabs, textareaClass } from './ui';

const TABS: { value: ReviewStatus; label: string }[] = [
  { value: 'pending', label: 'Held' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'published', label: 'Published' },
];

export function ReviewModeration() {
  const [status, setStatus] = useState<ReviewStatus>('pending');
  const q = useStaffReviews(status);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHead
        title="Reviews"
        sub="Held reviews wait for you before anyone sees them. Hidden reviews never count in a rating."
      />
      <Tabs label="Review status" tabs={TABS} value={status} onChange={setStatus} />
      {q.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorBox error={q.error} retry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="rounded-[var(--radius-field)] border border-line px-4 py-10 text-center text-[14px] text-ink-2">
          {status === 'pending'
            ? 'Nothing is waiting. New reviews with links or blocked words land here.'
            : `No ${status} reviews.`}
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <ReviewItem key={r.id} review={r} />
          ))}
        </ul>
      )}
      <LoadMore hasNext={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} />
    </>
  );
}

function ReviewItem({ review: r }: { review: OwnReview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff', 'reviews'] });

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/staff/reviews/${r.id}/publish`);
      toast.show('Review published');
      refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-2 rounded-[var(--radius-field)] border border-line p-4" data-testid="moderation-review">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            href={`${SHOP_URL}/products/${r.product.slug}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold transition-colors hover:text-accent-text"
          >
            {r.product.name}
          </a>
          <span className="flex" role="img" aria-label={`${r.rating} of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                weight={n <= r.rating ? 'fill' : 'regular'}
                className="size-3.5 text-accent-text"
                aria-hidden="true"
              />
            ))}
          </span>
          <span className="text-ink-2">
            {r.customer ? `${r.customer.name} (${r.customer.email})` : r.author} · {formatDateTime(r.createdAt)}
            {r.editedAt ? ', edited' : ''}
          </span>
        </span>
        <span className="flex gap-2">
          {r.status !== 'published' && (
            <Button size="sm" busy={busy} onClick={() => void publish()}>
              Publish
            </Button>
          )}
          {r.status !== 'hidden' && (
            <Button size="sm" variant="danger" onClick={() => setHiding(true)}>
              Hide
            </Button>
          )}
        </span>
      </div>
      {r.heldFor && <p className="text-[13px] font-medium text-accent-text">Held: {r.heldFor}</p>}
      {r.hiddenReason && <p className="text-[13px] font-medium text-danger">Hidden: {r.hiddenReason}</p>}
      <p className="font-semibold">{r.title}</p>
      <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink-2">{r.body}</p>
      {r.helpfulCount > 0 && <p className="text-[12px] text-ink-3">{r.helpfulCount} found it helpful</p>}
      {error && <FormAlert>{error}</FormAlert>}
      <HideDialog id={r.id} open={hiding} onClose={() => setHiding(false)} onDone={refresh} />
    </li>
  );
}

function HideDialog({
  id,
  open,
  onClose,
  onDone,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3)
      return setError('Say why (at least 3 characters). The author is emailed this reason.');
    setBusy(true);
    setError(null);
    try {
      await post(`/staff/reviews/${id}/hide`, { reason: reason.trim() });
      toast.show('Review hidden; author emailed');
      onClose();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Hide this review">
      <form onSubmit={submit} noValidate className="grid gap-4">
        <label className="grid gap-1.5 text-[13px] font-medium">
          Reason (emailed to the author)
          <textarea
            className={textareaClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
        </label>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" variant="danger" size="sm" busy={busy}>
            Hide review
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
