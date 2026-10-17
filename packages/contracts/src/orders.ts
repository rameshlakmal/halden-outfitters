import { z } from 'zod';
import { AddressInput } from './account.ts';
import { Amount, Id, Timestamp } from './common.ts';

export const ORDER_STATUSES = [
  'pending_payment',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SHIPPING_METHODS = ['standard', 'express'] as const;
export type ShippingMethod = (typeof SHIPPING_METHODS)[number];

/** Reasons a customer can give; staff and the system have a few more (see the API). */
export const CUSTOMER_CANCEL_REASONS = [
  'changed_mind',
  'ordered_by_mistake',
  'found_cheaper',
  'delivery_too_slow',
  'other',
] as const;
export const STAFF_CANCEL_REASONS = [...CUSTOMER_CANCEL_REASONS, 'out_of_stock', 'fraud_suspected', 'customer_request'] as const;
export const CANCEL_REASONS = [...STAFF_CANCEL_REASONS, 'payment_failed', 'payment_timeout'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const ORDER_ACTIONS = ['cancel', 'pay', 'pack', 'ship', 'deliver'] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

// ---------- checkout ----------

/** Where the order goes: a saved address by id, or a new one typed at checkout (saved to the book). */
export const ShipTo = z.union([
  z.object({ addressId: Id }),
  z.object({ address: AddressInput.omit({ isDefault: true, label: true }) }),
]);

export const QuoteInput = z.object({
  shipTo: ShipTo,
  shippingMethod: z.enum(SHIPPING_METHODS).default('standard'),
});

export const ShippingOption = z
  .object({
    method: z.enum(SHIPPING_METHODS),
    price: Amount,
    free: z.boolean(),
    freeFrom: Amount.nullable(),
    daysMin: z.number().int(),
    daysMax: z.number().int(),
  })
  .meta({ id: 'ShippingOption' });

export const Totals = z
  .object({
    subtotal: Amount,
    discount: Amount,
    shipping: Amount,
    tax: Amount,
    taxRate: z.string().describe('Percent, e.g. "8.00"'),
    total: Amount,
  })
  .meta({ id: 'Totals' });
export type Totals = z.infer<typeof Totals>;

export const Quote = z
  .object({
    zone: z.object({ code: z.string(), name: z.string() }),
    shippingOptions: z.array(ShippingOption),
    shippingMethod: z.enum(SHIPPING_METHODS),
    coupon: z
      .object({ code: z.string(), applied: z.boolean(), problem: z.string().nullable(), discount: Amount })
      .nullable(),
    totals: Totals,
    toFreeShipping: Amount.nullable().describe('How much more for free shipping with this method, if any'),
  })
  .meta({ id: 'Quote' });
export type Quote = z.infer<typeof Quote>;

export const Card = z.object({
  number: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{16}$/, 'Enter the 16 digits on the card.')),
  expMonth: z.number().int().min(1, 'Month 1 to 12.').max(12, 'Month 1 to 12.'),
  expYear: z.number().int().min(2000).max(2100),
  cvc: z.string().regex(/^\d{3,4}$/, 'Enter the 3 or 4 digit code.'),
  name: z.string().trim().min(1, 'Required.').max(80),
});

export const CheckoutInput = QuoteInput.extend({ card: Card });

export const CheckoutResult = z
  .object({
    orderId: Id,
    status: z.enum(ORDER_STATUSES),
    nextAction: z
      .object({ type: z.literal('authenticate'), url: z.string() })
      .nullable()
      .describe('Set when the card needs an extra step at the bank'),
  })
  .meta({ id: 'CheckoutResult' });
export type CheckoutResult = z.infer<typeof CheckoutResult>;

export const ApplyCoupon = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,20}$/, 'Enter a code of 3 to 20 letters and numbers.'),
});

// ---------- orders ----------

export const OrderLine = z
  .object({
    productId: Id,
    sku: z.string(),
    name: z.string(),
    slug: z.string(),
    image: z.string(),
    unitPrice: Amount,
    qty: z.number().int(),
    lineTotal: Amount,
    discount: Amount,
    tax: Amount,
    returnable: z.boolean(),
  })
  .meta({ id: 'OrderLine' });

export const OrderEvent = z
  .object({
    from: z.enum(ORDER_STATUSES).nullable(),
    to: z.enum(ORDER_STATUSES),
    by: z.enum(['customer', 'staff', 'system']),
    note: z.string().nullable(),
    at: Timestamp,
  })
  .meta({ id: 'OrderEvent' });

export const OrderPayment = z
  .object({
    status: z.enum([
      'requires_action',
      'authorized',
      'captured',
      'voided',
      'failed',
      'partially_refunded',
      'refunded',
    ]),
    cardBrand: z.string(),
    cardLast4: z.string(),
    amount: Amount,
    captured: Amount,
    refunded: Amount,
    disputed: z.boolean(),
  })
  .meta({ id: 'OrderPayment' });

export const Order = z
  .object({
    id: Id,
    status: z.enum(ORDER_STATUSES),
    email: z.string(),
    placedAt: Timestamp,
    paymentExpiresAt: Timestamp.nullable(),
    lines: z.array(OrderLine),
    totals: Totals,
    couponCode: z.string().nullable(),
    shipping: z.object({
      method: z.enum(SHIPPING_METHODS),
      zone: z.string(),
      name: z.string(),
      line1: z.string(),
      line2: z.string().nullable(),
      city: z.string(),
      region: z.string().nullable(),
      postcode: z.string(),
      countryCode: z.string(),
      countryName: z.string(),
      phone: z.string().nullable(),
      trackingNumber: z.string().nullable(),
    }),
    payment: OrderPayment.nullable(),
    cancel: z.object({ reason: z.enum(CANCEL_REASONS), note: z.string().nullable(), at: Timestamp }).nullable(),
    events: z.array(OrderEvent),
    allowedActions: z.array(z.enum(ORDER_ACTIONS)).describe('What the viewer may do with this order now'),
  })
  .meta({ id: 'Order' });
export type Order = z.infer<typeof Order>;

export const OrderSummary = z
  .object({
    id: Id,
    status: z.enum(ORDER_STATUSES),
    placedAt: Timestamp,
    total: Amount,
    itemCount: z.number().int(),
    images: z.array(z.string()),
  })
  .meta({ id: 'OrderSummary' });
export type OrderSummary = z.infer<typeof OrderSummary>;

export const CancelOrder = z.object({
  reason: z.enum(STAFF_CANCEL_REASONS),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((s) => (s ? s : null)),
});

export const ShipOrder = z.object({ trackingNumber: z.string().trim().min(4).max(40) });

export const Authenticate = z.object({ approve: z.boolean() });
