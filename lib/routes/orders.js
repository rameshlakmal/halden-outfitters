// @ts-check
// Checkout, order history, and cancelling.
import { requireCustomer } from '../auth.js';
import { enabledBugs } from '../bugs.js';
import { query, transaction } from '../db.js';
import { badRequest, HttpError, notFound, text, validate } from '../http.js';
import { fromCents, toCents } from '../money.js';
import { couponProblem, priceCart } from '../pricing.js';

/** Test card numbers, as on payment providers' test pages: any valid number pays, this one is declined. */
export const DECLINED_CARD = '4000000000000002';

/** @param {string} digits */
function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * The order with its lines, payment and history, for its owner or staff.
 * @param {string} id
 * @param {import('../auth.js').Customer} viewer
 */
export async function loadOrder(id, viewer) {
  const [order] = await query(`
    SELECT o.id::text, o.status, o.subtotal::text, o.discount::text, o.shipping::text, o.tax::text, o.total::text,
           o.coupon_code AS "couponCode", o.ship_name AS "shipName", o.ship_line1 AS "shipLine1", o.ship_city AS "shipCity",
           o.ship_postcode AS "shipPostcode", o.ship_country AS "shipCountry", o.created_at AS "createdAt",
           o.customer_id::text AS "customerId", c.name AS "customerName", c.email AS "customerEmail"
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
     WHERE o.id = $1 AND ($2::boolean OR o.customer_id = $3)`, [id, viewer.isAdmin, viewer.id]);
  if (!order) throw notFound('That order');
  const items = await query(`
    SELECT oi.product_id::text AS "productId", oi.name, oi.unit_price::text AS "unitPrice", oi.qty, oi.line_total::text AS "lineTotal",
           p.slug, p.image
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.id`, [id]);
  const [payment] = await query(`
    SELECT amount::text, method, card_last4 AS "cardLast4", status FROM payments WHERE order_id = $1`, [id]);
  const events = await query(`
    SELECT status, note, created_at AS "at" FROM order_events WHERE order_id = $1 ORDER BY id`, [id]);
  return { ...order, items, payment: payment ?? null, events, canCancel: order.status === 'paid' };
}

/**
 * Cancels a paid order: refund, stock back, history. Shipped orders can't be cancelled.
 * @param {string} orderId
 * @param {import('../auth.js').Customer} by
 */
export async function cancelOrder(orderId, by) {
  await transaction(async (db) => {
    const { rows: [order] } = await db.query(
      'SELECT id, status, customer_id::text FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!order || (order.customer_id !== by.id && !by.isAdmin)) throw notFound('That order');
    if (order.status !== 'paid') throw new HttpError(409, order.status === 'cancelled' ? 'This order is already cancelled.' : 'This order has shipped, so it can no longer be cancelled.');

    const bugs = await enabledBugs(db);
    await db.query("UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1", [orderId]);
    await db.query("UPDATE payments SET status = 'refunded', updated_at = now() WHERE order_id = $1", [orderId]);
    if (!bugs.has('cancel_keeps_stock')) { // planted bug: skip returning the stock
      const { rows: items } = await db.query('SELECT product_id, qty FROM order_items WHERE order_id = $1 ORDER BY product_id', [orderId]);
      for (const item of items) {
        await db.query('UPDATE inventory SET stock = stock + $2, updated_at = now() WHERE product_id = $1', [item.product_id, item.qty]);
        await db.query("INSERT INTO stock_movements (product_id, change, reason, order_id) VALUES ($1, $2, 'cancel', $3)", [item.product_id, item.qty, orderId]);
      }
    }
    await db.query("INSERT INTO order_events (order_id, status, note) VALUES ($1, 'cancelled', $2)",
      [orderId, by.isAdmin && order.customer_id !== by.id ? 'Cancelled by the shop' : 'Cancelled by the customer']);
  });
}

/** @type {import('../router.js').Route[]} */
export const orderRoutes = [
  ['POST', /^\/api\/checkout$/, async (ctx) => {
    const customer = requireCustomer(ctx.customer);
    const body = await ctx.body();
    const { card, ...ship } = validate({
      name: () => text(body.name, 'name', { max: 80 }),
      line1: () => text(body.line1, 'line1', { max: 120 }),
      city: () => text(body.city, 'city', { max: 80 }),
      postcode: () => text(body.postcode, 'postcode', { min: 3, max: 12 }),
      country: () => text(body.country, 'country', { max: 60 }),
      card: () => {
        const digits = String(body.cardNumber ?? '').replace(/[\s-]/g, '');
        if (!/^\d{16}$/.test(digits) || !luhnValid(digits)) throw badRequest('Please check the form.', { cardNumber: 'Enter a valid 16-digit card number.' });
        return digits;
      },
    });
    if (card === DECLINED_CARD) throw new HttpError(402, 'Your card was declined. Try another card.');

    const orderId = await transaction(async (db) => {
      const { rows: [cart] } = await db.query('SELECT id, coupon_code FROM carts WHERE customer_id = $1 FOR UPDATE', [customer.id]);
      if (!cart) throw badRequest('Your cart is empty.');
      const { rows: lines } = await db.query(`
        SELECT ci.product_id, ci.qty, p.name, p.price::text AS "unitPrice", p.active
          FROM cart_items ci JOIN products p ON p.id = ci.product_id
         WHERE ci.cart_id = $1
         ORDER BY ci.product_id`, [cart.id]);
      if (lines.length === 0) throw badRequest('Your cart is empty.');

      // Lock the stock rows in a fixed order, so two checkouts for the same products can't deadlock or oversell.
      const { rows: stock } = await db.query(
        'SELECT product_id, stock FROM inventory WHERE product_id = ANY($1) ORDER BY product_id FOR UPDATE',
        [lines.map((l) => l.product_id)]);
      const onHand = new Map(stock.map((s) => [String(s.product_id), s.stock]));
      for (const line of lines) {
        if (!line.active) throw new HttpError(409, `${line.name} is no longer sold. Remove it from your cart to continue.`);
        const left = onHand.get(String(line.product_id)) ?? 0;
        if (left < line.qty) throw new HttpError(409, left === 0 ? `${line.name} has just sold out.` : `Only ${left} ${line.name} left. Please change the quantity.`);
      }

      const bugs = await enabledBugs(db);
      let coupon = null;
      if (cart.coupon_code) {
        const { rows: [c] } = await db.query('SELECT * FROM coupons WHERE code = $1 FOR UPDATE', [cart.coupon_code]);
        const subtotal = lines.reduce((n, l) => n + toCents(l.unitPrice) * l.qty, 0);
        const problem = c ? couponProblem(c, subtotal, bugs) : 'This code no longer exists.';
        if (problem) throw new HttpError(409, `Code ${cart.coupon_code}: ${problem} Remove it to continue.`);
        coupon = c;
      }
      const totals = priceCart(lines, coupon, bugs);

      const { rows: [order] } = await db.query(`
        INSERT INTO orders (customer_id, subtotal, discount, shipping, tax, total, coupon_code,
                            ship_name, ship_line1, ship_city, ship_postcode, ship_country)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id`,
        [customer.id, totals.subtotal, totals.discount, totals.shipping, totals.tax, totals.total, coupon?.code ?? null,
          ship.name, ship.line1, ship.city, ship.postcode, ship.country]);

      for (const line of lines) {
        await db.query(`
          INSERT INTO order_items (order_id, product_id, name, unit_price, qty, line_total)
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [order.id, line.product_id, line.name, line.unitPrice, line.qty, fromCents(toCents(line.unitPrice) * line.qty)]);
        await db.query('UPDATE inventory SET stock = stock - $2, updated_at = now() WHERE product_id = $1', [line.product_id, line.qty]);
        await db.query("INSERT INTO stock_movements (product_id, change, reason, order_id) VALUES ($1, $2, 'sale', $3)", [line.product_id, -line.qty, order.id]);
      }

      const charged = bugs.has('payment_misses_shipping') // planted bug: shipping left off the charge
        ? fromCents(toCents(totals.total) - toCents(totals.shipping))
        : totals.total;
      await db.query('INSERT INTO payments (order_id, amount, card_last4) VALUES ($1, $2, $3)', [order.id, charged, card.slice(-4)]);
      await db.query("INSERT INTO order_events (order_id, status, note) VALUES ($1, 'paid', 'Order placed and paid')", [order.id]);
      if (coupon) await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE code = $1', [coupon.code]);
      await db.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);
      await db.query('UPDATE carts SET coupon_code = NULL, updated_at = now() WHERE id = $1', [cart.id]);
      return String(order.id);
    });
    return { orderId };
  }],

  ['GET', /^\/api\/orders$/, async (ctx) => {
    const customer = requireCustomer(ctx.customer);
    return query(`
      SELECT o.id::text, o.status, o.total::text, o.created_at AS "createdAt",
             count(oi.id)::int AS "lineCount", sum(oi.qty)::int AS "itemCount",
             (array_agg(p.image ORDER BY oi.id))[1:3] AS images
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
       WHERE o.customer_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`, [customer.id]);
  }],

  ['GET', /^\/api\/orders\/(\d+)$/, async (ctx) => loadOrder(ctx.params[0], requireCustomer(ctx.customer))],

  ['POST', /^\/api\/orders\/(\d+)\/cancel$/, async (ctx) => {
    const customer = requireCustomer(ctx.customer);
    await cancelOrder(ctx.params[0], customer);
    return loadOrder(ctx.params[0], customer);
  }],
];
