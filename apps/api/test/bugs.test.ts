// Each planted bug, switched on, produces exactly the wrong data it describes (and nothing else changes).
// qa/rules.sql catches each of these from the data alone.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json, startApp, type TestApp } from './helpers.js';
import { available, bug, checkout, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

async function order(items: [string, number][], opts: { coupon?: string; country?: string } = {}) {
  const c = await newCustomer(t, opts.country ?? 'US');
  await fill(t, c.client, items);
  if (opts.coupon) await c.client.post('/cart/coupon', { code: opts.coupon });
  const res = await checkout(c.client, c.addressId);
  if (res.statusCode !== 201) throw new Error(res.body);
  const id = json(res).orderId as string;
  return { ...c, id, order: json(await c.client.get(`/orders/${id}`)) };
}

describe('planted bugs', () => {
  it('coupon_twice doubles the discount with two eligible products', async () => {
    const off = await order(
      [
        ['camp-pillow', 1],
        ['insulated-mug', 1],
      ],
      { coupon: 'CAMP20' },
    );
    expect(off.order.totals.discount).toBe('12.00');
    await bug(t, 'coupon_twice');
    const on = await order(
      [
        ['camp-pillow', 1],
        ['insulated-mug', 1],
      ],
      { coupon: 'CAMP20' },
    );
    expect(on.order.totals.discount).toBe('24.00');
  });

  it('payment_misses_shipping authorizes less than the total', async () => {
    await bug(t, 'payment_misses_shipping');
    const { order: o } = await order([['camp-pillow', 1]]);
    expect(o.totals.shipping).toBe('7.95');
    expect(Number(o.payment.amount)).toBeCloseTo(Number(o.totals.total) - 7.95, 2);
  });

  it('eu_domestic_rate charges Sweden the domestic rate', async () => {
    await bug(t, 'eu_domestic_rate');
    const { order: o } = await order([['camp-pillow', 1]], { country: 'SE' });
    expect(o.shipping.zone).toBe('europe');
    expect(o.totals.shipping).toBe('7.95');
  });

  it('coupon_limit_ignored and coupon_customer_limit_ignored let used-up codes through', async () => {
    await t.reseed({ orders: true });
    await bug(t, 'coupon_limit_ignored');
    const { order: o } = await order([['ridgeline-2p-tent', 1]], { coupon: 'TRAILHEAD15' });
    expect(o.couponCode).toBe('TRAILHEAD15');

    await bug(t, 'coupon_customer_limit_ignored');
    const c = await newCustomer(t);
    for (let i = 0; i < 3; i++) {
      await fill(t, c.client, [['camp-pillow', 1]]);
      await c.client.post('/cart/coupon', { code: 'ALLIN25' });
      expect((await checkout(c.client, c.addressId)).statusCode).toBe(201);
    }
    const uses = await t.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_code = 'ALLIN25'",
    );
    expect(uses?.n).toBe(3); // limit is 2 per customer
  });

  it('cancel_keeps_reservation, cancel_keeps_coupon_use, cancel_leaves_authorization', async () => {
    await bug(t, 'cancel_keeps_reservation');
    await bug(t, 'cancel_keeps_coupon_use');
    await bug(t, 'cancel_leaves_authorization');
    const o = await order([['drift-hammock', 2]], { coupon: 'WELCOME10' });
    await o.client.post(`/orders/${o.id}/cancel`, { reason: 'changed_mind' });
    expect(await available(t, 'drift-hammock')).toBe(1); // still held
    expect(
      (await t.db.one<{ n: number }>('SELECT count(*)::int AS n FROM coupon_redemptions WHERE released_at IS NULL'))?.n,
    ).toBe(1);
    expect(json(await o.client.get(`/orders/${o.id}`)).payment.status).toBe('authorized');
  });

  it('admins switch bugs on and off through the QA lab', async () => {
    const admin = await signedIn(t, 'admin@halden.test', true);
    const list = json(await admin.get('/qa/bugs')).items;
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(list.every((b: { enabled: boolean }) => !b.enabled)).toBe(true);
    expect(json(await admin.put('/qa/bugs/coupon_twice', { enabled: true })).enabled).toBe(true);
    const shopper = await signedIn(t, 'maya@halden.test');
    expect((await shopper.put('/qa/bugs/coupon_twice', { enabled: false })).statusCode).toBe(403);
  });
});
