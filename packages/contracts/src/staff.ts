import { z } from 'zod';
import { ROLES } from './account.ts';
import { Amount, Id, Slug, Timestamp } from './common.ts';
import { ORDER_STATUSES } from './orders.ts';
import { RETURN_REASONS } from './returns.ts';

export const StockLevel = z
  .object({
    onHand: z.number().int(),
    reserved: z.number().int(),
    available: z.number().int(),
    lowStockThreshold: z.number().int(),
  })
  .meta({ id: 'StockLevel' });

export const StaffProduct = z
  .object({
    id: Id,
    slug: Slug,
    sku: z.string(),
    name: z.string(),
    summary: z.string(),
    description: z.string(),
    category: z.object({ slug: Slug, name: z.string() }),
    image: z.string(),
    price: Amount,
    compareAtPrice: Amount.nullable(),
    active: z.boolean(),
    featured: z.boolean(),
    returnable: z.boolean(),
    sized: z.boolean(),
    stock: StockLevel,
    rating: z.object({ average: z.number().nullable(), count: z.number().int() }),
    version: z.number().int().describe('Send it back as If-Match: "<version>" when saving'),
    updatedAt: Timestamp,
  })
  .meta({ id: 'StaffProduct' });
export type StaffProduct = z.infer<typeof StaffProduct>;

export const ProductEdit = z
  .object({
    name: z.string().trim().min(2).max(80),
    summary: z.string().trim().min(5).max(200),
    description: z.string().trim().min(10).max(4000),
    price: Amount.refine((a) => Number(a) > 0, 'Above 0.00.'),
    compareAtPrice: Amount.nullable(),
    active: z.boolean(),
    featured: z.boolean(),
    returnable: z.boolean(),
    lowStockThreshold: z.number().int().min(0).max(1000),
  })
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Change at least one field.');

export const STOCK_REASONS = ['restock', 'adjustment', 'write_off'] as const;
export const StockAdjust = z.object({
  change: z
    .number()
    .int()
    .min(-10_000)
    .max(10_000)
    .refine((n) => n !== 0, 'Not zero.'),
  reason: z.enum(STOCK_REASONS),
  note: z.string().trim().max(300).optional(),
});

export const StockMovement = z
  .object({
    change: z.number().int(),
    reason: z.string(),
    orderId: Id.nullable(),
    note: z.string().nullable(),
    by: z.string().nullable(),
    at: Timestamp,
  })
  .meta({ id: 'StockMovement' });

export const AuditEntry = z
  .object({
    id: Id,
    actor: z.object({ id: Id, name: z.string(), role: z.enum(ROLES) }).nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    before: z.unknown(),
    after: z.unknown(),
    requestId: z.string().nullable(),
    at: Timestamp,
  })
  .meta({ id: 'AuditEntry' });

export const StaffCustomer = z
  .object({
    id: Id,
    name: z.string(),
    email: z.string(),
    role: z.enum(ROLES),
    emailVerified: z.boolean(),
    orderCount: z.number().int(),
    lockedUntil: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'StaffCustomer' });

export const SetRole = z.object({ role: z.enum(ROLES) });

export const StaffCoupon = z
  .object({
    code: z.string(),
    kind: z.enum(['percent', 'fixed', 'free_shipping']),
    value: z.string(),
    description: z.string(),
    minSubtotal: Amount.nullable(),
    maxUses: z.number().int().nullable(),
    perCustomerLimit: z.number().int().nullable(),
    firstOrderOnly: z.boolean(),
    excludesSaleItems: z.boolean(),
    startsAt: Timestamp.nullable(),
    endsAt: Timestamp.nullable(),
    active: z.boolean(),
    uses: z.number().int(),
    excludedCategories: z.array(Slug),
  })
  .meta({ id: 'StaffCoupon' });

export const COUPON_KINDS = ['percent', 'fixed', 'free_shipping'] as const;

/** What a coupon does once created. Its code, kind and value are fixed then: make a new coupon to change them. */
const couponRules = {
  description: z.string().trim().min(3).max(200),
  minSubtotal: Amount.nullable(),
  maxUses: z.number().int().min(1).max(100_000).nullable(),
  perCustomerLimit: z.number().int().min(1).max(100).nullable(),
  firstOrderOnly: z.boolean(),
  excludesSaleItems: z.boolean(),
  startsAt: Timestamp.nullable(),
  endsAt: Timestamp.nullable(),
  active: z.boolean(),
};

const datesInOrder = (c: { startsAt?: string | null; endsAt?: string | null }) =>
  !c.startsAt || !c.endsAt || new Date(c.endsAt) > new Date(c.startsAt);

export const CouponCreate = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/, '3 to 20 letters and digits.'),
    kind: z.enum(COUPON_KINDS),
    value: Amount.describe('Percent (1 to 100), fixed amount off, or 0 for free shipping'),
    ...couponRules,
    excludedCategories: z.array(Slug).max(20).default([]),
  })
  .refine(datesInOrder, { path: ['endsAt'], message: 'The end must be after the start.' })
  .refine((c) => (c.kind === 'free_shipping' ? Number(c.value) === 0 : Number(c.value) > 0), {
    path: ['value'],
    message: 'Free shipping has no value; percent and fixed coupons need one.',
  })
  .refine((c) => c.kind !== 'percent' || Number(c.value) <= 100, { path: ['value'], message: 'At most 100%.' });

export const CouponEdit = z
  .object(couponRules)
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Change at least one field.')
  .refine(datesInOrder, { path: ['endsAt'], message: 'The end must be after the start.' });

// ---------- dashboard ----------

export const DASHBOARD_RANGES = [7, 30, 90] as const;

const Kpi = z.object({ value: z.string(), previous: z.string() });

export const Dashboard = z
  .object({
    from: Timestamp,
    to: Timestamp,
    days: z.number().int(),
    revenue: Kpi.describe('Totals of orders placed in the range, cancelled ones excluded'),
    orders: Kpi,
    averageOrder: Kpi,
    returnRate: Kpi.describe('Returns requested per order placed, as a percent'),
    series: z.array(z.object({ day: z.string(), revenue: Amount, orders: z.number().int() })),
    byStatus: z.array(z.object({ status: z.enum(ORDER_STATUSES), count: z.number().int() })),
    returnReasons: z.array(z.object({ reason: z.enum(RETURN_REASONS), count: z.number().int() })),
    lowStock: z.array(z.object({ id: Id, name: z.string(), available: z.number().int(), threshold: z.number().int() })),
    recentOrders: z.array(
      z.object({ id: Id, customer: z.string(), status: z.enum(ORDER_STATUSES), total: Amount, placedAt: Timestamp }),
    ),
    queues: z
      .object({
        toPack: z.number().int(),
        toShip: z.number().int(),
        returnsToDecide: z.number().int(),
        returnsToReceive: z.number().int(),
        reviewsToModerate: z.number().int(),
        lowStock: z.number().int(),
      })
      .describe('Open work, for the counters in the navigation'),
  })
  .meta({ id: 'Dashboard' });

export const ShippingRate = z
  .object({
    zone: z.string(),
    zoneName: z.string(),
    method: z.enum(['standard', 'express']),
    price: Amount,
    freeFrom: Amount.nullable(),
    daysMin: z.number().int(),
    daysMax: z.number().int(),
  })
  .meta({ id: 'ShippingRate' });

export const RateEdit = z.object({ price: Amount, freeFrom: Amount.nullable() });

export const TaxSetting = z.object({
  ratePercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, 'A percentage like 8 or 7.5.'),
});
