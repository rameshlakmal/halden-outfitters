'use client';
import type { Review } from '@halden/contracts';
import { PencilSimple, SealCheck, ThumbsUp, Trash } from '@phosphor-icons/react';
import { formatDate } from '@/lib/orders';
import { FIT_LABEL } from '@/lib/reviews';
import { StarRow } from './stars';

const ACTION =
  'press inline-flex min-h-9 items-center gap-1.5 rounded-[2px] px-2.5 text-[12px] font-bold tracking-[0.06em] uppercase pointer-coarse:min-h-11';

export function ReviewCard({
  review,
  canEdit,
  onHelpful,
  onEdit,
  onDelete,
}: {
  review: Review;
  canEdit: boolean;
  onHelpful: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="grid gap-3 border-t border-line py-6" data-testid="review-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <StarRow rating={review.rating} />
        <span className="text-[13px] text-ink-3">
          {formatDate(review.createdAt)}
          {review.editedAt && <span> · edited</span>}
        </span>
      </div>
      <h3 className="text-lg font-semibold tracking-tight normal-case [font-stretch:100%]">{review.title}</h3>
      <p className="max-w-[68ch] leading-relaxed whitespace-pre-line text-ink-2">{review.body}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <span className="font-semibold">{review.author}</span>
        <span className="inline-flex items-center gap-1 text-ink-2">
          <SealCheck weight="fill" className="size-4 text-accent" aria-hidden="true" /> Verified buyer
        </span>
        {review.fit && <span className="text-ink-2">Fit: {FIT_LABEL[review.fit]}</span>}
        {review.mine && <span className="font-bold tracking-[0.08em] text-accent uppercase">Your review</span>}
      </div>
      <div className="-ml-2.5 flex flex-wrap items-center gap-1">
        {!review.mine && (
          <button
            type="button"
            onClick={onHelpful}
            aria-pressed={review.votedHelpful}
            className={`${ACTION} ${review.votedHelpful ? 'text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
          >
            <ThumbsUp weight={review.votedHelpful ? 'fill' : 'regular'} className="size-4" aria-hidden="true" />
            Helpful <span className="tabular-nums">({review.helpfulCount})</span>
          </button>
        )}
        {review.mine && review.helpfulCount > 0 && (
          <span className="px-2.5 text-[13px] text-ink-3">{review.helpfulCount} found this helpful</span>
        )}
        {review.mine && canEdit && (
          <button type="button" onClick={onEdit} className={`${ACTION} text-ink-2 hover:bg-surface-2 hover:text-ink`}>
            <PencilSimple className="size-4" aria-hidden="true" /> Edit
          </button>
        )}
        {review.mine && (
          <button
            type="button"
            onClick={onDelete}
            className={`${ACTION} text-ink-2 hover:bg-danger-soft hover:text-danger`}
          >
            <Trash className="size-4" aria-hidden="true" /> Delete
          </button>
        )}
      </div>
    </article>
  );
}
