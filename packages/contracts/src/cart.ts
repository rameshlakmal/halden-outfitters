import { z } from 'zod';
import { Amount, Id, Slug } from './common.ts';
import { Availability, Image } from './catalog.ts';

export const MAX_LINE_QTY = 20;

export const CartLine = z
  .object({
    productId: Id,
    slug: Slug,
    name: z.string(),
    image: Image,
    unitPrice: Amount,
    compareAtPrice: Amount.nullable(),
    qty: z.number().int().min(1).max(MAX_LINE_QTY),
    lineTotal: Amount,
    availability: Availability,
    problem: z
      .enum(['unavailable', 'out_of_stock', 'not_enough_stock'])
      .nullable()
      .describe('Set when this line cannot be bought as it is'),
  })
  .meta({ id: 'CartLine' });
export type CartLine = z.infer<typeof CartLine>;

export const Cart = z
  .object({
    lines: z.array(CartLine),
    itemCount: z.number().int(),
    subtotal: Amount,
    savings: Amount.describe('How much less than the old prices of sale items'),
    coupon: z
      .object({ code: z.string(), applied: z.boolean(), problem: z.string().nullable(), discount: Amount, kind: z.enum(['percent', 'fixed', 'free_shipping']).nullable() })
      .nullable()
      .describe('The code on the cart and whether it can be used right now'),
    discount: Amount.describe('Coupon discount before shipping and tax'),
    canCheckOut: z.boolean().describe('False while any line has a problem or the cart is empty'),
  })
  .meta({ id: 'Cart' });
export type Cart = z.infer<typeof Cart>;

export const AddToCart = z.object({
  productId: Id,
  qty: z.number().int().min(1).max(MAX_LINE_QTY).default(1),
});

export const SetQty = z.object({ qty: z.number().int().min(1).max(MAX_LINE_QTY) });
