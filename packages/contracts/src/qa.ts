import { z } from 'zod';
import { Address, Me } from './account.ts';
import { Cart, MAX_LINE_QTY } from './cart.ts';
import { Amount, Id, Slug, text, Timestamp } from './common.ts';

export const InboxEmail = z
  .object({
    id: Id,
    to: z.string(),
    template: z.string(),
    subject: z.string(),
    body: z.string(),
    links: z.array(z.string()).describe('Every link in the email, for tests to follow'),
    createdAt: Timestamp,
  })
  .meta({ id: 'InboxEmail' });
export type InboxEmail = z.infer<typeof InboxEmail>;

export const Clock = z
  .object({
    now: Timestamp.describe('The shop clock: real time plus the offset'),
    offsetSeconds: z.number().int(),
  })
  .meta({ id: 'Clock' });
export type Clock = z.infer<typeof Clock>;

export const SetClock = z.object({
  offsetSeconds: z
    .number()
    .int()
    .min(0, 'The shop clock can only move forward.')
    .max(400 * 86400),
});

export const ShopperFixtureInput = z.object({
  name: text(1, 80).default('Test Shopper'),
  role: z.enum(['customer', 'support', 'warehouse']).default('customer'),
  emailVerified: z.boolean().default(true),
  address: z.boolean().default(true).describe('Give the shopper a default US shipping address'),
  cart: z
    .array(z.object({ slug: Slug, qty: z.number().int().min(1).max(MAX_LINE_QTY) }))
    .max(10)
    .default([])
    .describe('Products to put in the cart, by slug'),
  storeCredit: Amount.refine((a) => !a.startsWith('-') && Number(a) <= 1000, 'From 0.00 to 1000.00.').default('0.00'),
  points: z.number().int().min(0).max(100_000).default(0),
});
export type ShopperFixtureInput = z.infer<typeof ShopperFixtureInput>;

export const ShopperFixture = z
  .object({
    customer: Me,
    password: z.string().describe('Generated; sign in with it like any account'),
    accessToken: z.string().describe('Already signed in: send as `Authorization: Bearer <accessToken>`'),
    address: Address.nullable(),
    cart: Cart,
    storeCredit: Amount,
    points: z.number().int(),
  })
  .meta({ id: 'ShopperFixture' });
export type ShopperFixture = z.infer<typeof ShopperFixture>;
