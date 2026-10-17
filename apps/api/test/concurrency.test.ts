// Races: the same thing done twice at the same moment must still obey the rules. Each test fires requests in
// parallel (one database connection each) and checks that exactly one of them wins.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json, startApp, type TestApp } from './helpers.js';
import { available, card, checkout, deliveredOrder, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const codes = (responses: { statusCode: number }[]) => responses.map((r) => r.statusCode).sort();

describe('races', () => {
  it('two shoppers buy the last unit at once: one order, never oversold', async () => {
    await t.db.query(
      "UPDATE inventory SET on_hand = 1 WHERE product_id = (SELECT id FROM products WHERE slug = 'drift-hammock')",
    );
    await t.db.query(
      "UPDATE stock_movements SET change = 1 WHERE reason = 'initial' AND product_id = (SELECT id FROM products WHERE slug = 'drift-hammock')",
    );
    const a = await newCustomer(t);
    const b = await newCustomer(t);
    await fill(t, a.client, [['drift-hammock', 1]]);
    await fill(t, b.client, [['drift-hammock', 1]]);
    const results = await Promise.all([checkout(a.client, a.addressId), checkout(b.client, b.addressId)]);
    expect(codes(results)).toEqual([201, 409]);
    expect(json(results.find((r) => r.statusCode === 409)!).code).toMatch(/stock|cart_has_problems/);
    expect(await available(t, 'drift-hammock')).toBe(0);
  });

  it('a double-clicked Pay button places one order and charges once', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const key = randomUUID();
    const results = await Promise.all([
      checkout(c.client, c.addressId, { key }),
      checkout(c.client, c.addressId, { key }),
    ]);
    // The second either waits for and replays the first (201) or is told the first is still running (409).
    expect(results.map((r) => r.statusCode)).toContain(201);
    const orders = await t.db.query(
      'SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.email = $1',
      [c.email],
    );
    expect(orders).toHaveLength(1);
    expect(await t.db.query('SELECT 1 FROM haldenpay.intents')).toHaveLength(1);
  });

  it('two checkouts spending the same points: only one gets them', async () => {
    const c = await newCustomer(t);
    await t.db.query(
      `INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, remaining, expires_at, created_at)
       SELECT id, 'available', 'adjustment', 200, 200, now() + interval '1 year', now() FROM customers WHERE email = $1`,
      [c.email],
    );
    await fill(t, c.client, [
      ['titanium-pot', 1],
      ['headlamp-400', 1],
    ]);
    const body = { shipTo: { addressId: c.addressId }, pointsToRedeem: 200, card: card() };
    const results = await Promise.all([
      c.client.post('/checkout', body, { 'idempotency-key': randomUUID() }),
      c.client.post('/checkout', body, { 'idempotency-key': randomUUID() }),
    ]);
    const ok = results.filter((r) => r.statusCode === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const spent = await t.db.one<{ n: number }>(
      "SELECT coalesce(-sum(points), 0)::int AS n FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id WHERE c.email = $1 AND kind = 'redeem'",
      [c.email],
    );
    expect(spent?.n).toBe(200);
    expect(json(await c.client.get('/account/points')).available).toBe(0);
  });

  it('two goodwill refunds at once cannot together pass what was paid', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const admin = await signedIn(t, 'admin@halden.test', true);
    const total = Number(json(await d.client.get(`/orders/${d.orderId}`)).totals.total);
    const amount = (Math.floor(total * 0.6 * 100) / 100).toFixed(2);
    const send = () =>
      admin.post(
        `/staff/orders/${d.orderId}/goodwill`,
        { amount, reason: 'Late' },
        { 'idempotency-key': randomUUID() },
      );
    const results = await Promise.all([send(), send()]);
    expect(codes(results)).toEqual([200, 409]);
    const refunded = await t.db.one<{ n: string }>('SELECT sum(amount)::text AS n FROM refunds WHERE order_id = $1', [
      d.orderId,
    ]);
    expect(refunded?.n).toBe(amount);
  });

  it('the same return received twice at once refunds once', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const productId = json(await d.client.get(`/orders/${d.orderId}`)).lines[0].productId;
    const r = json(
      await d.client.post(`/orders/${d.orderId}/returns`, { items: [{ productId, qty: 1 }], reason: 'damaged' }),
    );
    const body = { items: [{ productId, condition: 'as_new' }] };
    const other = await signedIn(t, 'admin@halden.test', true);
    const results = await Promise.all([
      d.warehouse.post(`/staff/returns/${r.id}/receive`, body),
      other.post(`/staff/returns/${r.id}/receive`, body),
    ]);
    expect(codes(results)).toEqual([200, 409]);
    expect(await t.db.query('SELECT 1 FROM refunds WHERE return_id = $1', [r.id])).toHaveLength(1);
    const moves = await t.db.query("SELECT 1 FROM stock_movements WHERE reason = 'return' AND order_id = $1", [
      d.orderId,
    ]);
    expect(moves).toHaveLength(1);
  });

  it('two returns for the same order at once: only one opens', async () => {
    const d = await deliveredOrder(t, [
      ['titanium-pot', 1],
      ['headlamp-400', 1],
    ]);
    const lines = json(await d.client.get(`/orders/${d.orderId}`)).lines;
    const start = (productId: string) =>
      d.client.post(`/orders/${d.orderId}/returns`, { items: [{ productId, qty: 1 }], reason: 'damaged' });
    const results = await Promise.all([start(lines[0].productId), start(lines[1].productId)]);
    expect(codes(results)).toEqual([201, 409]);
  });

  it('a coupon with one use left, used by two shoppers at once: used once', async () => {
    await t.db.query(
      "INSERT INTO coupons (code, kind, value, max_uses, description) VALUES ('LASTONE', 'percent', 10, 1, 'One use')",
    );
    const a = await newCustomer(t);
    const b = await newCustomer(t);
    for (const c of [a, b]) {
      await fill(t, c.client, [['titanium-pot', 1]]);
      await c.client.post('/cart/coupon', { code: 'LASTONE' });
    }
    const results = await Promise.all([checkout(a.client, a.addressId), checkout(b.client, b.addressId)]);
    expect(codes(results)).toEqual([201, 409]);
    const uses = await t.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_code = 'LASTONE' AND released_at IS NULL",
    );
    expect(uses?.n).toBe(1);
  });

  it('a product saved by two admins at once: one save wins, the other gets 412', async () => {
    const id = (await t.db.one<{ id: string }>("SELECT id FROM products WHERE slug = 'titanium-pot'"))!.id;
    const a = await signedIn(t, 'admin@halden.test', true);
    const b = await signedIn(t, 'admin@halden.test', true);
    const results = await Promise.all([
      a.req('PATCH', `/staff/products/${id}`, { name: 'Titanium Pot One' }, { 'if-match': '1' }),
      b.req('PATCH', `/staff/products/${id}`, { name: 'Titanium Pot Two' }, { 'if-match': '1' }),
    ]);
    expect(codes(results)).toEqual([200, 412]);
  });
});
