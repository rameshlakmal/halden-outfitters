// Store credit: refunds can go here instead of the card (instant), and it pays for later orders, alone or with a
// card. The balance is the ledger sum and never goes below zero.
import { fromCents, toCents } from '@halden/money';
import type { Queryable } from '../../core/db.js';

export async function creditBalance(db: Queryable, customerId: string): Promise<string> {
  const { rows } = await db.query<{ b: string }>(
    'SELECT coalesce(sum(amount), 0)::numeric(10,2)::text AS b FROM store_credit_ledger WHERE customer_id = $1',
    [customerId],
  );
  return rows[0]?.b ?? '0.00';
}

export async function addCredit(
  db: Queryable,
  customerId: string,
  amount: string,
  reason: 'refund' | 'purchase_reversal' | 'goodwill' | 'adjustment',
  refs: { orderId?: string; refundId?: string; actorId?: string; note?: string },
  now: Date,
) {
  if (toCents(amount) <= 0) return;
  await db.query(
    'INSERT INTO store_credit_ledger (customer_id, amount, reason, order_id, refund_id, actor_id, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      customerId,
      amount,
      reason,
      refs.orderId ?? null,
      refs.refundId ?? null,
      refs.actorId ?? null,
      refs.note ?? null,
      now,
    ],
  );
}

/** Spends up to `wanted` cents of credit on an order; returns what was used. Caller holds the customer lock. */
export async function spendCredit(
  db: Queryable,
  customerId: string,
  wantedCents: number,
  orderId: string,
  now: Date,
): Promise<number> {
  const have = toCents(await creditBalance(db, customerId));
  const use = Math.min(have, wantedCents);
  if (use <= 0) return 0;
  await db.query(
    "INSERT INTO store_credit_ledger (customer_id, amount, reason, order_id, created_at) VALUES ($1, $2, 'purchase', $3, $4)",
    [customerId, fromCents(-use), orderId, now],
  );
  return use;
}
