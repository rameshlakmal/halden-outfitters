// Paying a refund out. Every refund (return or goodwill) goes through here, so the limits hold in one place:
//   - The total refunded on an order never exceeds what was paid for it: the card capture plus store credit used.
//   - A card refund never exceeds what is left of the capture; anything over goes to store credit (an order paid
//     partly with store credit gets that part back as credit).
//   - A store-credit refund is paid as credit only.
import type { Role } from '@halden/contracts';
import { fromCents, toCents } from '@halden/money';
import type { AppContext } from '../../core/context.js';
import type { Queryable } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { addCredit } from '../loyalty/store-credit.js';

export type RefundInput = {
  orderId: string;
  customerId: string;
  amountCents: number;
  method: 'card' | 'store_credit';
  kind: 'return' | 'goodwill';
  reason: string;
  returnId?: string;
  actor: { id: string | null; role: Role | null };
};

type PaymentRow = { intent_id: string; status: string; amount_captured: string; amount_refunded: string };

/** What can still be refunded on an order, in cents. */
export async function refundable(db: Queryable, orderId: string): Promise<number> {
  const { rows } = await db.query<{ paid: string; refunded: string }>(
    `SELECT (o.store_credit_used + coalesce(p.amount_captured, 0))::text AS paid,
            (SELECT coalesce(sum(amount), 0) FROM refunds WHERE order_id = o.id)::text AS refunded
       FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
    [orderId],
  );
  const r = rows[0];
  return r ? toCents(r.paid) - toCents(r.refunded) : 0;
}

export async function payOut(ctx: AppContext, tx: Queryable, input: RefundInput, now: Date, opts: { skipLimit?: boolean } = {}) {
  if (input.amountCents <= 0) return null;
  const { rows: pays } = await tx.query<PaymentRow>(
    'SELECT intent_id, status, amount_captured, amount_refunded FROM payments WHERE order_id = $1 FOR UPDATE',
    [input.orderId],
  );
  const pay = pays[0];
  const left = await refundable(tx, input.orderId);
  if (!opts.skipLimit && input.amountCents > left) {
    throw new AppError('refund_limit_exceeded', `Only ${fromCents(Math.max(left, 0))} can still be refunded on this order.`);
  }
  const amount = fromCents(input.amountCents);
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO refunds (order_id, return_id, kind, method, amount, reason, actor_id, actor_role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [input.orderId, input.returnId ?? null, input.kind, input.method, amount, input.reason, input.actor.id, input.actor.role, now],
  );
  const refundId = rows[0]!.id;

  const captured = pay && ['captured', 'partially_refunded', 'refunded'].includes(pay.status);
  const cardRoom = captured ? toCents(pay.amount_captured) - toCents(pay.amount_refunded) : 0;
  let toCard = 0;
  // The card never takes back more than it was charged (the provider would refuse), so anything over goes to credit.
  if (input.method === 'card') toCard = Math.min(input.amountCents, Math.max(cardRoom, 0));
  // Planted bug: store_credit_double.
  else if (captured && (await ctx.bugs.enabled('store_credit_double', tx))) toCard = Math.min(input.amountCents, Math.max(cardRoom, 0));
  const toCredit = input.method === 'store_credit' ? input.amountCents : input.amountCents - toCard;

  if (toCard > 0 && pay) {
    await ctx.gateway.refund(tx, pay.intent_id, fromCents(toCard));
    await tx.query(
      `UPDATE payments SET amount_refunded = amount_refunded + $2,
              status = CASE WHEN amount_refunded + $2 >= amount_captured THEN 'refunded' ELSE 'partially_refunded' END::payment_status,
              updated_at = $3
        WHERE order_id = $1`,
      [input.orderId, fromCents(toCard), now],
    );
  }
  if (toCredit > 0) {
    await addCredit(
      tx,
      input.customerId,
      fromCents(toCredit),
      input.kind === 'goodwill' ? 'goodwill' : 'refund',
      { orderId: input.orderId, refundId, actorId: input.actor.id ?? undefined },
      now,
    );
  }
  return { refundId, toCard, toCredit };
}
