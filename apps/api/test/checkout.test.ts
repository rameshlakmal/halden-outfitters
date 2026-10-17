import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, json, lastEmail, startApp, type TestApp } from './helpers.js';
import { available, CARDS, card, checkout, fill, newCustomer } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const quote = (c: Client, addressId: string, method: 'standard' | 'express' = 'standard') =>
  c.post('/checkout/quote', { shipTo: { addressId }, shippingMethod: method });

describe('quote', () => {
  it('charges domestic shipping under 75.00 and 8% tax on the goods only', async () => {
    const { client, addressId } = await newCustomer(t, 'US');
    await fill(t, client, [['camp-pillow', 1], ['insulated-mug', 1]]); // 60.00
    const q = json(await quote(client, addressId));
    expect(q.zone.code).toBe('domestic');
    expect(q.totals).toEqual({ subtotal: '60.00', discount: '0.00', pointsDiscount: '0.00', storeCredit: '0.00', amountDue: '72.75', shipping: '7.95', tax: '4.80', taxRate: '8.00', total: '72.75' });
    expect(q.toFreeShipping).toBe('15.00');
    expect(q.shippingOptions.map((o: { method: string; price: string }) => [o.method, o.price])).toEqual([
      ['standard', '7.95'],
      ['express', '14.95'],
    ]);
  });

  it('ships free from 75.00 domestic, but express is never free', async () => {
    const { client, addressId } = await newCustomer(t, 'US');
    await fill(t, client, [['ember-stove', 1], ['camp-pillow', 1]]); // 101.00
    expect(json(await quote(client, addressId)).totals.shipping).toBe('0.00');
    expect(json(await quote(client, addressId, 'express')).totals.shipping).toBe('14.95');
  });

  it('uses the zone of the address: Europe and the rest of the world', async () => {
    const eu = await newCustomer(t, 'SE');
    await fill(t, eu.client, [['ember-stove', 1], ['camp-pillow', 1]]); // 101.00, under Europe's 150.00
    expect(json(await quote(eu.client, eu.addressId)).totals.shipping).toBe('14.95');
    const world = await newCustomer(t, 'JP');
    await fill(t, world.client, [['ridgeline-2p-tent', 1]]);
    const q = json(await quote(world.client, world.addressId));
    expect(q.totals.shipping).toBe('24.95');
    expect(q.shippingOptions).toHaveLength(1); // no express outside Europe and the US
    expect((await quote(world.client, world.addressId, 'express')).statusCode).toBe(400);
  });

  it("refuses an address that isn't yours", async () => {
    const a = await newCustomer(t);
    const b = await newCustomer(t);
    await fill(t, b.client, [['camp-pillow', 1]]);
    const res = await quote(b.client, a.addressId);
    expect(json(res).errors[0].path).toBe('shipTo.addressId');
  });
});

describe('placing an order', () => {
  it('needs a session, a confirmed email and an Idempotency-Key', async () => {
    expect((await new Client(t.app).post('/checkout', {})).statusCode).toBe(401);
    const c = new Client(t.app);
    await c.post('/auth/register', { name: 'Unverified', email: 'unverified@example.com', password: 'a long walk in the woods' });
    const a = json(await c.post('/account/addresses', { name: 'U', line1: '1 Way', city: 'X', postcode: '12345', countryCode: 'US' })).items[0];
    await fill(t, c, [['camp-pillow', 1]]);
    expect(json(await checkout(c, a.id)).code).toBe('email_not_verified');
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 1]]);
    const noKey = await client.post('/checkout', { shipTo: { addressId }, shippingMethod: 'standard', card: card() });
    expect(json(noKey).code).toBe('idempotency_key_missing');
  });

  it('confirms with a good card: totals as quoted, stock held, cart emptied, email sent', async () => {
    const { client, addressId, email } = await newCustomer(t);
    await fill(t, client, [['drift-hammock', 2]]);
    const q = json(await quote(client, addressId));
    const res = await checkout(client, addressId);
    expect(res.statusCode).toBe(201);
    const { orderId, status, nextAction } = json(res);
    expect(status).toBe('confirmed');
    expect(nextAction).toBeNull();

    const order = json(await client.get(`/orders/${orderId}`));
    expect(order.totals).toEqual(q.totals);
    expect(order.payment).toMatchObject({ status: 'authorized', amount: q.totals.total, captured: '0.00', cardLast4: '4242', cardBrand: 'visa' });
    expect(order.lines[0]).toMatchObject({ qty: 2, unitPrice: '64.00', lineTotal: '128.00' });
    expect(order.allowedActions).toEqual(['cancel']);
    expect(await available(t, 'drift-hammock')).toBe(1); // 3 on hand, 2 held
    expect(json(await client.get('/cart')).itemCount).toBe(0);
    expect((await lastEmail(t.db, email))?.template).toBe('order_confirmed');
  });

  it('places one order for a double-click (same key), and refuses the key for a different request', async () => {
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 1]]);
    const key = randomUUID();
    const [a, b] = await Promise.all([checkout(client, addressId, { key }), checkout(client, addressId, { key })]);
    const statuses = [a.statusCode, b.statusCode].sort();
    // One runs; the other either waits for its stored answer or is told the first is still running.
    expect(statuses[0]).toBe(201);
    const again = await checkout(client, addressId, { key });
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(json(again).orderId).toBe(json(a.statusCode === 201 ? a : b).orderId);
    const n = await t.db.one<{ n: number }>('SELECT count(*)::int AS n FROM orders');
    expect(n?.n).toBe(1);
    const other = await client.post('/checkout', { shipTo: { addressId }, shippingMethod: 'express', card: card() }, { 'idempotency-key': key });
    expect(json(other).code).toBe('idempotency_key_reused');
  });

  it('declined: 402, the order is cancelled, stock is released and the cart kept', async () => {
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['drift-hammock', 1]]);
    const res = await checkout(client, addressId, { card: CARDS.declined });
    expect(res.statusCode).toBe(402);
    expect(json(res)).toMatchObject({ code: 'payment_declined', detail: 'Your card was declined. Try another card.' });
    const o = await t.db.one<{ status: string; cancel_reason: string }>('SELECT status, cancel_reason FROM orders');
    expect(o).toEqual({ status: 'cancelled', cancel_reason: 'payment_failed' });
    expect(await available(t, 'drift-hammock')).toBe(3);
    expect(json(await client.get('/cart')).itemCount).toBe(1);
    const insufficient = await checkout(client, addressId, { card: CARDS.insufficient });
    expect(json(insufficient).detail).toBe('Your card has insufficient funds. Try another card.');
  });

  it("refuses a card number that fails the check digit, without creating an order", async () => {
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 1]]);
    const res = await checkout(client, addressId, { card: '4242424242424241' });
    expect(json(res).errors[0].path).toBe('card.number');
    expect((await t.db.one<{ n: number }>('SELECT count(*)::int AS n FROM orders'))?.n).toBe(0);
  });

  it('refuses a cart with a problem line', async () => {
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['drift-hammock', 3]]);
    await t.db.query("UPDATE inventory SET on_hand = 2 WHERE product_id = (SELECT id FROM products WHERE slug = 'drift-hammock')");
    const res = await checkout(client, addressId);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'cart_has_problems', detail: 'Only 2 Drift Hammock left. Change the quantity to continue.' });
  });

  it('two shoppers, one last unit: exactly one order is placed', async () => {
    await t.db.query("UPDATE inventory SET on_hand = 1 WHERE product_id = (SELECT id FROM products WHERE slug = 'ember-stove')");
    const a = await newCustomer(t);
    const b = await newCustomer(t);
    await fill(t, a.client, [['ember-stove', 1]]);
    await fill(t, b.client, [['ember-stove', 1]]);
    const results = await Promise.all([checkout(a.client, a.addressId), checkout(b.client, b.addressId)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await available(t, 'ember-stove')).toBe(0);
  });

  it('a new address typed at checkout is used and saved to the address book', async () => {
    const { client } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 1]]);
    const res = await client.post(
      '/checkout',
      {
        shipTo: { address: { name: 'Robin Fell', line1: '9 Fjord Road', city: 'Bergen', postcode: '5003', countryCode: 'NO' } },
        shippingMethod: 'standard',
        card: card(),
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(res.statusCode).toBe(201);
    const order = json(await client.get(`/orders/${json(res).orderId}`));
    expect(order.shipping).toMatchObject({ city: 'Bergen', countryCode: 'NO', zone: 'europe' });
    expect(json(await client.get('/account/addresses')).items.map((a: { city: string }) => a.city)).toContain('Bergen');
  });
});

describe('the bank step', () => {
  it('waits in pending_payment, then confirms when the customer approves', async () => {
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['camp-pillow', 1]]);
    const res = await checkout(client, addressId, { card: CARDS.bank });
    expect(res.statusCode).toBe(202);
    const { orderId, status, nextAction } = json(res);
    expect(status).toBe('pending_payment');
    expect(nextAction.url).toMatch(/\/checkout\/authenticate\?token=/);
    const pending = json(await client.get(`/orders/${orderId}`));
    expect(pending.allowedActions).toEqual(['pay', 'cancel']);
    expect(json(await client.get('/cart')).itemCount).toBe(1); // kept until paid

    const token = new URL(nextAction.url).searchParams.get('token');
    const answer = await new Client(t.app).post('/payments/authenticate', { token, approve: true });
    expect(json(answer)).toEqual({ orderId, status: 'confirmed' });
    expect(json(await client.get(`/orders/${orderId}`)).payment.status).toBe('authorized');
    expect(json(await client.get('/cart')).itemCount).toBe(0);
    // The link works once.
    expect((await new Client(t.app).post('/payments/authenticate', { token, approve: true })).statusCode).toBe(410);
  });

  it('cancels the order when the customer refuses at the bank', async () => {
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['drift-hammock', 1]]);
    const { orderId, nextAction } = json(await checkout(client, addressId, { card: CARDS.bank }));
    const token = new URL(nextAction.url).searchParams.get('token');
    expect(json(await new Client(t.app).post('/payments/authenticate', { token, approve: false })).status).toBe('cancelled');
    expect(json(await client.get(`/orders/${orderId}`)).cancel.reason).toBe('payment_failed');
    expect(await available(t, 'drift-hammock')).toBe(3);
  });

  it('times out after 30 minutes: cancelled, stock released', async () => {
    const { client, addressId } = await newCustomer(t);
    await fill(t, client, [['drift-hammock', 1]]);
    const { orderId } = json(await checkout(client, addressId, { card: CARDS.bank }));
    expect(await available(t, 'drift-hammock')).toBe(2);
    await t.advance(29 * 60);
    expect(json(await client.get(`/orders/${orderId}`)).status).toBe('pending_payment');
    await t.advance(2 * 60);
    expect(await available(t, 'drift-hammock')).toBe(3); // the hold has expired, even before anything runs
    const order = json(await client.get(`/orders/${orderId}`));
    expect(order).toMatchObject({ status: 'cancelled', cancel: { reason: 'payment_timeout' } });
    expect(order.payment.status).toBe('failed');
  });
});
