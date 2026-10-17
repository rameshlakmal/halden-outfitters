'use client';
// The customer's own reviews with their moderation state. Editing happens here too, in place.
import type { OwnReview } from '@halden/contracts';
import { ArrowRight, ChatCircleText, PencilSimple, Trash } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { formatDate } from '@/lib/orders';
import { editableFor, REVIEW_STATUS_LABEL, useMyReviews } from '@/lib/reviews';
import { errorMessage } from '../account/forms';
import { chipClass } from '../orders/status';
import { Skeleton } from '../ui/bits';
import { Button, LinkButton } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { DeleteReviewDialog } from './delete-review';
import { StarRow } from './stars';

const ReviewForm = dynamic(() => import('./review-form'), { loading: () => <Skeleton className="h-96 w-full" /> });

const CHIP: Record<OwnReview['status'], string> = {
  published: 'border-line-strong bg-ink text-bg',
  pending: 'border-accent text-accent',
  hidden: 'border-line text-ink-3',
};

function Row({ review }: { review: OwnReview }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const days = editableFor(review.editableUntil);
  const p = review.product;

  return (
    <li className="grid gap-4 border-t border-line py-6" data-testid="my-review">
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 sm:grid-cols-[80px_minmax(0,1fr)_auto]">
        <Link
          href={`/products/${p.slug}`}
          className="relative block aspect-square overflow-hidden rounded-[2px] bg-surface-2"
        >
          {p.image && <Image src={p.image} alt="" fill sizes="80px" className="object-cover" />}
        </Link>
        <div className="grid min-w-0 content-start gap-1.5">
          <Link href={`/products/${p.slug}`} className="w-fit font-semibold hover:text-accent">
            {p.name}
          </Link>
          <StarRow rating={review.rating} />
          <p className="font-semibold">{review.title}</p>
          <p className="text-[13px] text-ink-3">
            Posted {formatDate(review.createdAt)}
            {review.editedAt && `, edited ${formatDate(review.editedAt)}`}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
          <span className={chipClass(CHIP[review.status])} data-testid="review-status">
            {REVIEW_STATUS_LABEL[review.status]}
          </span>
        </div>
      </div>

      {review.status === 'pending' && (
        <FormAlert tone="info">
          It will appear on the product page once support has had a look
          {review.heldFor ? ` (${review.heldFor.toLowerCase()})` : ''}.
        </FormAlert>
      )}
      {review.status === 'hidden' && (
        <FormAlert>
          Support hid this review{review.hiddenReason ? `: ${review.hiddenReason}` : '.'} It can no longer be edited,
          but you can delete it.
        </FormAlert>
      )}

      {editing ? (
        <ReviewForm
          slug={p.slug}
          sized={p.sized}
          editing={{ id: review.id, rating: review.rating, title: review.title, body: review.body, fit: review.fit }}
          onDone={(saved) => {
            setEditing(false);
            toast.show(saved.status === 'pending' ? 'Saved. It will show after a quick check' : 'Review saved');
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="max-w-[68ch] leading-relaxed whitespace-pre-line text-ink-2">{review.body}</p>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2">
          {days !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              icon={<PencilSimple className="size-4" />}
            >
              Edit
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setDeleting(true)} icon={<Trash className="size-4" />}>
            Delete
          </Button>
          {days !== null && (
            <span className="text-[13px] text-ink-3">
              Editable for {days} more day{days === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      <DeleteReviewDialog
        reviewId={review.id}
        productName={p.name}
        open={deleting}
        onClose={() => setDeleting(false)}
      />
    </li>
  );
}

export function MyReviews() {
  const q = useMyReviews();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your reviews</h1>
        <p className="text-ink-2">Reviews can be edited for 30 days after you post them, and deleted any time.</p>
      </header>
      {q.isPending ? (
        <div className="grid gap-6" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 border-t border-line pt-6">
              <Skeleton className="aspect-square w-full" />
              <div className="grid gap-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <FormAlert>{errorMessage(q.error)}</FormAlert>
      ) : items.length === 0 ? (
        <div className="grid justify-items-start gap-3 border-t border-line py-10">
          <ChatCircleText className="size-8 text-ink-3" aria-hidden="true" />
          <p className="text-lg font-semibold">No reviews yet</p>
          <p className="max-w-[48ch] text-ink-2">
            Once an order has been delivered, you can review what was in it from its product page.
          </p>
          <LinkButton href="/account/orders" variant="outline">
            Your orders <ArrowRight className="size-4" />
          </LinkButton>
        </div>
      ) : (
        <>
          <ul className="grid">
            {items.map((r) => (
              <Row key={r.id} review={r} />
            ))}
          </ul>
          {q.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => void q.fetchNextPage()}
              busy={q.isFetchingNextPage}
              className="justify-self-start"
            >
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
