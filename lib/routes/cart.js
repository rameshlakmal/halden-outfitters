// @ts-check
// The cart lives in the database: a guest's cart is found by a cookie, a signed-in customer's by their id.
import { enabledBugs } from '../bugs.js';
import { query, transaction } from '../db.js';
import { badRequest, cookie, HttpError, int, text } from '../http.js';
import { couponProblem, priceCart } from '../pricing.js';
import { fromCents, toCents } from '../money.js';

export const CART_COOKIE = 'halden_cart';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The cart for this request, or null when there is none yet (and `create` is false).
 * @param {import('../router.js').Context} ctx
 * @param {boolean} create
 * @returns {Promise<string | null>}
 */
export async function cartId(ctx, create) {
  if (ctx.customer) {
    const [row] = await query('SELECT id FROM carts WHERE customer_id = $1', [ctx.customer.id]);
    if (row) return row.id;
    if (!create) return null;
    const [made] = await query(`
      INSERT INTO carts (customer_id) VALUES ($1)
      ON CONFLICT (customer_id) WHERE customer_id IS NOT NULL DO UPDATE SET updated_at = now()
      RETURNING id`, [ctx.customer.id]);
    return made.id;
  }
  const fromCookie = ctx.cookies[CART_COOKIE];
  if (fromCookie && UUID.test(fromCookie)) {
    const [row] = await query('SELECT id FROM carts WHERE id = $1 AND customer_id IS NULL', [fromCookie]);
    if (row) return row.id;
  }
  if (!create) return null;
  const [made] = await query('INSERT INTO carts DEFAULT VALUES RETURNING id');
  ctx.setCookie(cookie(CART_COOKIE, made.id, { maxAge: 60 * 60 * 24 * 30, secure: ctx.secure }));
  return made.id;
}

/**
 * On sign-in, a guest's cart joins the customer's own cart.
 * @param {string} customerId
 * @param {string | undefined} guestCartId
 */
export async function mergeGuestCart(customerId, guestCartId) {
  if (!guestCartId || !UUID.test(guestCartId)) return;
  await transaction(async (db) => {
    const { rows: [guest] } = await db.query('SELECT id, coupon_code FROM carts WHERE id = $1 AND customer_id IS NULL FOR UPDATE', [guestCartId]);
    if (!guest) return;
    const { rows: [own] } = await db.query(`
      INSERT INTO carts (customer_id) VALUES ($1)
      ON CONFLICT (customer_id) WHERE customer_id IS NOT NULL DO UPDATE SET updated_at = now()
      RETURNING id`, [customerId]);
    await db.query(`
      INSERT INTO cart_items (cart_id, product_id, qty)
      SELECT $2, product_id, qty FROM cart_items WHERE cart_id = $1
      ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = least(cart_items.qty + excluded.qty, 20)`, [guest.id, own.id]);
    if (guest.coupon_code) await db.query('UPDATE carts SET coupon_code = coalesce(coupon_code, $2) WHERE id = $1', [own.id, guest.coupon_code]);
    await db.query('DELETE FROM carts WHERE id = $1', [guest.id]);
  });
}

/**
 * The cart with its lines, coupon and totals, as the shop shows it.
 * @param {string | null} id
 */
export async function loadCart(id) {
  const bugs = await enabledBugs(query);
  const items = id ? await query(`
    SELECT p.id::text AS "productId", p.slug, p.name, p.image, p.price::text AS "unitPrice", ci.qty,
           i.stock, p.active
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      JOIN inventory i ON i.product_id = p.id
     WHERE ci.cart_id = $1
     ORDER BY ci.added_at, p.id`, [id]) : [];

  const [cart] = id ? await query('SELECT coupon_code FROM carts WHERE id = $1', [id]) : [];
  const subtotalCents = items.reduce((n, l) => n + toCents(l.unitPrice) * l.qty, 0);
  let coupon = null;
  let couponNote = null;
  if (cart?.coupon_code) {
    const [c] = await query('SELECT * FROM coupons WHERE code = $1', [cart.coupon_code]);
    couponNote = c ? couponProblem(c, subtotalCents, bugs) : 'This code no longer exists.';
    coupon = c && !couponNote ? c : null;
  }

  const lines = items.map((l) => ({
    ...l,
    lineTotal: fromCents(toCents(l.unitPrice) * l.qty),
    problem: !l.active ? 'No longer sold.' : l.stock < l.qty ? (l.stock === 0 ? 'Out of stock.' : `Only ${l.stock} left.`) : null,
  }));
  return {
    items: lines,
    count: lines.reduce((n, l) => n + l.qty, 0),
    coupon: cart?.coupon_code ? { code: cart.coupon_code, applied: coupon !== null, note: couponNote } : null,
    totals: priceCart(items, coupon, bugs),
  };
}

/** @type {import('../router.js').Route[]} */
export const cartRoutes = [
  ['GET', /^\/api\/cart$/, async (ctx) => loadCart(await cartId(ctx, false))],

  ['POST', /^\/api\/cart\/items$/, async (ctx) => {
    const body = await ctx.body();
    const productId = String(int(body.productId, 'productId', { min: 1 }));
    const qty = int(body.qty ?? 1, 'qty', { min: 1, max: 20 });
    const [product] = await query('SELECT p.active, i.stock FROM products p JOIN inventory i ON i.product_id = p.id WHERE p.id = $1', [productId]);
    if (!product || !product.active) throw new HttpError(404, 'That product is not available.');
    const id = await cartId(ctx, true);
    const [row] = await query(`
      INSERT INTO cart_items (cart_id, product_id, qty) VALUES ($1, $2, $3)
      ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = least(cart_items.qty + excluded.qty, 20)
      RETURNING qty`, [id, productId, qty]);
    if (row.qty > product.stock) {
      await query('UPDATE cart_items SET qty = greatest($3, 1) WHERE cart_id = $1 AND product_id = $2', [id, productId, product.stock]);
      throw new HttpError(409, product.stock === 0 ? 'Sorry, that is out of stock.' : `Sorry, only ${product.stock} in stock.`);
    }
    await query('UPDATE carts SET updated_at = now() WHERE id = $1', [id]);
    return loadCart(id);
  }],

  ['PATCH', /^\/api\/cart\/items\/(\d+)$/, async (ctx) => {
    const qty = int((await ctx.body()).qty, 'qty', { min: 1, max: 20 });
    const id = await cartId(ctx, false);
    if (!id) throw new HttpError(404, 'Your cart is empty.');
    const [stock] = await query('SELECT stock FROM inventory WHERE product_id = $1', [ctx.params[0]]);
    if (stock && qty > stock.stock) throw new HttpError(409, `Sorry, only ${stock.stock} in stock.`);
    await query('UPDATE cart_items SET qty = $3 WHERE cart_id = $1 AND product_id = $2', [id, ctx.params[0], qty]);
    return loadCart(id);
  }],

  ['DELETE', /^\/api\/cart\/items\/(\d+)$/, async (ctx) => {
    const id = await cartId(ctx, false);
    if (id) await query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [id, ctx.params[0]]);
    return loadCart(id);
  }],

  ['POST', /^\/api\/cart\/coupon$/, async (ctx) => {
    const code = text((await ctx.body()).code, 'code', { max: 20 }).toUpperCase();
    const [coupon] = await query('SELECT * FROM coupons WHERE code = $1', [code]);
    if (!coupon) throw badRequest('That code is not valid.', { code: 'That code is not valid.' });
    const id = await cartId(ctx, true);
    const cart = await loadCart(id);
    const problem = couponProblem(coupon, toCents(cart.totals.subtotal), await enabledBugs(query));
    if (problem) throw badRequest(problem, { code: problem });
    await query('UPDATE carts SET coupon_code = $2, updated_at = now() WHERE id = $1', [id, code]);
    return loadCart(id);
  }],

  ['DELETE', /^\/api\/cart\/coupon$/, async (ctx) => {
    const id = await cartId(ctx, false);
    if (id) await query('UPDATE carts SET coupon_code = NULL, updated_at = now() WHERE id = $1', [id]);
    return loadCart(id);
  }],
];
