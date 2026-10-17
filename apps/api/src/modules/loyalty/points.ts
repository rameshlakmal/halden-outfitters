// Halden Points rules (DESIGN.md 3.13):
//   - Earned on delivery: 1 point per 1.00 paid for goods (subtotal minus coupon and points discounts; tax and
//     shipping earn nothing), rounded down per order. Summit tier earns 1.5 points per 1.00: a customer is Summit
//     when their completed orders of the last 365 days add up to 500.00 or more of goods.
//   - Earned points are pending until the order completes (its return window closes); then they become available
//     and expire 12 months later. Returned lines lose their pending points.
//   - 100 points = 5.00 off at checkout, at most half of the subtotal after the coupon (pricing.ts).
//   - Spending takes the oldest available points first. A cancelled order gives its redeemed points back; a
//     returned line gives back its share of the redeemed points, as points.
//   - The available balance never goes below zero.
import { allocate, toCents } from '@halden/money';
import type { Queryable } from '../../core/db.js';
import { AppError } from '../../core/errors.js';

export const SUMMIT_THRESHOLD_CENTS = 50_000;
export const EXPIRY_DAYS = 365;

export type Balance = { available: number; pending: number };

export async function balance(db: Queryable, customerId: string): Promise<Balance> {
  const { rows } = await db.query<{ available: number; pending: number }>(
    `SELECT coalesce(sum(points) FILTER (WHERE bucket = 'available'), 0)::int AS available,
            coalesce(sum(points) FILTER (WHERE bucket = 'pending'), 0)::int AS pending
       FROM loyalty_ledger WHERE customer_id = $1`,
    [customerId],
  );
  return rows[0] ?? { available: 0, pending: 0 };
}

/** Locks the customer's points so two checkouts can't spend the same points. */
export const lockPoints = (db: Queryable, customerId: string) =>
  db.query('SELECT 1 FROM customers WHERE id = $1 FOR UPDATE', [customerId]);

export async function isSummit(db: Queryable, customerId: string, now: Date): Promise<boolean> {
  const { rows } = await db.query<{ goods: string | null }>(
    `SELECT sum(subtotal - discount - points_discount)::text AS goods FROM orders
      WHERE customer_id = $1 AND status = 'completed' AND completed_at > $2::timestamptz - interval '365 days'`,
    [customerId, now],
  );
  return toCents(rows[0]?.goods ?? '0') >= SUMMIT_THRESHOLD_CENTS;
}

const expiresAt = (now: Date) => new Date(now.getTime() + EXPIRY_DAYS * 86400_000);

/** Spends points, oldest first. */
export async function redeem(db: Queryable, customerId: string, points: number, orderId: string, now: Date) {
  if (points <= 0) return;
  const { available } = await balance(db, customerId);
  if (points > available) throw new AppError('validation_failed', `You have ${available} points.`, { errors: [{ path: 'pointsToRedeem', message: `You have ${available} points.` }] });
  let left = points;
  const { rows } = await db.query<{ id: string; remaining: number }>(
    `SELECT id, remaining FROM loyalty_ledger WHERE customer_id = $1 AND remaining > 0 AND (expires_at IS NULL OR expires_at > $2)
      ORDER BY created_at, id FOR UPDATE`,
    [customerId, now],
  );
  for (const r of rows) {
    if (left === 0) break;
    const take = Math.min(left, r.remaining);
    await db.query('UPDATE loyalty_ledger SET remaining = remaining - $2 WHERE id = $1', [r.id, take]);
    left -= take;
  }
  await db.query(
    "INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, order_id, created_at) VALUES ($1, 'available', 'redeem', $2, $3, $4)",
    [customerId, -points, orderId, now],
  );
}

/** Gives points back as a fresh available batch (cancel, return). */
export async function giveBack(
  db: Queryable,
  customerId: string,
  points: number,
  kind: 'redeem_reversal' | 'adjustment',
  refs: { orderId?: string; returnId?: string; actorId?: string; note?: string },
  now: Date,
) {
  if (points <= 0) return;
  await db.query(
    `INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, remaining, expires_at, order_id, return_id, actor_id, note, created_at)
     VALUES ($1, 'available', $2, $3, $3, $4, $5, $6, $7, $8, $9)`,
    [customerId, kind, points, expiresAt(now), refs.orderId ?? null, refs.returnId ?? null, refs.actorId ?? null, refs.note ?? null, now],
  );
}

type EarnLine = { id: string; line_total: string; discount_alloc: string; points_alloc: string };

/**
 * Points an order earns on delivery, spread over its lines. Planted bug points_on_tax_shipping also counts the
 * order's tax and shipping.
 */
export async function earnOnDelivery(db: Queryable, order: { id: string; customer_id: string; tax: string; shipping: string }, now: Date, opts: { onTaxAndShipping: boolean }) {
  const { rows: lines } = await db.query<EarnLine>(
    'SELECT id, line_total, discount_alloc, points_alloc FROM order_items WHERE order_id = $1 ORDER BY id',
    [order.id],
  );
  const paid = lines.map((l) => toCents(l.line_total) - toCents(l.discount_alloc) - toCents(l.points_alloc));
  let base = paid.reduce((a, b) => a + b, 0);
  if (opts.onTaxAndShipping) base += toCents(order.tax) + toCents(order.shipping);
  const rate = (await isSummit(db, order.customer_id, now)) ? 1.5 : 1;
  const total = Math.floor((base / 100) * rate);
  if (total <= 0) return 0;
  const perLine = allocate(total, paid.map((p) => Math.max(p, 0)));
  for (const [i, l] of lines.entries()) await db.query('UPDATE order_items SET points_earned = $2 WHERE id = $1', [l.id, perLine[i]]);
  await db.query('UPDATE orders SET points_earned = $2 WHERE id = $1', [order.id, total]);
  await db.query(
    "INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, order_id, note, created_at) VALUES ($1, 'pending', 'earn_pending', $2, $3, $4, $5)",
    [order.customer_id, total, order.id, rate > 1 ? 'Summit rate 1.5x' : null, now],
  );
  return total;
}

/** Pending points still held for an order (earned minus what returns took back). */
export async function pendingForOrder(db: Queryable, orderId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT coalesce(sum(points), 0)::int AS n FROM loyalty_ledger WHERE order_id = $1 AND bucket = 'pending'",
    [orderId],
  );
  return rows[0]?.n ?? 0;
}

/** A return takes back the pending points of its lines (while the order hasn't completed). */
export async function reversePending(db: Queryable, customerId: string, orderId: string, returnId: string, points: number, now: Date) {
  const held = await pendingForOrder(db, orderId);
  const take = Math.min(points, held);
  if (take <= 0) return 0;
  await db.query(
    "INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, order_id, return_id, created_at) VALUES ($1, 'pending', 'return_reversal', $2, $3, $4, $5)",
    [customerId, -take, orderId, returnId, now],
  );
  return take;
}

/** When the order completes: its remaining pending points become available. */
export async function releaseOnCompletion(db: Queryable, customerId: string, orderId: string, now: Date) {
  const held = await pendingForOrder(db, orderId);
  if (held <= 0) return 0;
  await db.query(
    "INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, order_id, created_at) VALUES ($1, 'pending', 'pending_release', $2, $3, $4)",
    [customerId, -held, orderId, now],
  );
  await db.query(
    `INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, remaining, expires_at, order_id, created_at)
     VALUES ($1, 'available', 'earn_available', $2, $2, $3, $4, $5)`,
    [customerId, held, expiresAt(now), orderId, now],
  );
  return held;
}

/** Expires unspent points older than 12 months. Run by the sweep. */
export async function expire(db: Queryable, now: Date): Promise<number> {
  const { rows } = await db.query<{ id: string; customer_id: string; remaining: number }>(
    'SELECT id, customer_id, remaining FROM loyalty_ledger WHERE remaining > 0 AND expires_at <= $1 FOR UPDATE',
    [now],
  );
  for (const r of rows) {
    await db.query('UPDATE loyalty_ledger SET remaining = 0 WHERE id = $1', [r.id]);
    await db.query(
      "INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, created_at, note) VALUES ($1, 'available', 'expire', $2, $3, 'Expired after 12 months')",
      [r.customer_id, -r.remaining, now],
    );
  }
  return rows.reduce((n, r) => n + r.remaining, 0);
}
