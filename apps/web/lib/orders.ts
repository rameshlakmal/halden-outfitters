'use client';
// Order reading for the account and checkout pages. Type-only imports from the contracts, so this adds no
// validation code to the pages that use it.
import type { CancelReason, Order, OrderStatus, OrderSummary } from '@halden/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { get } from './api';

export const orderKeys = {
  all: ['orders'] as const,
  list: ['orders', 'list'] as const,
  latest: ['orders', 'latest'] as const,
  one: (id: string) => ['orders', 'one', id] as const,
};

type Page = { items: OrderSummary[]; nextCursor: string | null };

export function useOrderList() {
  return useInfiniteQuery({
    queryKey: orderKeys.list,
    queryFn: ({ pageParam }) => get<Page>(`/orders?limit=10${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useLatestOrders() {
  return useQuery({ queryKey: orderKeys.latest, queryFn: () => get<Page>('/orders?limit=3') });
}

export function useOrder(id: string, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: orderKeys.one(id),
    queryFn: () => get<Order>(`/orders/${id}`),
    // While the bank step is open, look again every few seconds.
    refetchInterval: (q) => (opts.poll && q.state.data?.status === 'pending_payment' ? 5000 : false),
  });
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Waiting for payment',
  confirmed: 'Confirmed',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const REASON_LABEL: Record<CancelReason, string> = {
  changed_mind: 'I changed my mind',
  ordered_by_mistake: 'I ordered by mistake',
  found_cheaper: 'I found it cheaper elsewhere',
  delivery_too_slow: 'Delivery would take too long',
  other: 'Something else',
  out_of_stock: 'An item went out of stock',
  fraud_suspected: 'The payment needed checking',
  customer_request: 'Cancelled at your request',
  payment_failed: 'The payment did not go through',
  payment_timeout: 'The payment was not completed in time',
};

export const CUSTOMER_REASONS: CancelReason[] = [
  'changed_mind',
  'ordered_by_mistake',
  'found_cheaper',
  'delivery_too_slow',
  'other',
];

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const METHOD_LABEL = { standard: 'Standard', express: 'Express' } as const;
