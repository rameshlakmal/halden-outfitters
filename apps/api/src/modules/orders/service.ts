// Order rules (see lifecycle.ts for the state machine):
//   - Cancelling releases the stock hold, voids the card authorization (nothing was charged, so nothing to
//     refund), gives back the coupon use and emails the customer, all in one transaction.
//   - Shipping captures the card for the authorized amount and turns the stock hold into a sale.
//   - A pending_payment order that isn't paid within 30 minutes is cancelled (payment_timeout). This is applied
//     lazily whenever the order is read or touched, and by the sweep, because the free hosting plan only runs a
//     scheduled job once a day.
//   - A delivered order becomes completed once its return window has passed and it has no open return.
import type { CancelReason, Order, OrderStatus, OrderSummary, ReturnStatus, Role } from '@halden/contracts';
import type pg from 'pg';
import { audit } from '../../core/audit.js';
import type { CurrentUser } from '../../core/auth.js';
import type { AppContext } from '../../core/context.js';
import type { Queryable } from '../../core/db.js';
import { AppError, notFound } from '../../core/errors.js';
import { queueEmail } from '../../core/outbox.js';
import { fromCents, toCents } from '@halden/money';
import { earnOnDelivery, giveBack, releaseOnCompletion } from '../loyalty/points.js';
import { addCredit } from '../loyalty/store-credit.js';
import { allowedActions, canMove, CANCELLABLE_BY, returnWindowClosed, returnWindowEnds } from './lifecycle.js';

export type Actor = { id: string | null; role: Role | null; kind: 'customer' | 'staff' | 'system' };
export const systemActor: Actor = { id: null, role: null, kind: 'system' };
export const actorOf = (u: CurrentUser, ownerId?: string): Actor => ({
  id: u.id,
  role: u.role,
  kind: u.role === 'customer' || u.id === ownerId ? 'customer' : 'staff',
});

type OrderRow = {
  id: string;
  customer_id: string;
  email: string;
  status: OrderStatus;
  subtotal: string;
  discount: string;
  shipping: string;
  tax: string;
  total: string;
  tax_rate: string;
  points_redeemed: number;
  points_earned: number;
  points_discount: string;
  store_credit_used: string;
  coupon_code: string | null;
  shipping_zone: string;
  shipping_method: 'standard' | 'express';
  ship_name: string;
  ship_line1: string;
  ship_line2: string | null;
  ship_city: string;
  ship_region: string | null;
  ship_postcode: string;
  ship_country: string;
  ship_phone: string | null;
  payment_expires_at: Date | null;
  placed_at: Date;
  delivered_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: CancelReason | null;
  cancel_note: string | null;
  tracking_number: string | null;
};

const REASON_TEXT: Record<CancelReason, string> = {
  changed_mind: 'you changed your mind',
  ordered_by_mistake: 'ordered by mistake',
  found_cheaper: 'found it cheaper elsewhere',
  delivery_too_slow: 'delivery was too slow',
  other: 'cancelled at your request',
  out_of_stock: 'an item went out of stock',
  fraud_suspected: 'the payment needs checking',
  customer_request: 'cancelled at your request',
  payment_failed: 'the payment did not go through',
  payment_timeout: 'the payment was not completed in time',
};

export class OrderService {
  constructor(private readonly ctx: AppContext) {}

  private link = (id: string) => `${this.ctx.config.APP_URL}/account/orders/${id}`;

  private async lockOrder(tx: Queryable, id: string): Promise<OrderRow> {
    const { rows } = await tx.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('That order');
    return rows[0];
  }

  private async event(tx: Queryable, id: string, from: OrderStatus | null, to: OrderStatus, actor: Actor, note: string | null, at: Date) {
    await tx.query(
      'INSERT INTO order_events (order_id, from_status, to_status, actor_id, actor_role, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, from, to, actor.id, actor.role, note, at],
    );
  }

  private async customerName(tx: Queryable, customerId: string) {
    const { rows } = await tx.query<{ name: string }>('SELECT name FROM customers WHERE id = $1', [customerId]);
    return rows[0]?.name ?? 'there';
  }

  private assertMove(o: OrderRow, to: OrderStatus) {
    if (!canMove(o.status, to)) {
      throw new AppError('invalid_transition', `An order that is ${o.status.replace('_', ' ')} cannot be moved to ${to.replace('_', ' ')}.`);
    }
  }

  // ---------- payment outcomes (from checkout and from webhooks) ----------

  /** The card is authorized: confirm the order, keep the stock held without a time limit, empty the cart. */
  async confirm(tx: pg.PoolClient, orderId: string, now: Date): Promise<boolean> {
    const o = await this.lockOrder(tx, orderId);
    if (o.status !== 'pending_payment') return false; // already handled (webhook and redirect both arrive)
    await tx.query(
      "UPDATE orders SET status = 'confirmed', confirmed_at = $2, payment_expires_at = NULL, version = version + 1, updated_at = $2 WHERE id = $1",
      [orderId, now],
    );
    await tx.query("UPDATE payments SET status = 'authorized', updated_at = $2 WHERE order_id = $1", [orderId, now]);
    await tx.query('UPDATE stock_reservations SET expires_at = NULL WHERE order_id = $1 AND released_at IS NULL', [orderId]);
    await tx.query(
      `DELETE FROM cart_items WHERE cart_id = (SELECT id FROM carts WHERE customer_id = $1)
         AND product_id IN (SELECT product_id FROM order_items WHERE order_id = $2)`,
      [o.customer_id, orderId],
    );
    await tx.query('UPDATE carts SET coupon_code = NULL, updated_at = now() WHERE customer_id = $1', [o.customer_id]);
    await this.event(tx, orderId, 'pending_payment', 'confirmed', systemActor, 'Payment authorized', now);
    const { rows: lines } = await tx.query<{ name: string; qty: number; line_total: string }>(
      'SELECT name, qty, line_total FROM order_items WHERE order_id = $1 ORDER BY id',
      [orderId],
    );
    await queueEmail(
      tx,
      o.email,
      'order_confirmed',
      {
        name: await this.customerName(tx, o.customer_id),
        orderId,
        total: o.total,
        lines: lines.map((l) => `${l.qty} x ${l.name}  ${l.line_total}`).join('\n'),
        link: this.link(orderId),
      },
      now,
    );
    return true;
  }

  /** The card failed: the order is cancelled and everything it held is released. */
  async failPayment(tx: pg.PoolClient, orderId: string, code: string, now: Date): Promise<void> {
    const o = await this.lockOrder(tx, orderId);
    if (o.status !== 'pending_payment') return;
    await tx.query("UPDATE payments SET status = 'failed', failure_code = $2, updated_at = $3 WHERE order_id = $1", [
      orderId,
      code,
      now,
    ]);
    await this.release(tx, o, 'payment_failed', null, systemActor, now, { voidPayment: false });
    await queueEmail(tx, o.email, 'payment_failed', { name: await this.customerName(tx, o.customer_id), orderId, link: `${this.ctx.config.APP_URL}/cart` }, now);
  }

  // ---------- cancellation ----------

  async cancel(orderId: string, user: CurrentUser, reason: CancelReason, note: string | null, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      await this.settle(tx, orderId, now);
      const o = await this.lockOrder(tx, orderId);
      const isOwner = o.customer_id === user.id;
      const staff = user.role === 'support' || user.role === 'admin';
      if (!isOwner && !staff) throw notFound('That order');
      const allowed = isOwner && !staff ? CANCELLABLE_BY.customer : CANCELLABLE_BY.support;
      if (!allowed.includes(o.status)) {
        throw new AppError(
          'invalid_transition',
          o.status === 'cancelled'
            ? 'This order is already cancelled.'
            : ['shipped', 'delivered', 'completed'].includes(o.status)
              ? 'This order has shipped, so it can no longer be cancelled. You can return it once it arrives.'
              : 'This order is being packed and can no longer be cancelled online. Contact support.',
        );
      }
      if (isOwner && !staff && !(['changed_mind', 'ordered_by_mistake', 'found_cheaper', 'delivery_too_slow', 'other'] as string[]).includes(reason)) {
        throw new AppError('validation_failed', 'Choose a reason for cancelling.', { errors: [{ path: 'reason', message: 'Choose a reason.' }] });
      }
      if (reason === 'other' && !note) {
        throw new AppError('validation_failed', 'Tell us a little more.', { errors: [{ path: 'note', message: 'Tell us why.' }] });
      }
      const actor = actorOf(user, o.customer_id);
      await this.release(tx, o, reason, note, actor, now, { voidPayment: true });
      if (actor.kind === 'staff') await audit(tx, user, 'order.cancel', { type: 'order', id: orderId }, { before: { status: o.status }, after: { status: 'cancelled', reason, note } }, now);
      await queueEmail(
        tx,
        o.email,
        'order_cancelled',
        { name: await this.customerName(tx, o.customer_id), orderId, reason: REASON_TEXT[reason], link: this.link(orderId) },
        now,
      );
    });
  }

  /** Cancels an order and releases what it held: stock, the card hold, the coupon use. */
  private async release(
    tx: pg.PoolClient,
    o: OrderRow,
    reason: CancelReason,
    note: string | null,
    actor: Actor,
    now: Date,
    opts: { voidPayment: boolean },
  ) {
    this.assertMove(o, 'cancelled');
    await tx.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3, cancel_note = $4,
              payment_expires_at = NULL, version = version + 1, updated_at = $2 WHERE id = $1`,
      [o.id, now, reason, note],
    );
    // Planted bug: cancel_keeps_reservation.
    if (!(await this.ctx.bugs.enabled('cancel_keeps_reservation', tx))) {
      await tx.query('UPDATE stock_reservations SET released_at = $2 WHERE order_id = $1 AND released_at IS NULL AND consumed_at IS NULL', [o.id, now]);
    }
    // Planted bug: cancel_keeps_coupon_use.
    if (!(await this.ctx.bugs.enabled('cancel_keeps_coupon_use', tx))) {
      await tx.query('UPDATE coupon_redemptions SET released_at = $2 WHERE order_id = $1 AND released_at IS NULL', [o.id, now]);
    }
    // Points spent and store credit used on the order go back to the customer.
    await giveBack(tx, o.customer_id, o.points_redeemed, 'redeem_reversal', { orderId: o.id }, now);
    if (toCents(o.store_credit_used) > 0) await addCredit(tx, o.customer_id, o.store_credit_used, 'purchase_reversal', { orderId: o.id }, now);
    if (opts.voidPayment) {
      const { rows } = await tx.query<{ intent_id: string; status: string }>('SELECT intent_id, status FROM payments WHERE order_id = $1', [o.id]);
      const p = rows[0];
      // Planted bug: cancel_leaves_authorization.
      if (p && (p.status === 'authorized' || p.status === 'requires_action') && !(await this.ctx.bugs.enabled('cancel_leaves_authorization', tx))) {
        await this.ctx.gateway.void(tx, p.intent_id);
        await tx.query("UPDATE payments SET status = 'voided', updated_at = $2 WHERE order_id = $1", [o.id, now]);
      }
    }
    await this.event(tx, o.id, o.status, 'cancelled', actor, note ? `${reason}: ${note}` : reason, now);
  }

  // ---------- warehouse ----------

  async pack(orderId: string, user: CurrentUser, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const o = await this.lockOrder(tx, orderId);
      this.assertMove(o, 'packed');
      await tx.query("UPDATE orders SET status = 'packed', packed_at = $2, version = version + 1, updated_at = $2 WHERE id = $1", [orderId, now]);
      await this.event(tx, orderId, o.status, 'packed', actorOf(user), null, now);
      await audit(tx, user, 'order.pack', { type: 'order', id: orderId }, { before: { status: o.status }, after: { status: 'packed' } }, now);
    });
  }

  /** Hands the order to the carrier: the card is charged now, and the held stock leaves the shelf. */
  async ship(orderId: string, user: CurrentUser, trackingNumber: string, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const o = await this.lockOrder(tx, orderId);
      this.assertMove(o, 'shipped');
      const { rows: pays } = await tx.query<{ intent_id: string; amount: string; status: string }>(
        'SELECT intent_id, amount, status FROM payments WHERE order_id = $1 FOR UPDATE',
        [orderId],
      );
      const pay = pays[0];
      // Orders paid fully with store credit have no card to charge.
      if (pay) {
        if (pay.status !== 'authorized') throw new AppError('invalid_transition', 'This order has no authorized payment to charge.');
        await this.ctx.gateway.capture(tx, pay.intent_id, pay.amount);
        await tx.query("UPDATE payments SET status = 'captured', amount_captured = amount, updated_at = $2 WHERE order_id = $1", [orderId, now]);
      }

      const { rows: holds } = await tx.query<{ id: string; product_id: string; qty: number }>(
        `SELECT id, product_id, qty FROM stock_reservations
          WHERE order_id = $1 AND released_at IS NULL AND consumed_at IS NULL ORDER BY product_id FOR UPDATE`,
        [orderId],
      );
      for (const h of holds) {
        await tx.query('UPDATE inventory SET on_hand = on_hand - $2, updated_at = $3 WHERE product_id = $1', [h.product_id, h.qty, now]);
        await tx.query(
          "INSERT INTO stock_movements (product_id, change, reason, order_id, actor_id, created_at) VALUES ($1, $2, 'sale', $3, $4, $5)",
          [h.product_id, -h.qty, orderId, user.id, now],
        );
        await tx.query('UPDATE stock_reservations SET consumed_at = $2 WHERE id = $1', [h.id, now]);
      }
      await tx.query(
        "UPDATE orders SET status = 'shipped', shipped_at = $2, tracking_number = $3, version = version + 1, updated_at = $2 WHERE id = $1",
        [orderId, now, trackingNumber],
      );
      await this.event(tx, orderId, o.status, 'shipped', actorOf(user), `Tracking ${trackingNumber}`, now);
      await audit(tx, user, 'order.ship', { type: 'order', id: orderId }, { before: { status: o.status }, after: { status: 'shipped', trackingNumber } }, now);
      await queueEmail(
        tx,
        o.email,
        'order_shipped',
        { name: await this.customerName(tx, o.customer_id), orderId, trackingNumber, link: this.link(orderId) },
        now,
      );
    });
  }

  async deliver(orderId: string, user: CurrentUser, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const o = await this.lockOrder(tx, orderId);
      this.assertMove(o, 'delivered');
      await tx.query("UPDATE orders SET status = 'delivered', delivered_at = $2, version = version + 1, updated_at = $2 WHERE id = $1", [orderId, now]);
      // Planted bug: points_on_tax_shipping.
      await earnOnDelivery(tx, o, now, { onTaxAndShipping: await this.ctx.bugs.enabled('points_on_tax_shipping', tx) });
      await this.event(tx, orderId, o.status, 'delivered', actorOf(user), null, now);
      await audit(tx, user, 'order.deliver', { type: 'order', id: orderId }, { before: { status: o.status }, after: { status: 'delivered' } }, now);
      await queueEmail(tx, o.email, 'order_delivered', { name: await this.customerName(tx, o.customer_id), orderId, link: this.link(orderId) }, now);
    });
  }

  // ---------- time-based rules ----------

  /** Applies whatever time has decided for this order (payment timeout, completion). Idempotent. */
  async settle(tx: pg.PoolClient, orderId: string, now: Date): Promise<void> {
    const { rows } = await tx.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
    const o = rows[0];
    if (!o) return;
    if (o.status === 'pending_payment' && o.payment_expires_at && o.payment_expires_at <= now) {
      const locked = await this.lockOrder(tx, orderId);
      if (locked.status !== 'pending_payment') return;
      await tx.query("UPDATE payments SET status = 'failed', failure_code = 'timeout', updated_at = $2 WHERE order_id = $1", [orderId, now]);
      await this.release(tx, locked, 'payment_timeout', null, systemActor, now, { voidPayment: true });
      await queueEmail(
        tx,
        o.email,
        'order_cancelled',
        { name: await this.customerName(tx, o.customer_id), orderId, reason: REASON_TEXT.payment_timeout, link: this.link(orderId) },
        now,
      );
    } else if (o.status === 'delivered' && o.delivered_at && returnWindowClosed(o.delivered_at, now)) {
      const locked = await this.lockOrder(tx, orderId);
      if (locked.status !== 'delivered') return;
      const { rows: open } = await tx.query("SELECT 1 FROM returns WHERE order_id = $1 AND status IN ('requested', 'approved')", [orderId]);
      if (open.length) return; // completes once the return is finished
      await tx.query("UPDATE orders SET status = 'completed', completed_at = $2, version = version + 1, updated_at = $2 WHERE id = $1", [orderId, now]);
      await this.event(tx, orderId, 'delivered', 'completed', systemActor, 'Return window closed', now);
      await releaseOnCompletion(tx, o.customer_id, orderId, now);
    }
  }

  /** Settles every order that time has caught up with. Run by the daily cron and the QA lab. */
  async sweep(now: Date): Promise<{ expired: number; completed: number }> {
    const due = await this.ctx.db.query<{ id: string; status: OrderStatus }>(
      `SELECT id, status FROM orders
        WHERE (status = 'pending_payment' AND payment_expires_at <= $1)
           OR (status = 'delivered' AND delivered_at < $1 - interval '29 days')
        ORDER BY id`,
      [now],
    );
    let expired = 0;
    let completed = 0;
    for (const d of due) {
      await this.ctx.db.tx(async (tx) => {
        await this.settle(tx, d.id, now);
        const { rows } = await tx.query<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = $1', [d.id]);
        if (d.status === 'pending_payment' && rows[0]?.status === 'cancelled') expired++;
        if (d.status === 'delivered' && rows[0]?.status === 'completed') completed++;
      });
    }
    return { expired, completed };
  }

  // ---------- reading ----------

  async view(orderId: string, user: CurrentUser, now: Date): Promise<Order> {
    await this.ctx.db.tx((tx) => this.settle(tx, orderId, now));
    const o = await this.ctx.db.one<OrderRow & { country_name: string }>(
      'SELECT o.*, c.name AS country_name FROM orders o JOIN countries c ON c.code = o.ship_country WHERE o.id = $1',
      [orderId],
    );
    const isStaff = user.role !== 'customer';
    if (!o || (o.customer_id !== user.id && !isStaff)) throw notFound('That order');

    const [lines, payment, events, refunds, returns] = await Promise.all([
      this.ctx.db.query<{
        product_id: string;
        sku: string;
        name: string;
        slug: string;
        image: string;
        unit_price: string;
        qty: number;
        line_total: string;
        discount_alloc: string;
        tax_alloc: string;
        points_alloc: string;
        returnable: boolean;
        claimed: number;
      }>(
        `SELECT oi.product_id, oi.sku, oi.name, p.slug, oi.image, oi.unit_price, oi.qty, oi.line_total, oi.discount_alloc,
                oi.tax_alloc, oi.points_alloc, oi.returnable,
                (SELECT coalesce(sum(ri.qty), 0)::int FROM return_items ri JOIN returns r ON r.id = ri.return_id
                  WHERE ri.order_item_id = oi.id AND r.status NOT IN ('cancelled', 'rejected', 'expired')) AS claimed
           FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1 ORDER BY oi.id`,
        [orderId],
      ),
      this.ctx.db.one<{
        status: NonNullable<Order['payment']>['status'];
        card_brand: string;
        card_last4: string;
        amount: string;
        amount_captured: string;
        amount_refunded: string;
        disputed: boolean;
      }>('SELECT status, card_brand, card_last4, amount, amount_captured, amount_refunded, disputed FROM payments WHERE order_id = $1', [orderId]),
      this.ctx.db.query<{ from_status: OrderStatus | null; to_status: OrderStatus; actor_id: string | null; actor_role: Role | null; note: string | null; created_at: Date }>(
        'SELECT from_status, to_status, actor_id, actor_role, note, created_at FROM order_events WHERE order_id = $1 ORDER BY id',
        [orderId],
      ),
      this.ctx.db.query<{ kind: 'return' | 'goodwill'; method: 'card' | 'store_credit'; amount: string; reason: string; created_at: Date }>(
        'SELECT kind, method, amount, reason, created_at FROM refunds WHERE order_id = $1 ORDER BY id',
        [orderId],
      ),
      this.ctx.db.query<{ id: string; status: ReturnStatus }>('SELECT id, status FROM returns WHERE order_id = $1 ORDER BY id', [orderId]),
    ]);
    const windowFrom = (await this.ctx.bugs.enabled('return_window_order_date')) ? o.placed_at : o.delivered_at;
    const windowOpen = o.status === 'delivered' && !!windowFrom && !returnWindowClosed(windowFrom, now);
    const openReturn = returns.some((r) => r.status === 'requested' || r.status === 'approved');
    const canReturn = (l: { returnable: boolean; qty: number; claimed: number }) => windowOpen && !openReturn && l.returnable ? l.qty - l.claimed : 0;
    const actions = allowedActions(o.status, { id: user.id, role: user.role, isOwner: o.customer_id === user.id });
    if (o.customer_id === user.id && lines.some((l) => canReturn(l) > 0)) actions.push('return');
    if ((user.role === 'support' || user.role === 'admin') && ['shipped', 'delivered', 'completed'].includes(o.status)) actions.push('goodwill');

    return {
      id: o.id,
      status: o.status,
      email: o.email,
      placedAt: o.placed_at.toISOString(),
      paymentExpiresAt: o.payment_expires_at?.toISOString() ?? null,
      lines: lines.map((l) => ({
        productId: l.product_id,
        sku: l.sku,
        name: l.name,
        slug: l.slug,
        image: l.image,
        unitPrice: l.unit_price,
        qty: l.qty,
        lineTotal: l.line_total,
        discount: l.discount_alloc,
        tax: l.tax_alloc,
        returnable: l.returnable,
        pointsDiscount: l.points_alloc,
        returnedQty: l.claimed,
        returnableQty: canReturn(l),
      })),
      totals: {
        subtotal: o.subtotal,
        discount: o.discount,
        pointsDiscount: o.points_discount,
        shipping: o.shipping,
        tax: o.tax,
        taxRate: Number(o.tax_rate).toFixed(2),
        total: o.total,
        storeCredit: o.store_credit_used,
        amountDue: fromCents(toCents(o.total) - toCents(o.store_credit_used)),
      },
      couponCode: o.coupon_code,
      shipping: {
        method: o.shipping_method,
        zone: o.shipping_zone,
        name: o.ship_name,
        line1: o.ship_line1,
        line2: o.ship_line2,
        city: o.ship_city,
        region: o.ship_region,
        postcode: o.ship_postcode,
        countryCode: o.ship_country,
        countryName: o.country_name,
        phone: o.ship_phone,
        trackingNumber: o.tracking_number,
      },
      payment: payment
        ? {
            status: payment.status,
            cardBrand: payment.card_brand,
            cardLast4: payment.card_last4,
            amount: payment.amount,
            captured: payment.amount_captured,
            refunded: payment.amount_refunded,
            disputed: payment.disputed,
          }
        : null,
      cancel: o.cancelled_at && o.cancel_reason ? { reason: o.cancel_reason, note: o.cancel_note, at: o.cancelled_at.toISOString() } : null,
      events: events.map((e) => ({
        from: e.from_status,
        to: e.to_status,
        by: e.actor_id === null ? ('system' as const) : e.actor_role === 'customer' || e.actor_id === o.customer_id ? ('customer' as const) : ('staff' as const),
        note: e.note,
        at: e.created_at.toISOString(),
      })),
      returnWindowEndsAt: o.delivered_at && windowFrom ? returnWindowEnds(windowFrom).toISOString() : null,
      pointsEarned: o.points_earned,
      refunds: refunds.map((r) => ({ kind: r.kind, method: r.method, amount: r.amount, reason: r.reason, at: r.created_at.toISOString() })),
      returns,
      allowedActions: actions,
    };
  }

  async list(filter: { customerId?: string; status?: OrderStatus }, cursor: string | null, limit: number) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filter.customerId) {
      params.push(filter.customerId);
      where.push(`o.customer_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`o.status = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor);
      where.push(`o.id < $${params.length}`);
    }
    params.push(limit + 1);
    const rows = await this.ctx.db.query<{ id: string; status: OrderStatus; placed_at: Date; total: string; item_count: number; images: string[]; email: string }>(
      `SELECT o.id, o.status, o.placed_at, o.total, o.email,
              (SELECT sum(qty)::int FROM order_items WHERE order_id = o.id) AS item_count,
              (SELECT array_agg(image ORDER BY id) FROM (SELECT image, id FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 3) i) AS images
         FROM orders o ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY o.id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    const items: (OrderSummary & { email: string })[] = page.map((r) => ({
      id: r.id,
      status: r.status,
      placedAt: r.placed_at.toISOString(),
      total: r.total,
      itemCount: r.item_count ?? 0,
      images: r.images ?? [],
      email: r.email,
    }));
    return { items, nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
  }
}
