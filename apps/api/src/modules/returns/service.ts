// Return rules (DESIGN.md 3.3 and 3.4):
//   - A customer can return lines of a delivered order within 30 days of delivery (holiday rule in lifecycle.ts),
//     if each product is returnable, the quantity is still available to return, and the order has no other open
//     return.
//   - Shop-fault returns (damaged, wrong item, not as described) worth up to 150.00 are approved straight away,
//     unless the customer has made 3 or more returns in the last 90 days. Everything else waits for support.
//   - An approved return gets a label valid for 14 days; unused, the return expires.
//   - The warehouse grades each line on receipt. The refund, restock or write-off, points back and the email all
//     happen in that one transaction.
//   - Goodwill refunds: support up to 50.00 per order, admin any amount, never more than is left to refund.
import { randomBytes } from 'node:crypto';
import {
  SHOP_FAULT_REASONS,
  type Return,
  type ReturnReason,
  type ReturnStatus,
  type RETURN_ACTIONS,
} from '@halden/contracts';
import { fromCents, toCents } from '@halden/money';
import type pg from 'pg';
import type { CurrentUser } from '../../core/auth.js';
import type { AppContext } from '../../core/context.js';
import type { Queryable } from '../../core/db.js';
import { AppError, fieldError, notFound } from '../../core/errors.js';
import { queueEmail } from '../../core/outbox.js';
import { giveBack, reversePending } from '../loyalty/points.js';
import { returnWindowClosed, returnWindowEnds } from '../orders/lifecycle.js';
import { OrderService } from '../orders/service.js';
import {
  AUTO_APPROVE_LIMIT_CENTS,
  gradedLine,
  LABEL_DAYS,
  LABEL_FEE_CENTS,
  restocks,
  returnTotal,
  REVIEW_AFTER_RETURNS,
  unitRefund,
  type Condition,
} from './maths.js';
import { payOut } from './refunds.js';

const OPEN: ReturnStatus[] = ['requested', 'approved'];
const DONE: ReturnStatus[] = ['received', 'refunded', 'partially_refunded'];
export const SUPPORT_GOODWILL_LIMIT_CENTS = 5_000;

type ReturnAction = (typeof RETURN_ACTIONS)[number];

type ReturnRow = {
  id: string;
  order_id: string;
  customer_id: string;
  status: ReturnStatus;
  reason: ReturnReason;
  note: string | null;
  shop_fault: boolean;
  refund_method: 'card' | 'store_credit';
  auto_approved: boolean;
  label_fee: string;
  restocking_fee: string;
  shipping_refund: string;
  refund_total: string;
  points_refund: number;
  estimate: string;
  label_code: string | null;
  label_expires_at: Date | null;
  rejected_reason: string | null;
  requested_at: Date;
  decided_at: Date | null;
  received_at: Date | null;
  refunded_at: Date | null;
};

type ItemRow = {
  id: string;
  product_id: string;
  name: string;
  image: string;
  qty: number;
  line_total: string;
  discount_alloc: string;
  points_alloc: string;
  tax_alloc: string;
  points_earned: number;
  returnable: boolean;
  /** Units in returns that aren't cancelled, rejected or expired. */
  claimed: number;
  /** Units in returns that have been received (refunded or not). */
  processed: number;
};

const money = (i: ItemRow) => ({
  qty: i.qty,
  lineTotal: toCents(i.line_total),
  discount: toCents(i.discount_alloc),
  points: toCents(i.points_alloc),
  tax: toCents(i.tax_alloc),
  pointsEarned: i.points_earned,
});

const isStaff = (u: CurrentUser) => u.role !== 'customer';
const day = 86400_000;
const dateText = (d: Date) => d.toISOString().slice(0, 10);

export class ReturnService {
  private readonly orders: OrderService;

  constructor(private readonly ctx: AppContext) {
    this.orders = new OrderService(ctx);
  }

  private link = (id: string) => `${this.ctx.config.APP_URL}/account/returns/${id}`;
  private orderLink = (id: string) => `${this.ctx.config.APP_URL}/account/orders/${id}`;

  private async name(tx: Queryable, customerId: string) {
    const { rows } = await tx.query<{ name: string; email: string }>('SELECT name, email FROM customers WHERE id = $1', [customerId]);
    return rows[0] ?? { name: 'there', email: '' };
  }

  /** The order's lines with how much of each is already claimed by returns. */
  async items(db: Queryable, orderId: string): Promise<ItemRow[]> {
    const { rows } = await db.query<ItemRow>(
      `SELECT oi.id, oi.product_id, oi.name, oi.image, oi.qty, oi.line_total, oi.discount_alloc, oi.points_alloc, oi.tax_alloc,
              oi.points_earned, oi.returnable,
              coalesce(sum(ri.qty) FILTER (WHERE r.status NOT IN ('cancelled', 'rejected', 'expired')), 0)::int AS claimed,
              coalesce(sum(ri.qty) FILTER (WHERE r.status IN ('received', 'refunded', 'partially_refunded')), 0)::int AS processed
         FROM order_items oi
         LEFT JOIN return_items ri ON ri.order_item_id = oi.id
         LEFT JOIN returns r ON r.id = ri.return_id
        WHERE oi.order_id = $1
        GROUP BY oi.id ORDER BY oi.id`,
      [orderId],
    );
    return rows;
  }

  /** Why this order can't take a new return right now, or null if it can. */
  async blocker(db: Queryable, o: { id: string; status: string; delivered_at: Date | null; placed_at: Date }, now: Date): Promise<string | null> {
    if (o.status === 'completed') return 'The return window for this order has closed.';
    if (o.status !== 'delivered' || !o.delivered_at) return 'Orders can be returned once they have been delivered.';
    // Planted bug: return_window_order_date.
    const from = (await this.ctx.bugs.enabled('return_window_order_date', db)) ? o.placed_at : o.delivered_at;
    if (returnWindowClosed(from, now)) return `The return window for this order closed on ${dateText(returnWindowEnds(from))}.`;
    const { rows } = await db.query<{ id: string }>("SELECT id FROM returns WHERE order_id = $1 AND status IN ('requested', 'approved')", [o.id]);
    if (rows[0]) return `Return ${rows[0].id} for this order is still open. Finish or cancel it first.`;
    return null;
  }

  // ---------- customer ----------

  async request(
    orderId: string,
    user: CurrentUser,
    input: { items: { productId: string; qty: number }[]; reason: ReturnReason; note: string | null; refundMethod: 'card' | 'store_credit' },
    now: Date,
  ): Promise<string> {
    return this.ctx.db.tx(async (tx) => {
      await this.orders.settle(tx, orderId, now);
      const { rows } = await tx.query<{ id: string; customer_id: string; status: string; delivered_at: Date | null; placed_at: Date; shipping: string; email: string }>(
        'SELECT id, customer_id, status, delivered_at, placed_at, shipping, email FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const o = rows[0];
      if (!o || o.customer_id !== user.id) throw notFound('That order');
      const blocked = await this.blocker(tx, o, now);
      if (blocked) throw new AppError('return_not_allowed', blocked);
      if (input.reason === 'other' && !input.note) throw fieldError('note', 'Tell us what is wrong.');

      const lines = await this.items(tx, orderId);
      const seen = new Set<string>();
      const picked: { item: ItemRow; qty: number }[] = [];
      for (const [i, want] of input.items.entries()) {
        if (seen.has(want.productId)) throw fieldError(`items.${i}.productId`, 'Each product once.');
        seen.add(want.productId);
        const item = lines.find((l) => l.product_id === want.productId);
        if (!item) throw fieldError(`items.${i}.productId`, 'That product is not in this order.');
        if (!item.returnable) throw new AppError('return_not_allowed', `${item.name} is final sale and can't be returned.`);
        const left = item.qty - item.claimed;
        if (want.qty > left) {
          throw fieldError(`items.${i}.qty`, left > 0 ? `You can return up to ${left}.` : 'Already returned.', `You can return up to ${left} of ${item.name}.`);
        }
        picked.push({ item, qty: want.qty });
      }

      const shopFault = SHOP_FAULT_REASONS.includes(input.reason);
      const values = picked.map((p) => unitRefund(money(p.item), p.item.claimed, p.qty).cash);
      const everything = lines.every((l) => l.claimed + (picked.find((p) => p.item.id === l.id)?.qty ?? 0) >= l.qty);
      const shipping = shopFault && everything ? toCents(o.shipping) : 0;
      const labelFee = shopFault ? 0 : LABEL_FEE_CENTS;
      const estimate = returnTotal(values, labelFee, shipping);

      const { rows: recent } = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM returns WHERE customer_id = $1 AND requested_at > $2::timestamptz - interval '90 days' AND status <> 'cancelled'",
        [user.id, now],
      );
      const auto = shopFault && estimate.total <= AUTO_APPROVE_LIMIT_CENTS && (recent[0]?.n ?? 0) < REVIEW_AFTER_RETURNS;

      const { rows: created } = await tx.query<{ id: string }>(
        `INSERT INTO returns (order_id, customer_id, status, reason, note, shop_fault, refund_method, label_fee, estimate,
                              requested_at, updated_at)
         VALUES ($1, $2, 'requested', $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
        [orderId, user.id, input.reason, input.note, shopFault, input.refundMethod, fromCents(estimate.labelFee), fromCents(estimate.total), now],
      );
      const returnId = created[0]!.id;
      for (const p of picked) {
        await tx.query('INSERT INTO return_items (return_id, order_item_id, qty) VALUES ($1, $2, $3)', [returnId, p.item.id, p.qty]);
      }
      await this.event(tx, returnId, null, 'requested', user.id, input.note, now);
      if (auto) {
        await this.approveLocked(tx, returnId, null, now, true);
      } else {
        await queueEmail(tx, o.email, 'return_requested', { name: (await this.name(tx, user.id)).name, returnId, orderId, link: this.link(returnId) }, now);
      }
      return returnId;
    });
  }

  async cancel(returnId: string, user: CurrentUser, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const r = await this.lock(tx, returnId);
      if (r.customer_id !== user.id) throw notFound('That return');
      if (!OPEN.includes(r.status)) throw new AppError('invalid_transition', `A return that is ${r.status.replace('_', ' ')} cannot be cancelled.`);
      await tx.query("UPDATE returns SET status = 'cancelled', updated_at = $2 WHERE id = $1", [returnId, now]);
      await this.event(tx, returnId, r.status, 'cancelled', user.id, null, now);
    });
  }

  // ---------- support ----------

  async approve(returnId: string, user: CurrentUser, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      await this.lock(tx, returnId);
      await this.approveLocked(tx, returnId, user.id, now, false);
    });
  }

  private async approveLocked(tx: pg.PoolClient, returnId: string, actorId: string | null, now: Date, auto: boolean) {
    const r = await this.lock(tx, returnId);
    if (r.status !== 'requested') throw new AppError('invalid_transition', `A return that is ${r.status} cannot be approved.`);
    const code = `HRL-${returnId}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const expires = new Date(now.getTime() + LABEL_DAYS * day);
    await tx.query(
      `UPDATE returns SET status = 'approved', auto_approved = $2, label_code = $3, label_expires_at = $4, decided_at = $5,
              decided_by = $6, updated_at = $5 WHERE id = $1`,
      [returnId, auto, code, expires, now, actorId],
    );
    await this.event(tx, returnId, 'requested', 'approved', actorId, auto ? 'Approved automatically' : null, now);
    const c = await this.name(tx, r.customer_id);
    await queueEmail(
      tx,
      c.email,
      'return_approved',
      { name: c.name, returnId, labelCode: code, labelExpires: dateText(expires), labelFee: r.label_fee, link: this.link(returnId) },
      now,
    );
  }

  async reject(returnId: string, user: CurrentUser, reason: string, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const r = await this.lock(tx, returnId);
      if (r.status !== 'requested') throw new AppError('invalid_transition', `A return that is ${r.status} cannot be rejected.`);
      await tx.query(
        "UPDATE returns SET status = 'rejected', rejected_reason = $2, decided_at = $3, decided_by = $4, updated_at = $3 WHERE id = $1",
        [returnId, reason, now, user.id],
      );
      await this.event(tx, returnId, 'requested', 'rejected', user.id, reason, now);
      const c = await this.name(tx, r.customer_id);
      await queueEmail(tx, c.email, 'return_rejected', { name: c.name, returnId, reason, link: this.link(returnId) }, now);
    });
  }

  // ---------- warehouse ----------

  /** The parcel arrived: grade each line, restock or write off, refund, give points back. */
  async receive(returnId: string, user: CurrentUser, graded: { productId: string; condition: Condition }[], now: Date) {
    await this.ctx.db.tx(async (tx) => {
      await this.settleReturn(tx, returnId, now);
      const r = await this.lock(tx, returnId);
      if (r.status !== 'approved') {
        throw new AppError('invalid_transition', r.status === 'requested' ? 'This return has not been approved yet.' : `A return that is ${r.status} cannot be received.`);
      }
      await tx.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [r.order_id]);
      const lines = await this.items(tx, r.order_id);
      const { rows: mine } = await tx.query<{ id: string; order_item_id: string; qty: number }>(
        'SELECT id, order_item_id, qty FROM return_items WHERE return_id = $1 ORDER BY id',
        [returnId],
      );
      const byProduct = new Map(graded.map((g) => [g.productId, g.condition]));
      if (byProduct.size !== graded.length) throw fieldError('items', 'Grade each product once.');
      for (const g of graded) {
        if (!mine.some((m) => lines.find((l) => l.id === m.order_item_id)?.product_id === g.productId)) {
          throw fieldError('items', 'That product is not in this return.');
        }
      }

      const ignoreDiscount = await this.ctx.bugs.enabled('refund_ignores_discount', tx);
      const restockDamaged = await this.ctx.bugs.enabled('restock_damaged', tx);
      const keepPoints = await this.ctx.bugs.enabled('returned_keeps_points', tx);
      let restockingFee = 0;
      let pointsBack = 0;
      let pointsEarned = 0;
      let anyRejected = false;
      const refunds: number[] = [];
      const summary: string[] = [];
      for (const m of mine) {
        const item = lines.find((l) => l.id === m.order_item_id)!;
        const condition = byProduct.get(item.product_id);
        if (!condition) throw fieldError('items', `Grade ${item.name} too.`);
        const unit = unitRefund(money(item), item.processed, m.qty, { ignoreDiscount });
        const g = gradedLine(unit.cash, unit.pointsBack, condition, r.shop_fault);
        if (condition === 'damaged_by_customer') anyRejected = true;
        restockingFee += g.restockingFee;
        pointsBack += g.pointsBack;
        pointsEarned += unit.pointsEarned;
        refunds.push(g.refund);
        const restocked = restocks(condition, restockDamaged);
        await tx.query('UPDATE return_items SET condition = $2, refund_amount = $3, points_refund = $4, restocked = $5 WHERE id = $1', [
          m.id,
          condition,
          fromCents(g.refund),
          g.pointsBack,
          restocked,
        ]);
        if (restocked) {
          await tx.query('UPDATE inventory SET on_hand = on_hand + $2, updated_at = $3 WHERE product_id = $1', [item.product_id, m.qty, now]);
          await tx.query(
            "INSERT INTO stock_movements (product_id, change, reason, order_id, actor_id, note, created_at) VALUES ($1, $2, 'return', $3, $4, $5, $6)",
            [item.product_id, m.qty, r.order_id, user.id, `Return ${returnId}: ${condition}`, now],
          );
        }
        item.processed += m.qty;
        summary.push(`${m.qty} x ${item.name}: ${condition.replaceAll('_', ' ')}, ${fromCents(g.refund)}`);
      }

      // Shipping comes back when the shop was at fault and this return completes the whole order.
      const { rows: ord } = await tx.query<{ shipping: string; email: string }>('SELECT shipping, email FROM orders WHERE id = $1', [r.order_id]);
      const all = lines.every((l) => l.processed >= l.qty);
      const shippingRefund = r.shop_fault && all ? toCents(ord[0]!.shipping) : 0;
      const total = returnTotal(refunds, toCents(r.label_fee), shippingRefund);
      const status: ReturnStatus = anyRejected ? 'partially_refunded' : 'refunded';

      await tx.query(
        `UPDATE returns SET status = $2, received_at = $3, refunded_at = $3, label_fee = $4, restocking_fee = $5, shipping_refund = $6,
                refund_total = $7, points_refund = $8, updated_at = $3 WHERE id = $1`,
        [returnId, status, now, fromCents(total.labelFee), fromCents(restockingFee), fromCents(shippingRefund), fromCents(total.total), pointsBack],
      );
      await this.event(tx, returnId, 'approved', 'received', user.id, null, now);
      await payOut(
        this.ctx,
        tx,
        {
          orderId: r.order_id,
          customerId: r.customer_id,
          amountCents: total.total,
          method: r.refund_method,
          kind: 'return',
          reason: `Return ${returnId}`,
          returnId,
          actor: { id: user.id, role: user.role },
        },
        now,
      );
      await giveBack(tx, r.customer_id, pointsBack, 'redeem_reversal', { orderId: r.order_id, returnId, note: `Return ${returnId}` }, now);
      // Planted bug: returned_keeps_points.
      if (!keepPoints) await reversePending(tx, r.customer_id, r.order_id, returnId, pointsEarned, now);
      await this.event(tx, returnId, 'received', status, user.id, `Refund ${fromCents(total.total)}`, now);

      const c = await this.name(tx, r.customer_id);
      await queueEmail(
        tx,
        ord[0]!.email,
        'return_refunded',
        {
          name: c.name,
          returnId,
          amount: fromCents(total.total),
          method: r.refund_method === 'card' ? 'card' : 'store credit',
          points: pointsBack,
          lines: summary.join('\n'),
          link: this.link(returnId),
        },
        now,
      );
      // If the return window closed while this return was open, the order completes now.
      await this.orders.settle(tx, r.order_id, now);
    });
  }

  // ---------- goodwill ----------

  async goodwill(orderId: string, user: CurrentUser, input: { amount: string; reason: string; method: 'card' | 'store_credit' }, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const { rows } = await tx.query<{ id: string; customer_id: string; status: string; email: string }>(
        'SELECT id, customer_id, status, email FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const o = rows[0];
      if (!o) throw notFound('That order');
      if (!['shipped', 'delivered', 'completed'].includes(o.status)) {
        throw new AppError('invalid_transition', 'Goodwill refunds are for orders that have shipped. Cancel the order instead.');
      }
      const amount = toCents(input.amount);
      if (user.role === 'support' && !(await this.ctx.bugs.enabled('support_goodwill_unlimited', tx))) {
        const { rows: given } = await tx.query<{ n: string }>(
          "SELECT coalesce(sum(amount), 0)::text AS n FROM refunds WHERE order_id = $1 AND kind = 'goodwill'",
          [orderId],
        );
        const left = SUPPORT_GOODWILL_LIMIT_CENTS - toCents(given[0]!.n);
        if (amount > left) {
          throw new AppError(
            'refund_limit_exceeded',
            `Support can refund up to 50.00 per order as goodwill; ${fromCents(Math.max(left, 0))} is left on this order. Ask an admin for more.`,
          );
        }
      }
      // Planted bug: refund_over_captured.
      const skipLimit = await this.ctx.bugs.enabled('refund_over_captured', tx);
      await payOut(
        this.ctx,
        tx,
        { orderId, customerId: o.customer_id, amountCents: amount, method: input.method, kind: 'goodwill', reason: input.reason, actor: { id: user.id, role: user.role } },
        now,
        { skipLimit },
      );
      const c = await this.name(tx, o.customer_id);
      await queueEmail(
        tx,
        o.email,
        'goodwill_refund',
        { name: c.name, orderId, amount: fromCents(amount), method: input.method === 'card' ? 'card' : 'store credit', reason: input.reason, link: this.orderLink(orderId) },
        now,
      );
    });
  }

  // ---------- time ----------

  /** An approved return whose label ran out expires. */
  private async settleReturn(tx: pg.PoolClient, returnId: string, now: Date): Promise<boolean> {
    const { rows } = await tx.query<ReturnRow>('SELECT * FROM returns WHERE id = $1', [returnId]);
    const r = rows[0];
    if (!r || r.status !== 'approved' || !r.label_expires_at || r.label_expires_at > now) return false;
    const locked = await this.lock(tx, returnId);
    if (locked.status !== 'approved') return false;
    await tx.query("UPDATE returns SET status = 'expired', updated_at = $2 WHERE id = $1", [returnId, now]);
    await this.event(tx, returnId, 'approved', 'expired', null, 'Label not used within 14 days', now);
    const c = await this.name(tx, r.customer_id);
    await queueEmail(tx, c.email, 'return_expired', { name: c.name, returnId, link: this.link(returnId) }, now);
    return true;
  }

  async sweep(now: Date): Promise<number> {
    const due = await this.ctx.db.query<{ id: string }>("SELECT id FROM returns WHERE status = 'approved' AND label_expires_at <= $1 ORDER BY id", [now]);
    let n = 0;
    for (const d of due) if (await this.ctx.db.tx((tx) => this.settleReturn(tx, d.id, now))) n++;
    return n;
  }

  // ---------- reading ----------

  private async lock(tx: Queryable, id: string): Promise<ReturnRow> {
    const { rows } = await tx.query<ReturnRow>('SELECT * FROM returns WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('That return');
    return rows[0];
  }

  private async event(tx: Queryable, id: string, from: ReturnStatus | null, to: ReturnStatus, actorId: string | null, note: string | null, at: Date) {
    await tx.query('INSERT INTO return_events (return_id, from_status, to_status, actor_id, note, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      id,
      from,
      to,
      actorId,
      note,
      at,
    ]);
  }

  private actions(r: ReturnRow, user: CurrentUser): ReturnAction[] {
    const a: ReturnAction[] = [];
    if (r.customer_id === user.id && OPEN.includes(r.status)) a.push('cancel');
    if ((user.role === 'support' || user.role === 'admin') && r.status === 'requested') a.push('approve', 'reject');
    if ((user.role === 'warehouse' || user.role === 'admin') && r.status === 'approved') a.push('receive');
    return a;
  }

  async view(returnId: string, user: CurrentUser, now: Date): Promise<Return> {
    await this.ctx.db.tx((tx) => this.settleReturn(tx, returnId, now));
    const r = await this.ctx.db.one<ReturnRow>('SELECT * FROM returns WHERE id = $1', [returnId]);
    if (!r || (r.customer_id !== user.id && !isStaff(user))) throw notFound('That return');
    const [lines, events] = await Promise.all([
      this.ctx.db.query<{ product_id: string; name: string; image: string; qty: number; condition: Condition | null; refund_amount: string; points_refund: number; restocked: boolean }>(
        `SELECT oi.product_id, oi.name, oi.image, ri.qty, ri.condition, ri.refund_amount, ri.points_refund, ri.restocked
           FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = $1 ORDER BY ri.id`,
        [returnId],
      ),
      this.ctx.db.query<{ from_status: ReturnStatus | null; to_status: ReturnStatus; note: string | null; created_at: Date }>(
        'SELECT from_status, to_status, note, created_at FROM return_events WHERE return_id = $1 ORDER BY id',
        [returnId],
      ),
    ]);
    return {
      id: r.id,
      orderId: r.order_id,
      status: r.status,
      reason: r.reason,
      note: r.note,
      shopFault: r.shop_fault,
      refundMethod: r.refund_method,
      autoApproved: r.auto_approved,
      lines: lines.map((l) => ({
        productId: l.product_id,
        name: l.name,
        image: l.image,
        qty: l.qty,
        condition: l.condition,
        refundAmount: l.refund_amount,
        pointsRefund: l.points_refund,
        restocked: l.restocked,
      })),
      estimate: r.estimate,
      labelFee: r.label_fee,
      restockingFee: r.restocking_fee,
      shippingRefund: r.shipping_refund,
      refundTotal: r.refund_total,
      pointsRefund: r.points_refund,
      label: r.label_code && r.label_expires_at ? { code: r.label_code, expiresAt: r.label_expires_at.toISOString() } : null,
      rejectedReason: r.rejected_reason,
      requestedAt: r.requested_at.toISOString(),
      decidedAt: r.decided_at?.toISOString() ?? null,
      receivedAt: r.received_at?.toISOString() ?? null,
      refundedAt: r.refunded_at?.toISOString() ?? null,
      events: events.map((e) => ({ from: e.from_status, to: e.to_status, note: e.note, at: e.created_at.toISOString() })),
      allowedActions: this.actions(r, user),
    };
  }

  async list(filter: { customerId?: string; status?: ReturnStatus }, cursor: string | null, limit: number) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filter.customerId) {
      params.push(filter.customerId);
      where.push(`r.customer_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`r.status = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor);
      where.push(`r.id < $${params.length}`);
    }
    params.push(limit + 1);
    const rows = await this.ctx.db.query<{ id: string; order_id: string; status: ReturnStatus; reason: ReturnReason; requested_at: Date; refund_total: string; item_count: number }>(
      `SELECT r.id, r.order_id, r.status, r.reason, r.requested_at, r.refund_total,
              (SELECT sum(qty)::int FROM return_items WHERE return_id = r.id) AS item_count
         FROM returns r ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        status: r.status,
        reason: r.reason,
        requestedAt: r.requested_at.toISOString(),
        refundTotal: r.refund_total,
        itemCount: r.item_count ?? 0,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}

export { DONE as RETURN_DONE_STATUSES, OPEN as RETURN_OPEN_STATUSES };
