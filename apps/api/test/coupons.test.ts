import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Client, json, startApp, type TestApp } from './helpers.js';
import { checkout, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const apply = (c: Client, code: string) =>
  c.post('/cart/coupon', { code });

describe('applying a code', () => {
  it('shows the discount on the cart', async () => {
    const { client } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 2]]); // 64.00
    const cart = json(await apply(client, 'welcome10'));
    expect(cart.coupon).toEqual({ code: 'WELCOME10', applied: true, problem: null, discount: '6.40', kind: 'percent' });
    expect(cart.discount).toBe('6.40');
  });

  it.each([
    ['NOPE', 'That code is not valid.'],
    ['SPRING5', 'This code has expired.'],
    ['STAFF50', 'This code is no longer active.'],
    ['SAVE20', 'This code needs 150.00 of eligible items (you have 32.00).'],
  ])('refuses %s', async (code, message) => {
    const { client } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 1]]);
    const res = await apply(client, code);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'coupon_invalid', detail: message });
  });

  it("doesn't count sale items or excluded categories", async () => {
    const { client } = await newCustomer(t);
    await fill(t, client, [['fold-camp-chair', 3]]); // on sale: 177.00, but none of it is eligible
    expect(json(await apply(client, 'SAVE20')).detail).toMatch(/Nothing in your cart/);
    await fill(t, client, [['ridgeline-2p-tent', 1], ['camp-pillow', 1]]); // shelter is excluded from CAMP20
    expect(json(await apply(client, 'CAMP20')).coupon.discount).toBe('6.40');
    await fill(t, client, [['fold-camp-chair', 1]]);
    expect(json(await apply(client, 'ALLIN25')).coupon.discount).toBe('14.75'); // this one includes sale items
  });

  it('flags a code that stopped working after it was applied', async () => {
    const { client } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 1]]);
    await apply(client, 'WELCOME10');
    await t.db.query("UPDATE coupons SET active = false WHERE code = 'WELCOME10'");
    const cart = json(await client.get('/cart'));
    expect(cart.coupon).toMatchObject({ applied: false, problem: 'This code is no longer active.', discount: '0.00' });
  });
});

describe('use limits', () => {
  it('a used-up code is refused, and the demo orders used up TRAILHEAD15', async () => {
    await t.reseed({ orders: true });
    const { client } = await newCustomer(t);
    await fill(t, client, [['ridgeline-2p-tent', 1]]);
    expect(json(await apply(client, 'TRAILHEAD15')).detail).toBe('This code has been used up.');
  });

  it('first-order-only and once-per-customer codes', async () => {
    await t.reseed({ orders: true });
    const maya = await signedIn(t, 'maya@halden.test');
    await fill(t, maya, [['camp-pillow', 1]]);
    expect(json(await apply(maya, 'WELCOME10')).detail).toBe('This code is for a first order only.');

    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 1]]);
    await apply(client, 'ALLIN25');
    expect((await checkout(client, addressId)).statusCode).toBe(201);
    await fill(t, client, [['camp-pillow', 1]]);
    await apply(client, 'ALLIN25');
    expect((await checkout(client, addressId)).statusCode).toBe(201);
    await fill(t, client, [['camp-pillow', 1]]);
    expect(json(await apply(client, 'ALLIN25')).detail).toBe('You have used this code as often as allowed.');
  });

  it('cancelling an order gives the use back', async () => {
    await t.db.query("UPDATE coupons SET max_uses = 1 WHERE code = 'SAVE20'");
    const a = await newCustomer(t);
    await fill(t, a.client, [['ridgeline-2p-tent', 1]]);
    await apply(a.client, 'SAVE20');
    const orderId = json(await checkout(a.client, a.addressId)).orderId;
    const b = await newCustomer(t);
    await fill(t, b.client, [['ridgeline-2p-tent', 1]]);
    expect(json(await apply(b.client, 'SAVE20')).detail).toBe('This code has been used up.');
    await a.client.post(`/orders/${orderId}/cancel`, { reason: 'changed_mind' });
    expect(json(await apply(b.client, 'SAVE20')).coupon.applied).toBe(true);
  });

  it('two orders racing for the last use: only one gets it', async () => {
    await t.db.query("UPDATE coupons SET max_uses = 1 WHERE code = 'SAVE20'");
    const a = await newCustomer(t);
    const b = await newCustomer(t);
    for (const c of [a, b]) {
      await fill(t, c.client, [['ridgeline-2p-tent', 1]]);
      await apply(c.client, 'SAVE20');
    }
    const results = await Promise.all([checkout(a.client, a.addressId), checkout(b.client, b.addressId)]);
    const codes = results.map((r) => (r.statusCode === 201 ? 'ok' : json(r).code)).sort();
    expect(codes).toEqual(['coupon_invalid', 'ok']);
  });

  it('the order stores the discount spread over its lines', async () => {
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['ember-stove', 1], ['titanium-pot', 1], ['fold-camp-chair', 1]]);
    await apply(client, 'CAMP20');
    const order = json(await client.get(`/orders/${json(await checkout(client, addressId)).orderId}`));
    const discounts = Object.fromEntries(order.lines.map((l: { name: string; discount: string }) => [l.name, l.discount]));
    // 20% of the stove (69.00) and pot (54.00); the sale chair gets nothing.
    expect(discounts).toEqual({ 'Ember Stove': '13.80', 'Titanium Pot': '10.80', 'Fold Camp Chair': '0.00' });
    expect(order.totals.discount).toBe('24.60');
  });
});
