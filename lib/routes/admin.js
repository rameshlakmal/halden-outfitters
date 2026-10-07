// @ts-check
// Shop staff: orders, products and stock, coupons, and the QA lab's planted bugs.
import { requireAdmin } from '../auth.js';
import { enabledBugs } from '../bugs.js';
import { query, transaction } from '../db.js';
import { badRequest, HttpError, int, notFound, text } from '../http.js';
import { fromCents, toCents } from '../money.js';
import { cancelOrder, loadOrder } from './orders.js';

/** Where an order can go next from each status (cancelling has its own route). */
const NEXT_STATUS = { paid: 'shipped', shipped: 'delivered' };

/**
 * A price like "84.50" or 84.5, positive, at most two decimals.
 * @param {unknown} value
 */
function price(value) {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s) || toCents(s) <= 0) throw badRequest('Please check the form.', { price: 'A price like 49.00.' });
  return fromCents(toCents(s));
}

/** @type {import('../router.js').Route[]} */
export const adminRoutes = [
  ['GET', /^\/api\/admin\/summary$/, async ({ customer }) => {
    requireAdmin(customer);
    const [totals] = await query(`
      SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS orders,
             coalesce(sum(total) FILTER (WHERE status <> 'cancelled'), 0)::text AS revenue,
             count(*) FILTER (WHERE status = 'paid')::int AS "toShip",
             count(*) FILTER (WHERE created_at > now() - interval '1 day' AND status <> 'cancelled')::int AS "lastDay"
        FROM orders`);
    const lowStock = await query(`
      SELECT p.id::text, p.name, p.slug, p.image, i.stock
        FROM inventory i JOIN products p ON p.id = i.product_id
       WHERE p.active AND i.stock <= 5
       ORDER BY i.stock, p.name`);
    const recent = await query(`
      SELECT o.id::text, o.status, o.total::text, o.created_at AS "createdAt", c.name AS "customerName"
        FROM orders o JOIN customers c ON c.id = o.customer_id
       ORDER BY o.created_at DESC LIMIT 6`);
    const [{ n: bugsOn }] = await query('SELECT count(*)::int AS n FROM qa_bugs WHERE enabled');
    return { ...totals, lowStock, recent, bugsOn };
  }],

  // ---------- orders ----------
  ['GET', /^\/api\/admin\/orders$/, async ({ customer, query: q }) => {
    requireAdmin(customer);
    const status = q.get('status');
    return query(`
      SELECT o.id::text, o.status, o.total::text, o.created_at AS "createdAt", c.name AS "customerName", c.email AS "customerEmail",
             sum(oi.qty)::int AS "itemCount"
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id
       WHERE $1::order_status IS NULL OR o.status = $1::order_status
       GROUP BY o.id, c.id
       ORDER BY o.created_at DESC
       LIMIT 200`, [status && ['paid', 'shipped', 'delivered', 'cancelled'].includes(status) ? status : null]);
  }],

  ['GET', /^\/api\/admin\/orders\/(\d+)$/, async ({ customer, params: [id] }) => loadOrder(id, requireAdmin(customer))],

  ['POST', /^\/api\/admin\/orders\/(\d+)\/advance$/, async ({ customer, params: [id] }) => {
    const admin = requireAdmin(customer);
    await transaction(async (db) => {
      const { rows: [order] } = await db.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (!order) throw notFound('That order');
      const next = NEXT_STATUS[/** @type {keyof typeof NEXT_STATUS} */ (order.status)];
      if (!next) throw new HttpError(409, `A ${order.status} order can't move on.`);
      await db.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [id, next]);
      await db.query('INSERT INTO order_events (order_id, status, note) VALUES ($1, $2, $3)',
        [id, next, next === 'shipped' ? 'Handed to the courier' : 'Delivered']);
    });
    return loadOrder(id, admin);
  }],

  ['POST', /^\/api\/admin\/orders\/(\d+)\/cancel$/, async ({ customer, params: [id] }) => {
    const admin = requireAdmin(customer);
    await cancelOrder(id, admin);
    return loadOrder(id, admin);
  }],

  // ---------- products and stock ----------
  ['GET', /^\/api\/admin\/products$/, async ({ customer }) => {
    requireAdmin(customer);
    return query(`
      SELECT p.id::text, p.slug, p.name, p.price::text, p.image, p.active, p.featured, c.name AS "categoryName", i.stock,
             coalesce((SELECT sum(-m.change) FROM stock_movements m WHERE m.product_id = p.id AND m.reason = 'sale'), 0)::int AS sold
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN inventory i ON i.product_id = p.id
       ORDER BY c.position, p.id`);
  }],

  ['PATCH', /^\/api\/admin\/products\/(\d+)$/, async (ctx) => {
    requireAdmin(ctx.customer);
    const body = await ctx.body();
    const id = ctx.params[0];
    await transaction(async (db) => {
      const { rows: [product] } = await db.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id]);
      if (!product) throw notFound('That product');
      if (body.price !== undefined) {
        const newPrice = price(body.price);
        await db.query('UPDATE products SET price = $2, updated_at = now() WHERE id = $1', [id, newPrice]);
        if ((await enabledBugs(db)).has('price_edit_rewrites_orders')) { // planted bug: history rewritten
          await db.query(`
            UPDATE order_items oi
               SET unit_price = $2::numeric, line_total = $2::numeric * oi.qty
              FROM orders o
             WHERE o.id = oi.order_id AND o.status <> 'cancelled' AND oi.product_id = $1`, [id, newPrice]);
        }
      }
      if (body.active !== undefined) await db.query('UPDATE products SET active = $2, updated_at = now() WHERE id = $1', [id, body.active === true]);
      if (body.featured !== undefined) await db.query('UPDATE products SET featured = $2, updated_at = now() WHERE id = $1', [id, body.featured === true]);
    });
    return { ok: true };
  }],

  ['POST', /^\/api\/admin\/products\/(\d+)\/stock$/, async (ctx) => {
    requireAdmin(ctx.customer);
    const body = await ctx.body();
    const change = int(body.change, 'change', { min: -999, max: 999 });
    if (change === 0) throw badRequest('Please check the form.', { change: 'Enter how many to add or remove.' });
    const reason = change > 0 ? 'restock' : 'adjustment';
    const note = text(body.note, 'note', { max: 120, optional: true }) || null;
    return transaction(async (db) => {
      const { rows: [row] } = await db.query('SELECT stock FROM inventory WHERE product_id = $1 FOR UPDATE', [ctx.params[0]]);
      if (!row) throw notFound('That product');
      if (row.stock + change < 0) throw badRequest('Please check the form.', { change: `Only ${row.stock} in stock.` });
      await db.query('UPDATE inventory SET stock = stock + $2, updated_at = now() WHERE product_id = $1', [ctx.params[0], change]);
      await db.query('INSERT INTO stock_movements (product_id, change, reason, note) VALUES ($1, $2, $3, $4)', [ctx.params[0], change, reason, note]);
      return { stock: row.stock + change };
    });
  }],

  // ---------- coupons ----------
  ['GET', /^\/api\/admin\/coupons$/, async ({ customer }) => {
    requireAdmin(customer);
    return query(`
      SELECT code, kind, value::text, min_subtotal::text AS "minSubtotal", max_uses AS "maxUses", used_count AS "usedCount",
             active, expires_at AS "expiresAt"
        FROM coupons ORDER BY active DESC, code`);
  }],

  ['POST', /^\/api\/admin\/coupons$/, async (ctx) => {
    requireAdmin(ctx.customer);
    const body = await ctx.body();
    const code = text(body.code, 'code', { min: 3, max: 20 }).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) throw badRequest('Please check the form.', { code: 'Letters and numbers only.' });
    const kind = body.kind === 'fixed' ? 'fixed' : 'percent';
    const value = price(body.value);
    if (kind === 'percent' && toCents(value) > 10000) throw badRequest('Please check the form.', { value: 'At most 100%.' });
    const maxUses = body.maxUses === undefined || body.maxUses === '' || body.maxUses === null ? null : int(body.maxUses, 'maxUses', { min: 1, max: 100000 });
    const minSubtotal = body.minSubtotal === undefined || body.minSubtotal === '' ? '0.00' : price(body.minSubtotal);
    const [exists] = await query('SELECT 1 FROM coupons WHERE code = $1', [code]);
    if (exists) throw badRequest('Please check the form.', { code: 'That code already exists.' });
    await query('INSERT INTO coupons (code, kind, value, min_subtotal, max_uses) VALUES ($1, $2, $3, $4, $5)', [code, kind, value, minSubtotal, maxUses]);
    return { ok: true };
  }],

  ['PATCH', /^\/api\/admin\/coupons\/([A-Z0-9]+)$/, async (ctx) => {
    requireAdmin(ctx.customer);
    const { active } = await ctx.body();
    const [row] = await query('UPDATE coupons SET active = $2 WHERE code = $1 RETURNING code', [ctx.params[0], active === true]);
    if (!row) throw notFound('That coupon');
    return { ok: true };
  }],

  // ---------- QA lab ----------
  ['GET', /^\/api\/admin\/bugs$/, async ({ customer }) => {
    requireAdmin(customer);
    return query('SELECT key, title, description, how_to_see AS "howToSee", enabled FROM qa_bugs ORDER BY position');
  }],

  ['PATCH', /^\/api\/admin\/bugs\/([a-z_]+)$/, async (ctx) => {
    requireAdmin(ctx.customer);
    const { enabled } = await ctx.body();
    const [row] = await query('UPDATE qa_bugs SET enabled = $2 WHERE key = $1 RETURNING key', [ctx.params[0], enabled === true]);
    if (!row) throw notFound('That bug');
    return { ok: true };
  }],
];
