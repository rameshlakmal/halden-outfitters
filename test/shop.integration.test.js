// The shop's API against a real PostgreSQL database (halden_test), with the business rules in
// qa/rules.sql checked after each flow. Needs the local database from the README.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

try { process.loadEnvFile(); } catch { /* use the environment */ }
const ADMIN_URL = (process.env.DATABASE_URL ?? '').replace(/\/[^/]+$/, '/postgres');
const TEST_URL = (process.env.DATABASE_URL ?? '').replace(/\/[^/]+$/, '/halden_test');
process.env.DATABASE_URL = TEST_URL;
process.env.SESSION_SECRET ||= 'test-secret-'.padEnd(40, 'x');
process.env.SEED_ADMIN_PASSWORD ||= 'admin-test-password';
process.env.SEED_SHOPPER_PASSWORD ||= 'shopper-test-password';

const { default: api } = await import('../api/index.js');
const { setupDatabase } = await import('../scripts/db-setup.js');
const { closePool, query } = await import('../lib/db.js');

let server;
let base;

/** A browser: keeps its cookies between calls. */
function client() {
  const jar = new Map();
  return async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/Max-Age=0/.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const data = await res.json();
    return { status: res.status, data };
  };
}

async function signIn(email, password = process.env.SEED_SHOPPER_PASSWORD) {
  const c = client();
  const res = await c('POST', '/auth/login', { email, password });
  expect(res.status).toBe(200);
  return c;
}

const ADDRESS = { name: 'Maya Okafor', line1: '14 Larch Street', city: 'Portland', postcode: '97205', country: 'United States', cardNumber: '4242 4242 4242 4242' };
const productId = async (slug) => Number((await query('SELECT id FROM products WHERE slug = $1', [slug]))[0].id);
const stockOf = async (slug) => (await query('SELECT stock FROM inventory i JOIN products p ON p.id = i.product_id WHERE p.slug = $1', [slug]))[0].stock;

/** Runs qa/rules.sql over all rows (Propmaster would limit it to a session's rows); returns the broken rules. */
async function brokenRules() {
  const text = readFileSync(new URL('../qa/rules.sql', import.meta.url), 'utf8');
  const broken = [];
  for (const part of text.split(/^-- rule: /m).slice(1)) {
    const [name, ...sql] = part.split('\n');
    const rows = await query(sql.join('\n').replace(/\{\{(\w+)\}\}/g, '$1').replace(/;\s*$/, ''));
    if (rows.length) broken.push(name.replace(/\s+\[.*\]$/, '').trim());
  }
  return broken;
}

async function setBug(key, on) {
  await query('UPDATE qa_bugs SET enabled = $2 WHERE key = $1', [key, on]);
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'halden_test'");
  if (!rows.length) await admin.query('CREATE DATABASE halden_test');
  await admin.end();
  server = createServer((req, res) => void api(req, res)).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  server?.close();
  await closePool();
});

beforeEach(async () => {
  await setupDatabase();
});

describe('the seeded shop', () => {
  it('keeps every business rule', async () => {
    expect(await brokenRules()).toEqual([]);
  });

  it('lists products by category with stock', async () => {
    const { data } = await client()('GET', '/products?category=sleep&sort=price-asc');
    expect(data.map((p) => [p.name, p.price])).toEqual([['Camp Pillow', '32.00'], ['Wool Camp Blanket', '98.00'], ['Loft Sleeping Pad', '149.00'], ['Alpine Down Bag', '279.00']]);
    expect(data.find((p) => p.slug === 'loft-sleeping-pad').stock).toBe(0);
  });
});

describe('buying', () => {
  it('checks out a cart: order, lines, stock, payment and coupon all line up', async () => {
    const guest = client();
    await guest('POST', '/cart/items', { productId: await productId('ridgeline-2p-tent'), qty: 1 });
    await guest('POST', '/cart/items', { productId: await productId('insulated-mug'), qty: 2 });
    const cart = (await guest('POST', '/cart/coupon', { code: 'welcome10' })).data;
    expect(cart.totals).toEqual({ subtotal: '405.00', discount: '40.50', shipping: '0.00', tax: '29.16', total: '393.66', toFreeShipping: null });

    // Signing in brings the guest cart along.
    const signedIn = await guest('POST', '/auth/login', { email: 'maya@halden.test', password: process.env.SEED_SHOPPER_PASSWORD });
    expect(signedIn.status).toBe(200);
    expect((await guest('GET', '/cart')).data.count).toBe(3);

    const mugsBefore = await stockOf('insulated-mug');
    const { status, data } = await guest('POST', '/checkout', ADDRESS);
    expect(status).toBe(200);
    const order = (await guest('GET', `/orders/${data.orderId}`)).data;
    expect(order).toMatchObject({ status: 'paid', total: '393.66', couponCode: 'WELCOME10', payment: { amount: '393.66', cardLast4: '4242', status: 'captured' } });
    expect(await stockOf('insulated-mug')).toBe(mugsBefore - 2);
    expect((await guest('GET', '/cart')).data.count).toBe(0);
    expect(await brokenRules()).toEqual([]);
  });

  it('refuses a declined card and changes nothing', async () => {
    const c = await signIn('jonas@halden.test');
    await c('POST', '/cart/items', { productId: await productId('ember-stove'), qty: 1 });
    const before = await stockOf('ember-stove');
    const res = await c('POST', '/checkout', { ...ADDRESS, cardNumber: '4000 0000 0000 0002' });
    expect(res.status).toBe(402);
    expect(res.data.error.message).toBe('Your card was declined. Try another card.');
    expect(await stockOf('ember-stove')).toBe(before);
    expect((await c('GET', '/cart')).data.count).toBe(1);
  });

  it('never sells more than is in stock', async () => {
    const c = await signIn('jonas@halden.test');
    const add = await c('POST', '/cart/items', { productId: await productId('drift-hammock'), qty: 5 });
    expect(add.status).toBe(409);
    expect(add.data.error.message).toBe('Sorry, only 3 in stock.');
    await query("UPDATE inventory SET stock = 1 WHERE product_id = (SELECT id FROM products WHERE slug = 'drift-hammock')");
    const res = await c('POST', '/checkout', ADDRESS); // the cart has 3; someone else bought 2 meanwhile
    expect(res.status).toBe(409);
    expect(res.data.error.message).toBe('Only 1 Drift Hammock left. Please change the quantity.');
  });

  it('checks the form and the card number', async () => {
    const c = await signIn('jonas@halden.test');
    await c('POST', '/cart/items', { productId: await productId('camp-pillow'), qty: 1 });
    const res = await c('POST', '/checkout', { ...ADDRESS, postcode: '', cardNumber: '4242 4242 4242 4241' });
    expect(res.status).toBe(400);
    expect(res.data.error.fields).toEqual({ postcode: 'At least 3 characters.', cardNumber: 'Enter a valid 16-digit card number.' }); // every problem at once
  });

  it('turns away expired, used-up and too-small coupons', async () => {
    const c = client();
    await c('POST', '/cart/items', { productId: await productId('camp-pillow'), qty: 1 });
    expect((await c('POST', '/cart/coupon', { code: 'SPRING5' })).data.error.message).toBe('This code has expired.');
    expect((await c('POST', '/cart/coupon', { code: 'TRAILHEAD15' })).data.error.message).toBe('This code has been used up.');
    expect((await c('POST', '/cart/coupon', { code: 'SAVE20' })).data.error.message).toBe('This code needs an order of at least 150.00.');
    expect((await c('POST', '/cart/coupon', { code: 'NOPE' })).data.error.message).toBe('That code is not valid.');
  });
});

describe('cancelling', () => {
  it('refunds the payment and returns the stock', async () => {
    const c = await signIn('maya@halden.test');
    await c('POST', '/cart/items', { productId: await productId('titanium-pot'), qty: 2 });
    const before = await stockOf('titanium-pot');
    const { orderId } = (await c('POST', '/checkout', ADDRESS)).data;
    const cancelled = (await c('POST', `/orders/${orderId}/cancel`, {})).data;
    expect(cancelled).toMatchObject({ status: 'cancelled', canCancel: false, payment: { status: 'refunded' } });
    expect(await stockOf('titanium-pot')).toBe(before);
    expect((await c('POST', `/orders/${orderId}/cancel`, {})).data.error.message).toBe('This order is already cancelled.');
    expect(await brokenRules()).toEqual([]);
  });

  it('is not allowed once an order has shipped, or for someone else', async () => {
    const [shipped] = await query("SELECT id FROM orders WHERE status = 'shipped' LIMIT 1");
    const owner = await signIn('jonas@halden.test');
    expect((await owner('POST', `/orders/${shipped.id}/cancel`, {})).data.error.message).toBe('This order has shipped, so it can no longer be cancelled.');
    const stranger = await signIn('ari@halden.test');
    expect((await stranger('POST', `/orders/${shipped.id}/cancel`, {})).status).toBe(404);
  });
});

describe('accounts and staff', () => {
  it('signs up, rejects a wrong password, and keeps the admin to staff', async () => {
    const c = client();
    const made = await c('POST', '/auth/register', { name: 'Ines Duarte', email: 'Ines@Example.com', password: 'long-enough-1' });
    expect(made.data.customer).toMatchObject({ name: 'Ines Duarte', email: 'ines@example.com', isAdmin: false });
    expect((await c('GET', '/admin/summary')).status).toBe(403);
    expect((await client()('GET', '/admin/summary')).status).toBe(401);
    const wrong = await client()('POST', '/auth/login', { email: 'maya@halden.test', password: 'not-her-password' });
    expect(wrong).toMatchObject({ status: 401, data: { error: { message: 'That email and password do not match.' } } });
    const dup = await client()('POST', '/auth/register', { name: 'X', email: 'maya@halden.test', password: 'long-enough-1' });
    expect(dup.data.error.fields.email).toMatch(/already an account/);
  });

  it('refuses changes that are not sent as JSON', async () => {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a' });
    expect(res.status).toBe(415);
  });

  it('lets staff ship, deliver, restock and edit prices without breaking a rule', async () => {
    const admin = await signIn('admin@halden.test', process.env.SEED_ADMIN_PASSWORD);
    const [paid] = await query("SELECT id FROM orders WHERE status = 'paid' ORDER BY id LIMIT 1");
    expect((await admin('POST', `/admin/orders/${paid.id}/advance`, {})).data.status).toBe('shipped');
    expect((await admin('POST', `/admin/orders/${paid.id}/advance`, {})).data.status).toBe('delivered');
    expect((await admin('POST', `/admin/orders/${paid.id}/advance`, {})).status).toBe(409);
    const pad = await productId('loft-sleeping-pad');
    expect((await admin('POST', `/admin/products/${pad}/stock`, { change: 12 })).data).toEqual({ stock: 12 });
    expect((await admin('POST', `/admin/products/${pad}/stock`, { change: -20 })).data.error.fields.change).toBe('Only 12 in stock.');
    await admin('PATCH', `/admin/products/${await productId('ridgeline-2p-tent')}`, { price: '329' });
    expect(await brokenRules()).toEqual([]);
  });
});

describe('planted bugs: each one breaks a rule that qa/rules.sql catches', () => {
  async function checkoutAs(email, items, coupon) {
    const c = await signIn(email);
    for (const [slug, qty] of items) await c('POST', '/cart/items', { productId: await productId(slug), qty });
    if (coupon) expect((await c('POST', '/cart/coupon', { code: coupon })).status).toBe(200);
    const res = await c('POST', '/checkout', ADDRESS);
    expect(res.status).toBe(200);
    return { c, orderId: res.data.orderId };
  }

  it('coupon applied twice', async () => {
    await setBug('coupon_twice', true);
    await checkoutAs('ari@halden.test', [['camp-pillow', 1], ['insulated-mug', 1]], 'WELCOME10');
    expect(await brokenRules()).toEqual(['The discount is exactly what the coupon gives']);
  });

  it('cancelling keeps the stock', async () => {
    await setBug('cancel_keeps_stock', true);
    const { c, orderId } = await checkoutAs('ari@halden.test', [['daypack-22l', 1]]);
    await c('POST', `/orders/${orderId}/cancel`, {});
    expect(await brokenRules()).toEqual(['A cancelled order returns its items to stock']);
  });

  it('payment misses shipping', async () => {
    await setBug('payment_misses_shipping', true);
    await checkoutAs('ari@halden.test', [['camp-pillow', 1]]);
    expect(await brokenRules()).toEqual(['The card is charged the order total']);
  });

  it('price edits rewrite past orders', async () => {
    await setBug('price_edit_rewrites_orders', true);
    const admin = await signIn('admin@halden.test', process.env.SEED_ADMIN_PASSWORD);
    expect((await admin('PATCH', `/admin/products/${await productId('ember-stove')}`, { price: '79.00' })).status).toBe(200);
    expect(await brokenRules()).toEqual(['Order subtotal matches its lines']);
  });

  it('coupon use limit ignored', async () => {
    await setBug('coupon_limit_ignored', true);
    await checkoutAs('ari@halden.test', [['daypack-22l', 1]], 'TRAILHEAD15');
    expect(await brokenRules()).toEqual(['A coupon is never used more often than allowed']);
  });
});
