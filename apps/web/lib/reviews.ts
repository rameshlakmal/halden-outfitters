'use client';
// Product reviews for the storefront and the account page. Type-only imports from the contracts, so no
// validation code reaches the browser.
import type { OwnReview, Review, ReviewPage, ReviewSort } from '@halden/contracts';
import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { api, ApiError, get } from './api';

export type ReviewPageT = z.infer<typeof ReviewPage>;
export type Fit = NonNullable<Review['fit']>;
export type ReviewDraft = { rating: number; title: string; body: string; fit: Fit | null };

export const reviewKeys = {
  all: ['reviews'] as const,
  product: (slug: string) => ['reviews', 'product', slug] as const,
  page: (slug: string, sort: ReviewSort, rating: number | null) => ['reviews', 'product', slug, sort, rating] as const,
  mine: ['reviews', 'mine'] as const,
};

export const SORT_LABEL: Record<ReviewSort, string> = {
  helpful: 'Most helpful',
  newest: 'Newest',
  highest: 'Highest rating',
  lowest: 'Lowest rating',
};

export const FIT_LABEL: Record<Fit, string> = {
  runs_small: 'Runs small',
  true_to_size: 'True to size',
  runs_large: 'Runs large',
};

export const REVIEW_STATUS_LABEL: Record<OwnReview['status'], string> = {
  published: 'Published',
  pending: 'Waiting for a check',
  hidden: 'Hidden',
};

/** A write that answers 204 with no body (delete, helpful votes). */
export const send = (method: 'PUT' | 'DELETE', path: string, body?: unknown) => api<void>(method, path, body);

export function useProductReviews(slug: string, sort: ReviewSort, rating: number | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: reviewKeys.page(slug, sort, rating),
    queryFn: ({ pageParam }) =>
      get<ReviewPageT>(
        `/products/${slug}/reviews?limit=6&sort=${sort}${rating ? `&rating=${rating}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

type MinePage = { items: OwnReview[]; nextCursor: string | null };

export function useMyReviews() {
  return useInfiniteQuery({
    queryKey: reviewKeys.mine,
    queryFn: ({ pageParam }) => get<MinePage>(`/account/reviews?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Helpful votes, shown at once and rolled back if the API says no. Every cached page of this product's reviews
 * is updated, so switching the sort doesn't show a stale count.
 */
export function useHelpful(slug: string) {
  const qc = useQueryClient();
  const patchAll = (id: string, voted: boolean) =>
    qc.setQueriesData<InfiniteData<ReviewPageT>>({ queryKey: reviewKeys.product(slug) }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((r) =>
                r.id === id && r.votedHelpful !== voted
                  ? { ...r, votedHelpful: voted, helpfulCount: r.helpfulCount + (voted ? 1 : -1) }
                  : r,
              ),
            })),
          }
        : data,
    );
  return useMutation({
    mutationFn: ({ id, voted }: { id: string; voted: boolean }) => send(voted ? 'PUT' : 'DELETE', `/reviews/${id}/helpful`, voted ? {} : undefined),
    onMutate: ({ id, voted }) => patchAll(id, voted),
    onError: (err, { id, voted }) => {
      // Already marked elsewhere (another tab): the server's state is "voted", so keep it.
      if (err instanceof ApiError && err.code === 'conflict' && voted) return;
      patchAll(id, !voted);
    },
  });
}

/** Days and hours until a review stops being editable, or null once it can't be. */
export function editableFor(until: string | null, now = Date.now()): number | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  return ms > 0 ? Math.ceil(ms / 86_400_000) : null;
}
