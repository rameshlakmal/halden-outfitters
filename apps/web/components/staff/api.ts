'use client';
// Data and permissions for the staff console. Type-only imports from the contracts, so no validation code is
// shipped to the browser. Who may see what mirrors DESIGN.md 3.10; the API checks every action again.
import type {
  AuditEntry,
  Order,
  OrderStatus,
  OrderSummary,
  OwnReview,
  Return,
  ReturnStatus,
  ReturnSummary,
  ReviewStatus,
  Role,
  ShippingRate,
  StaffCoupon,
  StaffCustomer,
  StaffProduct,
  StockMovement,
} from '@halden/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { api, get } from '@/lib/api';

export type StaffOrderSummary = OrderSummary & { email: string };
export type ReturnRow = z.infer<typeof ReturnSummary>;
export type Movement = z.infer<typeof StockMovement>;
export type Audit = z.infer<typeof AuditEntry>;
export type Customer = z.infer<typeof StaffCustomer>;
export type Coupon = z.infer<typeof StaffCoupon>;
export type Rate = z.infer<typeof ShippingRate>;
export type { Order, OwnReview, Return, StaffProduct };

export type Page<T> = { items: T[]; nextCursor: string | null };

export const staffKeys = {
  orders: (status: string) => ['staff', 'orders', status] as const,
  order: (id: string) => ['staff', 'order', id] as const,
  returns: (status: string) => ['staff', 'returns', status] as const,
  return: (id: string) => ['staff', 'return', id] as const,
  products: (q: string, low: boolean) => ['staff', 'products', q, low] as const,
  product: (id: string) => ['staff', 'product', id] as const,
  movements: (id: string) => ['staff', 'movements', id] as const,
  reviews: (status: string) => ['staff', 'reviews', status] as const,
  customers: (q: string) => ['staff', 'customers', q] as const,
  coupons: ['staff', 'coupons'] as const,
  rates: ['staff', 'rates'] as const,
  tax: ['staff', 'tax'] as const,
  audit: (type: string, id: string) => ['staff', 'audit', type, id] as const,
  bugs: ['qa', 'bugs'] as const,
  clock: ['qa', 'clock'] as const,
  webhooks: (orderId: string) => ['qa', 'webhooks', orderId] as const,
};

// ---------- permissions ----------

export type Section =
  'orders' | 'warehouse' | 'returns' | 'products' | 'reviews' | 'customers' | 'settings' | 'audit' | 'qa';

export const SECTION_ROLES: Record<Section, Role[]> = {
  orders: ['support', 'warehouse', 'admin'],
  warehouse: ['warehouse', 'admin'],
  returns: ['support', 'warehouse', 'admin'],
  products: ['support', 'warehouse', 'admin'],
  reviews: ['support', 'admin'],
  customers: ['support', 'admin'],
  settings: ['admin'],
  audit: ['admin'],
  qa: ['admin'],
};

export const isStaff = (role: Role | undefined) => role === 'support' || role === 'warehouse' || role === 'admin';
export const can = (role: Role | undefined, section: Section) => !!role && SECTION_ROLES[section].includes(role);

export const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  support: 'Support',
  warehouse: 'Warehouse',
  admin: 'Admin',
};

// ---------- requests ----------

/** A request with extra headers (If-Match, Idempotency-Key), on top of the shared client. */
export const send = <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  api<T>(method, path, body, headers);

/** A request answered with 204 and no body. */
export const sendEmpty = (method: string, path: string, body?: unknown) => api<void>(method, path, body);

function useCursorList<T>(key: readonly unknown[], path: (cursor: string) => string, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => get<Page<T>>(path(pageParam)),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const useStaffOrders = (status: OrderStatus | '') =>
  useCursorList<StaffOrderSummary>(
    staffKeys.orders(status),
    (c) => `/staff/orders${qs({ status, cursor: c, limit: 25 })}`,
  );
export const useStaffOrder = (id: string) =>
  useQuery({ queryKey: staffKeys.order(id), queryFn: () => get<Order>(`/staff/orders/${id}`) });

export const useStaffReturns = (status: ReturnStatus | '') =>
  useCursorList<ReturnRow>(staffKeys.returns(status), (c) => `/staff/returns${qs({ status, cursor: c, limit: 25 })}`);
export const useStaffReturn = (id: string) =>
  useQuery({ queryKey: staffKeys.return(id), queryFn: () => get<Return>(`/staff/returns/${id}`) });

export const useStaffProducts = (q: string, lowStock: boolean) =>
  useCursorList<StaffProduct>(
    staffKeys.products(q, lowStock),
    (c) => `/staff/products${qs({ q, lowStock, cursor: c, limit: 50 })}`,
  );
export const useStaffProduct = (id: string) =>
  useQuery({ queryKey: staffKeys.product(id), queryFn: () => get<StaffProduct>(`/staff/products/${id}`) });
export const useMovements = (id: string) =>
  useQuery({
    queryKey: staffKeys.movements(id),
    queryFn: () => get<{ items: Movement[] }>(`/staff/products/${id}/movements`),
  });

export const useStaffReviews = (status: ReviewStatus) =>
  useCursorList<OwnReview>(staffKeys.reviews(status), (c) => `/staff/reviews${qs({ status, cursor: c, limit: 20 })}`);

export const useStaffCustomers = (q: string) =>
  useCursorList<Customer>(staffKeys.customers(q), (c) => `/staff/customers${qs({ q, cursor: c, limit: 50 })}`);

export const useCoupons = () =>
  useQuery({ queryKey: staffKeys.coupons, queryFn: () => get<{ items: Coupon[] }>('/staff/coupons') });
export const useRates = () =>
  useQuery({ queryKey: staffKeys.rates, queryFn: () => get<{ items: Rate[] }>('/staff/shipping-rates') });
export const useTax = () =>
  useQuery({ queryKey: staffKeys.tax, queryFn: () => get<{ ratePercent: string }>('/staff/tax') });

export const useAudit = (entityType: string, entityId: string) =>
  useCursorList<Audit>(
    staffKeys.audit(entityType, entityId),
    (c) => `/staff/audit${qs({ entityType, entityId, cursor: c, limit: 50 })}`,
  );

// ---------- QA lab ----------

export type Bug = {
  key: string;
  phase: number;
  title: string;
  description: string;
  howToSee: string;
  rule: string;
  enabled: boolean;
};
export type ClockState = { now: string; offsetSeconds: number };
export type SweepResult = {
  expired: number;
  completed: number;
  returnsExpired: number;
  pointsExpired: number;
  webhooksDelivered: number;
};
export type WebhookEvent = {
  id: string;
  type: string;
  orderId: string | null;
  payload: unknown;
  attempts: number;
  createdAt: string;
  deliveredAt: string | null;
  processed: boolean;
};

export const useBugs = () => useQuery({ queryKey: staffKeys.bugs, queryFn: () => get<{ items: Bug[] }>('/qa/bugs') });
export const useClock = () => useQuery({ queryKey: staffKeys.clock, queryFn: () => get<ClockState>('/qa/clock') });
export const useWebhooks = (orderId: string) =>
  useQuery({
    queryKey: staffKeys.webhooks(orderId),
    queryFn: () => get<{ items: WebhookEvent[] }>(`/qa/webhooks${qs({ orderId })}`),
  });

// ---------- labels ----------

export const CONDITION_LABEL = {
  as_new: 'As new',
  opened: 'Opened',
  damaged_by_customer: 'Damaged by customer',
  faulty: 'Faulty',
} as const;
export type Condition = keyof typeof CONDITION_LABEL;

/** What each grade does to the refund and the stock, shown next to the choice. */
export const CONDITION_EFFECT: Record<Condition, (shopFault: boolean) => string> = {
  as_new: () => 'Full refund, back on the shelf',
  opened: (shopFault) =>
    shopFault ? 'Full refund (shop fault), back on the shelf' : '15% restocking fee, back on the shelf',
  damaged_by_customer: () => 'No refund for this line, written off',
  faulty: () => 'Full refund, written off',
};

export const STOCK_REASON_LABEL = {
  restock: 'Restock',
  adjustment: 'Count adjustment',
  write_off: 'Write off',
} as const;

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
