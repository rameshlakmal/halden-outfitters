import { z } from 'zod';
import { Amount, Id, Timestamp } from './common.ts';

export const RETURN_REASONS = [
  'damaged',
  'wrong_item',
  'not_as_described',
  'changed_mind',
  'too_small',
  'too_large',
  'not_needed',
  'other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
/** Reasons where the shop is at fault: free return label, no restocking fee, shipping refunded on a full return. */
export const SHOP_FAULT_REASONS: readonly ReturnReason[] = ['damaged', 'wrong_item', 'not_as_described'];

export const RETURN_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'received',
  'refunded',
  'partially_refunded',
  'expired',
  'cancelled',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const ITEM_CONDITIONS = ['as_new', 'opened', 'damaged_by_customer', 'faulty'] as const;
export const REFUND_METHODS = ['card', 'store_credit'] as const;

export const RETURN_ACTIONS = ['cancel', 'approve', 'reject', 'receive'] as const;

export const RequestReturn = z.object({
  items: z
    .array(z.object({ productId: Id, qty: z.number().int().min(1).max(20) }))
    .min(1, 'Choose at least one item.')
    .max(20),
  reason: z.enum(RETURN_REASONS),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((s) => (s ? s : null)),
  refundMethod: z.enum(REFUND_METHODS).default('card'),
});

export const ReceiveReturn = z.object({
  items: z.array(z.object({ productId: Id, condition: z.enum(ITEM_CONDITIONS) })).min(1),
});

export const RejectReturn = z.object({ reason: z.string().trim().min(3).max(300) });

export const Goodwill = z.object({
  amount: Amount.refine((a) => Number(a) > 0, 'Enter an amount above 0.00.'),
  reason: z.string().trim().min(3, 'Say why.').max(300),
  method: z.enum(REFUND_METHODS).default('card'),
});

export const ReturnLine = z
  .object({
    productId: Id,
    name: z.string(),
    image: z.string(),
    qty: z.number().int(),
    condition: z.enum(ITEM_CONDITIONS).nullable(),
    refundAmount: Amount,
    pointsRefund: z.number().int(),
    restocked: z.boolean(),
  })
  .meta({ id: 'ReturnLine' });

export const Return = z
  .object({
    id: Id,
    orderId: Id,
    status: z.enum(RETURN_STATUSES),
    reason: z.enum(RETURN_REASONS),
    note: z.string().nullable(),
    shopFault: z.boolean(),
    refundMethod: z.enum(REFUND_METHODS),
    autoApproved: z.boolean(),
    lines: z.array(ReturnLine),
    estimate: Amount.describe('Expected refund if everything arrives as new'),
    labelFee: Amount,
    restockingFee: Amount,
    shippingRefund: Amount,
    refundTotal: Amount,
    pointsRefund: z.number().int(),
    label: z.object({ code: z.string(), expiresAt: Timestamp }).nullable(),
    rejectedReason: z.string().nullable(),
    requestedAt: Timestamp,
    decidedAt: Timestamp.nullable(),
    receivedAt: Timestamp.nullable(),
    refundedAt: Timestamp.nullable(),
    events: z.array(
      z.object({
        from: z.enum(RETURN_STATUSES).nullable(),
        to: z.enum(RETURN_STATUSES),
        note: z.string().nullable(),
        at: Timestamp,
      }),
    ),
    allowedActions: z.array(z.enum(RETURN_ACTIONS)),
  })
  .meta({ id: 'Return' });
export type Return = z.infer<typeof Return>;

export const ReturnSummary = z
  .object({
    id: Id,
    orderId: Id,
    status: z.enum(RETURN_STATUSES),
    reason: z.enum(RETURN_REASONS),
    requestedAt: Timestamp,
    refundTotal: Amount,
    itemCount: z.number().int(),
  })
  .meta({ id: 'ReturnSummary' });

export const Refund = z
  .object({
    id: Id,
    kind: z.enum(['return', 'goodwill']),
    method: z.enum(REFUND_METHODS),
    amount: Amount,
    reason: z.string(),
    at: Timestamp,
  })
  .meta({ id: 'Refund' });

export const PointsAccount = z
  .object({
    available: z.number().int(),
    pending: z.number().int(),
    tier: z.enum(['base', 'summit']),
    nextExpiry: z.object({ points: z.number().int(), at: Timestamp }).nullable(),
    history: z.array(
      z.object({
        kind: z.string(),
        points: z.number().int(),
        bucket: z.enum(['pending', 'available']),
        orderId: Id.nullable(),
        note: z.string().nullable(),
        at: Timestamp,
      }),
    ),
  })
  .meta({ id: 'PointsAccount' });

export const StoreCreditAccount = z
  .object({
    balance: Amount,
    history: z.array(z.object({ amount: Amount, reason: z.string(), orderId: Id.nullable(), at: Timestamp })),
  })
  .meta({ id: 'StoreCreditAccount' });
