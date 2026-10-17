'use client';
// The product page's reviews. Nothing is fetched until the section is close to the viewport, and the write
// form is a separate chunk loaded when it's opened, so reviews cost the first page load nothing.
import type { OwnReview, Review, ReviewSort } from '@halden/contracts';
import { ChatCircleText, PencilSimpleLine } from '@phosphor-icons/react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/queries';
import { FIT_LABEL, type Fit, type ReviewPageT, SORT_LABEL, useHelpful, useProductReviews } from '@/lib/reviews';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button, Spinner } from '../ui/button';
import { FormAlert } from '../ui/field';
import { Listbox } from '../ui/listbox';
import { DeleteReviewDialog } from './delete-review';
import { ReviewCard } from './review-card';
import { StarRow } from './stars';

const ReviewForm = dynamic(() => import('./review-form'), {
  loading: () => <Skeleton className="h-96 w-full" />,
});

/** Same as the API's REVIEW_EDIT_DAYS; kept here so the contracts' validation code stays out of the page. */
const EDIT_DAYS = 30;
const canStillEdit = (r: Review) => Date.now() < new Date(r.createdAt).getTime() + EDIT_DAYS * 86_400_000;

const SORTS = (Object.keys(SORT_LABEL) as ReviewSort[]).map((s) => ({ value: s, label: SORT_LABEL[s] }));

function Summary({
  summary,
  rating,
  onRating,
}: {
  summary: ReviewPageT['summary'];
  rating: number | null;
  onRating: (n: number | null) => void;
}) {
  const max = Math.max(1, ...Object.values(summary.distribution));
  const fitTotal = summary.fit ? summary.fit.runs_small + summary.fit.true_to_size + summary.fit.runs_large : 0;
  return (
    <div className="grid content-start gap-6">
      {summary.average === null ? (
        <p className="text-[15px] text-ink-2">No ratings yet.</p>
      ) : (
        <div className="flex items-end gap-4">
          <span
            className="text-7xl leading-[0.85] font-extrabold tabular-nums [font-stretch:72%]"
            data-testid="rating-average"
          >
            {summary.average.toFixed(1)}
          </span>
          <span className="grid gap-1 pb-1">
            <StarRow rating={summary.average} />
            <span className="text-[13px] text-ink-2" data-testid="rating-count">
              {summary.count} review{summary.count === 1 ? '' : 's'}
            </span>
          </span>
        </div>
      )}
      <ul className="grid gap-1" aria-label="Filter by stars">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = summary.distribution[n as 1 | 2 | 3 | 4 | 5];
          const active = rating === n;
          return (
            <li key={n}>
              <button
                type="button"
                disabled={count === 0 && !active}
                aria-pressed={active}
                onClick={() => onRating(active ? null : n)}
                className={`press grid w-full grid-cols-[3.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 rounded-[2px] px-2 py-1.5 text-left text-[13px] disabled:cursor-default disabled:opacity-50 pointer-coarse:min-h-11 ${
                  active ? 'bg-ink text-bg' : 'hover:bg-surface-2'
                }`}
              >
                <span className="font-bold tracking-[0.06em] uppercase">{n} star</span>
                <span
                  className={`h-2 overflow-hidden rounded-[1px] ${active ? 'bg-bg/25' : 'bg-surface-2'}`}
                  aria-hidden="true"
                >
                  <span
                    className={`block h-full origin-left transition-transform duration-500 ${active ? 'bg-bg' : 'bg-accent'}`}
                    style={{ transform: `scaleX(${count / max})` }}
                  />
                </span>
                <span className="text-right tabular-nums">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {summary.fit && fitTotal > 0 && (
        <div className="grid gap-2">
          <h3 className="text-[12px] font-bold tracking-[0.08em] uppercase">How it fits</h3>
          <ul className="grid gap-1 text-[13px] text-ink-2">
            {(Object.keys(FIT_LABEL) as Fit[]).map((f) => (
              <li key={f} className="flex justify-between gap-3">
                <span>{FIT_LABEL[f]}</span>
                <span className="tabular-nums">{Math.round((summary.fit![f] / fitTotal) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-6" role="status" aria-busy="true" aria-label="Loading reviews">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-3 border-t border-line pt-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}

export function ReviewsSection({ slug, productName, sized }: { slug: string; productName: string; sized: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [sort, setSort] = useState<ReviewSort>('helpful');
  const [rating, setRating] = useState<number | null>(null);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [posted, setPosted] = useState<OwnReview | null>(null);
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const helpful = useHelpful(slug);

  // Start loading a screen or so before the section scrolls in.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.location.hash === '#reviews' || !('IntersectionObserver' in window)) return setNear(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: '600px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const q = useProductReviews(slug, sort, rating, near);
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const viewer = first?.viewer ?? null;
  const signedIn = !!session.data;
  const signIn = () => router.push(`/sign-in?next=${encodeURIComponent(`${pathname}#reviews`)}`);

  const vote = (r: Review) => {
    if (!signedIn) return signIn();
    helpful.mutate({ id: r.id, voted: !r.votedHelpful });
  };

  const done = (saved: OwnReview) => {
    setWriting(false);
    setEditing(null);
    setPosted(saved);
  };

  // The shopper's own just-posted review shows first, whatever the sort, until they leave the page.
  const pinned = posted && posted.status === 'published' ? items.find((r) => r.id === posted.id) : undefined;
  const list = pinned ? [pinned, ...items.filter((r) => r.id !== pinned.id)] : items;

  return (
    <section ref={root} id="reviews" className="below-fold mt-24 scroll-mt-24" aria-labelledby="reviews-title">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
        <h2 id="reviews-title" className="text-3xl md:text-4xl">
          Reviews
        </h2>
        {first && first.summary.count > 0 && (
          <Listbox
            label="Sort reviews"
            value={sort}
            options={SORTS}
            onChange={(v) => setSort(v as ReviewSort)}
            align="right"
          />
        )}
      </div>

      {q.isError ? (
        <FormAlert>{errorMessage(q.error)}</FormAlert>
      ) : !first ? (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-16">
          <Skeleton className="h-56 w-full" />
          <ListSkeleton />
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-16">
          <div className="grid content-start gap-6 lg:sticky lg:top-24 lg:self-start">
            <Summary summary={first.summary} rating={rating} onRating={setRating} />
            {!writing && !editing && (
              <WriteCall
                viewer={viewer}
                signedIn={signedIn}
                signIn={signIn}
                onWrite={() => {
                  setPosted(null);
                  setWriting(true);
                }}
              />
            )}
          </div>

          <div className="grid content-start gap-6">
            {posted?.status === 'pending' && (
              <FormAlert tone="info">
                Thanks. Your review will appear after a quick check
                {posted.heldFor ? ` (${posted.heldFor.toLowerCase()})` : ''}. You can see it in{' '}
                <Link href="/account/reviews" className="link">
                  your reviews
                </Link>
                .
              </FormAlert>
            )}
            {posted?.status === 'published' && !writing && !editing && (
              <FormAlert tone="success">Thanks. Your review is live.</FormAlert>
            )}
            {(writing || editing) && (
              <ReviewForm
                slug={slug}
                sized={sized}
                editing={
                  editing
                    ? {
                        id: editing.id,
                        rating: editing.rating,
                        title: editing.title,
                        body: editing.body,
                        fit: editing.fit,
                      }
                    : undefined
                }
                onDone={done}
                onCancel={() => {
                  setWriting(false);
                  setEditing(null);
                }}
              />
            )}

            {first.summary.count === 0 ? (
              <div className="grid justify-items-start gap-3 border-t border-line py-10">
                <ChatCircleText className="size-8 text-ink-3" aria-hidden="true" />
                <p className="text-lg font-semibold">No reviews yet</p>
                <p className="max-w-[48ch] text-ink-2">
                  Bought the {productName}? Once it has been delivered, tell other people how it did.
                </p>
              </div>
            ) : list.length === 0 ? (
              <p className="border-t border-line py-10 text-ink-2">No {rating}-star reviews.</p>
            ) : (
              <div
                className={
                  q.isFetching && !q.isFetchingNextPage ? 'opacity-60 transition-opacity' : 'transition-opacity'
                }
              >
                {list.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    canEdit={canStillEdit(r)}
                    onHelpful={() => vote(r)}
                    onEdit={() => {
                      setPosted(null);
                      setWriting(false);
                      setEditing(r);
                      root.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    onDelete={() => setDeleting(r.id)}
                  />
                ))}
              </div>
            )}

            {q.hasNextPage && (
              <div className="border-t border-line pt-6">
                <Button variant="outline" onClick={() => void q.fetchNextPage()} busy={q.isFetchingNextPage}>
                  More reviews
                </Button>
              </div>
            )}
            {q.isFetching && !q.isFetchingNextPage && (
              <span className="sr-only" role="status">
                <Spinner /> Updating reviews
              </span>
            )}
          </div>
        </div>
      )}

      {deleting && (
        <DeleteReviewDialog
          reviewId={deleting}
          productName={productName}
          open
          onClose={() => setDeleting(null)}
          onDeleted={() => setPosted(null)}
        />
      )}
    </section>
  );
}

function WriteCall({
  viewer,
  signedIn,
  signIn,
  onWrite,
}: {
  viewer: ReviewPageT['viewer'];
  signedIn: boolean;
  signIn: () => void;
  onWrite: () => void;
}) {
  if (!signedIn || !viewer) {
    return (
      <div className="grid gap-3 border-t border-line pt-6">
        <p className="text-[14px] text-ink-2">Bought this? Sign in to review it.</p>
        <Button variant="outline" onClick={signIn} icon={<PencilSimpleLine className="size-4" />}>
          Sign in to review
        </Button>
      </div>
    );
  }
  if (viewer.canReview) {
    return (
      <div className="grid gap-3 border-t border-line pt-6">
        <p className="text-[14px] text-ink-2">You bought this. How did it do?</p>
        <Button onClick={onWrite} icon={<PencilSimpleLine className="size-4" />} data-testid="write-review">
          Write a review
        </Button>
      </div>
    );
  }
  return (
    <p className="border-t border-line pt-6 text-[14px] text-ink-3">
      {viewer.reason}
      {viewer.myReviewId && (
        <>
          {' '}
          <Link href="/account/reviews" className="link">
            See your reviews
          </Link>
        </>
      )}
    </p>
  );
}
