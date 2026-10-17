import { z } from 'zod';
import { ROLES } from './account.ts';
import { Amount, Id, Slug, Timestamp } from './common.ts';

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
  })
  .meta({ id: 'StaffCoupon' });

export const CouponEdit = z
  .object({
    active: z.boolean(),
    maxUses: z.number().int().min(1).nullable(),
    endsAt: Timestamp.nullable(),
    description: z.string().trim().min(3).max(200),
  })
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Change at least one field.');

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
