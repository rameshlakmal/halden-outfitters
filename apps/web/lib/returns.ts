'use client';
// Returns, Halden Points and store credit for the account pages. Type-only imports from the contracts, so no
// validation code reaches the browser.
import type {
  PointsAccount,
  Return,
  ReturnReason,
  ReturnStatus,
  ReturnSummary,
  StoreCreditAccount,
} from '@halden/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { get } from './api';

export type ReturnSummaryT = z.infer<typeof ReturnSummary>;
export type Points = z.infer<typeof PointsAccount>;
export type StoreCredit = z.infer<typeof StoreCreditAccount>;
export type Condition = NonNullable<Return['lines'][number]['condition']>;

export const returnKeys = {
  all: ['returns'] as const,
  list: ['returns', 'list'] as const,
  one: (id: string) => ['returns', 'one', id] as const,
  points: ['account', 'points'] as const,
  credit: ['account', 'store-credit'] as const,
};

type Page = { items: ReturnSummaryT[]; nextCursor: string | null };

export function useReturnList() {
  return useInfiniteQuery({
    queryKey: returnKeys.list,
    queryFn: ({ pageParam }) => get<Page>(`/returns?limit=10${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const useReturn = (id: string) => useQuery({ queryKey: returnKeys.one(id), queryFn: () => get<Return>(`/returns/${id}`) });
export const usePoints = () => useQuery({ queryKey: returnKeys.points, queryFn: () => get<Points>('/account/points') });
export const useStoreCredit = () =>
  useQuery({ queryKey: returnKeys.credit, queryFn: () => get<StoreCredit>('/account/store-credit') });

/** In the order the wizard lists them: the shop's faults first. */
export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  damaged: 'It arrived damaged',
  wrong_item: 'I got the wrong item',
  not_as_described: 'It is not as described',
  too_small: 'It is too small',
  too_large: 'It is too large',
  changed_mind: 'I changed my mind',
  not_needed: 'I no longer need it',
  other: 'Something else',
};
export const RETURN_REASON_LIST = Object.keys(RETURN_REASON_LABEL) as ReturnReason[];
/** Mirrors the API: these reasons get a free label, no restocking fee and shipping back on a full return. */
export const SHOP_FAULT: ReturnReason[] = ['damaged', 'wrong_item', 'not_as_described'];

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'Under review',
  approved: 'Approved',
  rejected: 'Not approved',
  received: 'Received',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export const CONDITION_LABEL: Record<Condition, string> = {
  as_new: 'As new',
  opened: 'Opened',
  damaged_by_customer: 'Damaged after delivery',
  faulty: 'Faulty',
};

export const POINTS_KIND_LABEL: Record<string, string> = {
  earn_pending: 'Earned, pending',
  earn_available: 'Earned',
  pending_release: 'Pending points released',
  redeem: 'Spent at checkout',
  redeem_reversal: 'Given back',
  return_reversal: 'Taken back for a return',
  expire: 'Expired',
  adjustment: 'Adjustment',
};

export const CREDIT_REASON_LABEL: Record<string, string> = {
  refund: 'Refund',
  purchase: 'Spent on an order',
  purchase_reversal: 'Given back from a cancelled order',
  goodwill: 'Goodwill refund',
  adjustment: 'Adjustment',
};

export const LABEL_FEE = '4.95';
export const RESTOCKING_PERCENT = 15;
