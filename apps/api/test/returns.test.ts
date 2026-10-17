import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Client, json, lastEmail, startApp, type TestApp } from './helpers.js';
import { available, bug, checkout, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const cents = (s: string) => Math.round(Number(s) * 100);
const money = (c: number) => (c / 100).toFixed(2);

/** Moves the shop clock forward by whole days, keeping these clients' sessions alive. */
async function days(n: number, ...clients: Client[]) {
  let left = n;
  while (left > 0) {
    const step = Math.min(left, 10);
    await t.advance(step * 86400);
    for (const c of clients) await c.get('/auth/session');
    left -= step;
  }
}

async function staff() {
  return {
    warehouse: await signedIn(t, 'warehouse@halden.test', true),
    support: await signedIn(t, 'support@halden.test', true),
    admin: await signedIn(t, 'admin@halden.test', true),
  };
}

async function delivered(items: [string, number][], opts: { coupon?: string; points?: number; storeCredit?: boolean } = {}) {
  const c = await newCustomer(t);
  await fill(t, c.client, items);
  if (opts.coupon) expect((await c.client.post('/cart/coupon', { code: opts.coupon })).statusCode).toBe(200);
  const res = await c.client.post(
    '/checkout',
    {
      shipTo: { addressId: c.addressId },
      shippingMethod: 'standard',
      pointsToRedeem: opts.points ?? 0,
      useStoreCredit: opts.storeCredit ?? false,
      card: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123', name: 'Test Shopper' },
    },
    { 'idempotency-key': randomUUID() },
  );
  if (res.statusCode !== 201) throw new Error(res.body);
  const orderId = json(res).orderId as string;
  const s = await staff();
  expect((await s.warehouse.post(`/staff/orders/${orderId}/pack`, {})).statusCode).toBe(200);
  expect((await s.warehouse.post(`/staff/orders/${orderId}/ship`, { trackingNumber: 'HX12345678' })).statusCode).toBe(200);
  expect((await s.warehouse.post(`/staff/orders/${orderId}/deliver`, {})).statusCode).toBe(200);
  const order = json(await c.client.get(`/orders/${orderId}`));
  return { ...c, ...s, orderId, order };
}

const lineOf = (order: Record<string, any>, slug: string) => order.lines.find((l: { slug: string }) => l.slug === slug);
/** What the customer paid for a whole line. */
const paid = (l: { lineTotal: string; discount: string; tax: string; pointsDiscount: string }) =>
  cents(l.lineTotal) - cents(l.discount) - cents(l.pointsDiscount) + cents(l.tax);

async function startReturn(c: Client, orderId: string, productId: string, qty: number, reason: string, extra: Record<string, unknown> = {}) {
  return c.post(`/orders/${orderId}/returns`, { items: [{ productId, qty }], reason, ...extra });
}

describe('starting a return', () => {
  it('a shop-fault return is approved straight away with a free label', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    expect(d.order.allowedActions).toContain('return');
    expect(d.order.returnWindowEndsAt).toBeTruthy();
    const pot = lineOf(d.order, 'titanium-pot');
    const res = await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged');
    expect(res.statusCode).toBe(201);
    const r = json(res);
    expect(r).toMatchObject({ status: 'approved', autoApproved: true, shopFault: true, labelFee: '0.00', estimate: money(paid(pot)) });
    expect(r.label.code).toMatch(/^HRL-/);
    expect(r.allowedActions).toEqual(['cancel']);
    expect((await lastEmail(t.db, d.email))?.template).toBe('return_approved');
  });

  it('a change-of-mind return waits for support and pays the label fee', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'changed_mind'));
    expect(r).toMatchObject({ status: 'requested', autoApproved: false, labelFee: '4.95', estimate: money(paid(pot) - 495), label: null });
    expect((await lastEmail(t.db, d.email))?.template).toBe('return_requested');
    expect((await d.warehouse.post(`/staff/returns/${r.id}/approve`, {})).statusCode).toBe(403);
    const approved = json(await d.support.post(`/staff/returns/${r.id}/approve`, {}));
    expect(approved.status).toBe('approved');
    expect(approved.label.code).toMatch(/^HRL-/);
  });

  it('support can reject a requested return with a reason', async () => {
    const d = await delivered([['titanium-pot', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'not_needed'));
    const rejected = json(await d.support.post(`/staff/returns/${r.id}/reject`, { reason: 'Used on a trip, not returnable' }));
    expect(rejected).toMatchObject({ status: 'rejected', rejectedReason: 'Used on a trip, not returnable' });
    expect((await lastEmail(t.db, d.email))?.template).toBe('return_rejected');
    // The units are free to return again.
    expect(json(await d.client.get(`/orders/${d.orderId}`)).lines[0].returnableQty).toBe(1);
  });

  it('refuses orders that have not been delivered', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const orderId = json(await checkout(c.client, c.addressId)).orderId;
    const productId = json(await c.client.get(`/orders/${orderId}`)).lines[0].productId;
    const res = await startReturn(c.client, orderId, productId, 1, 'damaged');
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe('return_not_allowed');
  });

  it('refuses final-sale products', async () => {
    const d = await delivered([['camp-pillow', 1], ['titanium-pot', 1]]);
    const pillow = lineOf(d.order, 'camp-pillow');
    expect(pillow).toMatchObject({ returnable: false, returnableQty: 0 });
    const res = await startReturn(d.client, d.orderId, pillow.productId, 1, 'damaged');
    expect(res.statusCode).toBe(409);
    expect(json(res).detail).toMatch(/final sale/);
  });

  it('refuses more units than are left to return, and a second open return', async () => {
    const d = await delivered([['insulated-mug', 2], ['titanium-pot', 1]]);
    const mug = lineOf(d.order, 'insulated-mug');
    const pot = lineOf(d.order, 'titanium-pot');
    const tooMany = await startReturn(d.client, d.orderId, mug.productId, 3, 'damaged');
    expect(tooMany.statusCode).toBe(400);
    expect(json(tooMany).errors[0]).toMatchObject({ path: 'items.0.qty', message: 'You can return up to 2.' });
    expect((await startReturn(d.client, d.orderId, mug.productId, 1, 'damaged')).statusCode).toBe(201);
    const second = await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged');
    expect(second.statusCode).toBe(409);
    expect(json(second).detail).toMatch(/still open/);
    expect(json(await d.client.get(`/orders/${d.orderId}`)).allowedActions).not.toContain('return');
  });

  it("only the order's customer can return it", async () => {
    const d = await delivered([['titanium-pot', 1]]);
    const other = await newCustomer(t);
    expect((await startReturn(other.client, d.orderId, d.order.lines[0].productId, 1, 'damaged')).statusCode).toBe(404);
  });

  it('closes 30 days after delivery', async () => {
    const d = await delivered([['titanium-pot', 1]]);
    await days(29, d.client);
    expect(json(await d.client.get(`/orders/${d.orderId}`)).allowedActions).toContain('return');
    await days(2, d.client);
    const res = await startReturn(d.client, d.orderId, d.order.lines[0].productId, 1, 'damaged');
    expect(res.statusCode).toBe(409);
    expect(json(res).detail).toMatch(/window/);
  });

  it('customers with 3 returns in 90 days go to review even for shop-fault reasons', async () => {
    const d = await delivered([['insulated-mug', 4]]);
    const mug = lineOf(d.order, 'insulated-mug');
    for (let i = 0; i < 3; i++) {
      const r = json(await startReturn(d.client, d.orderId, mug.productId, 1, 'damaged'));
      expect(r.status).toBe('approved');
      await d.client.post(`/returns/${r.id}/cancel`, {});
    }
    // Cancelled returns don't count.
    expect(json(await startReturn(d.client, d.orderId, mug.productId, 1, 'damaged')).status).toBe('approved');
    await t.db.query("UPDATE returns SET status = 'refunded' WHERE status = 'cancelled'");
    await t.db.query("UPDATE returns SET status = 'cancelled' WHERE status = 'approved'");
    expect(json(await startReturn(d.client, d.orderId, mug.productId, 1, 'damaged')).status).toBe('requested');
  });
});

describe('receiving and refunding', () => {
  it('as new: full refund to the card, back on the shelf, email with the amount', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const stock = await available(t, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged'));
    expect((await d.support.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] })).statusCode).toBe(403);
    const res = await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] });
    expect(res.statusCode).toBe(200);
    const done = json(res);
    expect(done).toMatchObject({ status: 'refunded', refundTotal: money(paid(pot)), restockingFee: '0.00', shippingRefund: '0.00' });
    expect(done.lines[0]).toMatchObject({ condition: 'as_new', restocked: true, refundAmount: money(paid(pot)) });
    expect(await available(t, 'titanium-pot')).toBe(stock + 1);

    const order = json(await d.client.get(`/orders/${d.orderId}`));
    expect(order.payment).toMatchObject({ status: 'partially_refunded', refunded: money(paid(pot)) });
    expect(order.refunds).toMatchObject([{ kind: 'return', method: 'card', amount: money(paid(pot)) }]);
    expect(lineOf(order, 'titanium-pot')).toMatchObject({ returnedQty: 1, returnableQty: 0 });
    const email = await lastEmail(t.db, d.email);
    expect(email?.template).toBe('return_refunded');
    expect(email?.body_text).toContain(money(paid(pot)));
    const intent = await t.db.one<{ refunded: string }>('SELECT refunded FROM haldenpay.intents');
    expect(intent?.refunded).toBe(money(paid(pot)));
  });

  it('opened, customer reason: 15% restocking fee and the label fee come off', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'changed_mind'));
    await d.support.post(`/staff/returns/${r.id}/approve`, {});
    const done = json(await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'opened' }] }));
    const fee = Math.round(paid(pot) * 0.15);
    expect(done).toMatchObject({ status: 'refunded', restockingFee: money(fee), labelFee: '4.95', refundTotal: money(paid(pot) - fee - 495) });
  });

  it('opened, shop fault: no restocking fee', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'not_as_described'));
    const done = json(await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'opened' }] }));
    expect(done).toMatchObject({ restockingFee: '0.00', refundTotal: money(paid(pot)) });
  });

  it('damaged by the customer: that line gets nothing and is written off', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const lamp = lineOf(d.order, 'headlamp-400');
    const potStock = await available(t, 'titanium-pot');
    const lampStock = await available(t, 'headlamp-400');
    const r = json(
      await d.client.post(`/orders/${d.orderId}/returns`, {
        items: [
          { productId: pot.productId, qty: 1 },
          { productId: lamp.productId, qty: 1 },
        ],
        reason: 'damaged',
      }),
    );
    const done = json(
      await d.warehouse.post(`/staff/returns/${r.id}/receive`, {
        items: [
          { productId: pot.productId, condition: 'damaged_by_customer' },
          { productId: lamp.productId, condition: 'faulty' },
        ],
      }),
    );
    // Everything came back for a shop-fault reason, so shipping would be refunded; this order shipped free.
    expect(done).toMatchObject({ status: 'partially_refunded', refundTotal: money(paid(lamp)) });
    expect(done.lines.map((l: { restocked: boolean }) => l.restocked)).toEqual([false, false]);
    expect(await available(t, 'titanium-pot')).toBe(potStock);
    expect(await available(t, 'headlamp-400')).toBe(lampStock);
  });

  it('a shop-fault return of the whole order also refunds shipping', async () => {
    const d = await delivered([['insulated-mug', 1]]);
    expect(d.order.totals.shipping).toBe('7.95');
    const mug = lineOf(d.order, 'insulated-mug');
    const r = json(await startReturn(d.client, d.orderId, mug.productId, 1, 'wrong_item'));
    const done = json(await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: mug.productId, condition: 'as_new' }] }));
    expect(done).toMatchObject({ shippingRefund: '7.95', refundTotal: d.order.totals.total });
    const order = json(await d.client.get(`/orders/${d.orderId}`));
    expect(order.payment).toMatchObject({ status: 'refunded', refunded: d.order.totals.total });
  });

  it('returning a line in two parts refunds it exactly once in total', async () => {
    const d = await delivered([['insulated-mug', 3], ['titanium-pot', 1]], { coupon: 'CAMP20' });
    const mug = lineOf(d.order, 'insulated-mug');
    let total = 0;
    for (const qty of [1, 2]) {
      const r = json(await startReturn(d.client, d.orderId, mug.productId, qty, 'damaged'));
      const done = json(await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: mug.productId, condition: 'as_new' }] }));
      total += cents(done.refundTotal);
    }
    expect(total).toBe(paid(mug));
  });

  it('the refund leaves out the coupon share of the line', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]], { coupon: 'CAMP20' });
    const pot = lineOf(d.order, 'titanium-pot');
    expect(cents(pot.discount)).toBeGreaterThan(0);
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged'));
    const done = json(await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] }));
    expect(done.refundTotal).toBe(money(paid(pot)));
  });

  it('store credit: the refund goes to the balance, not the card', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged', { refundMethod: 'store_credit' }));
    await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] });
    const credit = json(await d.client.get('/account/store-credit'));
    expect(credit.balance).toBe(money(paid(pot)));
    expect(credit.history[0]).toMatchObject({ reason: 'refund', amount: money(paid(pot)), orderId: d.orderId });
    expect(json(await d.client.get(`/orders/${d.orderId}`)).payment).toMatchObject({ status: 'captured', refunded: '0.00' });
  });

  it('store credit pays for the next order, alone or with the card', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged', { refundMethod: 'store_credit' }));
    await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] });
    // A mug order (28.00 + tax + 7.95 shipping) is less than the credit: no card needed.
    await fill(t, d.client, [['insulated-mug', 1]]);
    const res = await d.client.post(
      '/checkout',
      { shipTo: { addressId: d.addressId }, shippingMethod: 'standard', useStoreCredit: true },
      { 'idempotency-key': randomUUID() },
    );
    expect(res.statusCode).toBe(201);
    const o = json(await d.client.get(`/orders/${json(res).orderId}`));
    expect(o).toMatchObject({ status: 'confirmed', payment: null });
    expect(o.totals).toMatchObject({ storeCredit: o.totals.total, amountDue: '0.00' });
    expect(json(await d.client.get('/account/store-credit')).balance).toBe(money(paid(pot) - cents(o.totals.total)));
  });

  it('a return can be cancelled before it is received, and then received is refused', async () => {
    const d = await delivered([['titanium-pot', 1]]);
    const r = json(await startReturn(d.client, d.orderId, d.order.lines[0].productId, 1, 'damaged'));
    expect(json(await d.client.post(`/returns/${r.id}/cancel`, {})).status).toBe('cancelled');
    const res = await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: d.order.lines[0].productId, condition: 'as_new' }] });
    expect(res.statusCode).toBe(409);
  });

  it('an unused label expires after 14 days', async () => {
    const d = await delivered([['titanium-pot', 1]]);
    const r = json(await startReturn(d.client, d.orderId, d.order.lines[0].productId, 1, 'damaged'));
    await days(15, d.client, d.admin);
    const sweep = json(await d.admin.post('/qa/sweeps', {}));
    expect(sweep.returnsExpired).toBe(1);
    expect(json(await d.client.get(`/returns/${r.id}`)).status).toBe('expired');
    expect((await lastEmail(t.db, d.email))?.template).toBe('return_expired');
  });

  it('an open return keeps the order from completing; it completes once the return is done', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    await days(25, d.client, d.warehouse, d.support);
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'changed_mind'));
    await days(10, d.client, d.warehouse, d.support);
    expect(json(await d.client.get(`/orders/${d.orderId}`)).status).toBe('delivered');
    await d.support.post(`/staff/returns/${r.id}/approve`, {});
    await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] });
    expect(json(await d.client.get(`/orders/${d.orderId}`)).status).toBe('completed');
  });

  it('lists returns for the customer and for staff', async () => {
    const d = await delivered([['titanium-pot', 1]]);
    const r = json(await startReturn(d.client, d.orderId, d.order.lines[0].productId, 1, 'changed_mind'));
    expect(json(await d.client.get('/returns')).items).toMatchObject([{ id: r.id, orderId: d.orderId, status: 'requested', itemCount: 1 }]);
    expect(json(await d.support.get('/staff/returns?status=requested')).items.map((x: { id: string }) => x.id)).toEqual([r.id]);
    const other = await newCustomer(t);
    expect((await other.client.get(`/returns/${r.id}`)).statusCode).toBe(404);
    expect((await d.client.get('/staff/returns')).statusCode).toBe(403);
  });
});

describe('goodwill refunds', () => {
  const goodwill = (c: Client, orderId: string, amount: string, key = randomUUID()) =>
    c.post(`/staff/orders/${orderId}/goodwill`, { amount, reason: 'Arrived late' }, { 'idempotency-key': key });

  it('support can refund up to 50.00 per order; admin more', async () => {
    const d = await delivered([['ember-stove', 1], ['headlamp-400', 1]]);
    expect(d.order.allowedActions).not.toContain('goodwill');
    expect(json(await d.support.get(`/staff/orders/${d.orderId}`)).allowedActions).toContain('goodwill');
    expect((await goodwill(d.support, d.orderId, '30.00')).statusCode).toBe(200);
    const over = await goodwill(d.support, d.orderId, '30.00');
    expect(over.statusCode).toBe(409);
    expect(json(over)).toMatchObject({ code: 'refund_limit_exceeded' });
    expect(json(over).detail).toContain('20.00 is left');
    const res = await goodwill(d.admin, d.orderId, '60.00');
    expect(res.statusCode).toBe(200);
    expect(json(res).refunds.map((r: { amount: string }) => r.amount)).toEqual(['30.00', '60.00']);
    expect((await lastEmail(t.db, d.email))?.template).toBe('goodwill_refund');
    expect((await goodwill(d.warehouse, d.orderId, '1.00')).statusCode).toBe(403);
    expect((await goodwill(d.client, d.orderId, '1.00')).statusCode).toBe(403);
  });

  it('never more than is left to refund on the order', async () => {
    const d = await delivered([['titanium-pot', 1]]);
    const res = await goodwill(d.admin, d.orderId, money(cents(d.order.totals.total) + 1));
    expect(res.statusCode).toBe(409);
    expect(json(res).detail).toBe(`Only ${d.order.totals.total} can still be refunded on this order.`);
  });

  it('the same Idempotency-Key refunds once', async () => {
    const d = await delivered([['titanium-pot', 1]]);
    const key = randomUUID();
    expect((await goodwill(d.support, d.orderId, '10.00', key)).statusCode).toBe(200);
    expect((await goodwill(d.support, d.orderId, '10.00', key)).statusCode).toBe(200);
    expect(json(await d.client.get(`/orders/${d.orderId}`)).refunds).toHaveLength(1);
  });

  it('is refused before the order ships', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const orderId = json(await checkout(c.client, c.addressId)).orderId;
    const admin = await signedIn(t, 'admin@halden.test', true);
    expect((await goodwill(admin, orderId, '5.00')).statusCode).toBe(409);
  });
});

describe('Halden Points', () => {
  async function givePoints(email: string, points: number) {
    await t.db.query(
      `INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, remaining, expires_at, created_at)
       SELECT id, 'available', 'adjustment', $2, $2, now() + interval '365 days', now() FROM customers WHERE email = $1`,
      [email, points],
    );
  }

  it('delivery earns pending points on goods only; completion makes them available', async () => {
    const d = await delivered([['insulated-mug', 1]]);
    // 28.00 of goods: 28 points. Tax and the 7.95 shipping earn nothing.
    expect(d.order.pointsEarned).toBe(28);
    expect(json(await d.client.get('/account/points'))).toMatchObject({ available: 0, pending: 28, tier: 'base' });
    await days(31, d.client, d.admin);
    await d.admin.post('/qa/sweeps', {});
    const p = json(await d.client.get('/account/points'));
    expect(p).toMatchObject({ available: 28, pending: 0 });
    expect(p.nextExpiry.points).toBe(28);
  });

  it('a returned line loses its pending points', async () => {
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    expect(d.order.pointsEarned).toBe(99);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged'));
    await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] });
    expect(json(await d.client.get('/account/points')).pending).toBe(45);
  });

  it('points pay at checkout; a return gives the line share back as points', async () => {
    const c = await newCustomer(t);
    await givePoints(c.email, 300);
    await fill(t, c.client, [['titanium-pot', 1], ['headlamp-400', 1]]);
    const q = json(await c.client.post('/checkout/quote', { shipTo: { addressId: c.addressId }, pointsToRedeem: 200 }));
    expect(q.points).toMatchObject({ available: 300, redeemed: 200 });
    expect(q.totals.pointsDiscount).toBe('10.00');
    const res = await c.client.post(
      '/checkout',
      { shipTo: { addressId: c.addressId }, pointsToRedeem: 200, card: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123', name: 'T' } },
      { 'idempotency-key': randomUUID() },
    );
    expect(res.statusCode).toBe(201);
    const orderId = json(res).orderId;
    expect(json(await c.client.get('/account/points')).available).toBe(100);

    const s = await staff();
    await s.warehouse.post(`/staff/orders/${orderId}/pack`, {});
    await s.warehouse.post(`/staff/orders/${orderId}/ship`, { trackingNumber: 'HX12345678' });
    await s.warehouse.post(`/staff/orders/${orderId}/deliver`, {});
    const order = json(await c.client.get(`/orders/${orderId}`));
    const pot = lineOf(order, 'titanium-pot');
    const share = Math.round(cents(pot.pointsDiscount) / 5);
    const r = json(await startReturn(c.client, orderId, pot.productId, 1, 'damaged'));
    const done = json(await s.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] }));
    expect(done.pointsRefund).toBe(share);
    expect(done.refundTotal).toBe(money(paid(pot)));
    expect(json(await c.client.get('/account/points')).available).toBe(100 + share);
  });

  it('cancelling gives redeemed points back', async () => {
    const c = await newCustomer(t);
    await givePoints(c.email, 200);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const res = await c.client.post(
      '/checkout',
      { shipTo: { addressId: c.addressId }, pointsToRedeem: 200, card: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123', name: 'T' } },
      { 'idempotency-key': randomUUID() },
    );
    const orderId = json(res).orderId;
    expect(json(await c.client.get('/account/points')).available).toBe(0);
    await c.client.post(`/orders/${orderId}/cancel`, { reason: 'changed_mind' });
    expect(json(await c.client.get('/account/points')).available).toBe(200);
  });

  it('refuses more points than the customer has, or than half the subtotal', async () => {
    const c = await newCustomer(t);
    await givePoints(c.email, 2000);
    await fill(t, c.client, [['insulated-mug', 1]]);
    const res = await c.client.post('/checkout/quote', { shipTo: { addressId: c.addressId }, pointsToRedeem: 400 });
    expect(res.statusCode).toBe(400);
    expect(json(res).errors[0].path).toBe('pointsToRedeem');
  });
});

describe('planted bugs', () => {
  it('refund_ignores_discount: the refund includes the coupon share', async () => {
    await bug(t, 'refund_ignores_discount');
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]], { coupon: 'CAMP20' });
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged'));
    const done = json(await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] }));
    expect(done.refundTotal).toBe(money(paid(pot) + cents(pot.discount)));
  });

  it('restock_damaged: faulty items go back on the shelf', async () => {
    await bug(t, 'restock_damaged');
    const d = await delivered([['titanium-pot', 1]]);
    const stock = await available(t, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, d.order.lines[0].productId, 1, 'damaged'));
    await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: d.order.lines[0].productId, condition: 'faulty' }] });
    expect(await available(t, 'titanium-pot')).toBe(stock + 1);
  });

  it('store_credit_double: a store-credit refund also refunds the card', async () => {
    await bug(t, 'store_credit_double');
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged', { refundMethod: 'store_credit' }));
    await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] });
    expect(json(await d.client.get('/account/store-credit')).balance).toBe(money(paid(pot)));
    expect(json(await d.client.get(`/orders/${d.orderId}`)).payment.refunded).toBe(money(paid(pot)));
  });

  it('refund_over_captured: goodwill can go past what was paid', async () => {
    await bug(t, 'refund_over_captured');
    const d = await delivered([['titanium-pot', 1]]);
    const res = await d.admin.post(`/staff/orders/${d.orderId}/goodwill`, { amount: '500.00', reason: 'Oops' }, { 'idempotency-key': randomUUID() });
    expect(res.statusCode).toBe(200);
    const refunded = json(res).refunds.reduce((n: number, r: { amount: string }) => n + cents(r.amount), 0);
    expect(refunded).toBeGreaterThan(cents(d.order.totals.total));
    // The card gives back what it was charged; the rest lands as store credit.
    expect(json(res).payment.refunded).toBe(d.order.totals.total);
    expect(cents(json(await d.client.get('/account/store-credit')).balance)).toBe(50000 - cents(d.order.totals.total));
  });

  it('support_goodwill_unlimited: support refunds over 50.00', async () => {
    await bug(t, 'support_goodwill_unlimited');
    const d = await delivered([['ember-stove', 1], ['headlamp-400', 1]]);
    const res = await d.support.post(`/staff/orders/${d.orderId}/goodwill`, { amount: '80.00', reason: 'Late' }, { 'idempotency-key': randomUUID() });
    expect(res.statusCode).toBe(200);
  });

  it('points_on_tax_shipping: points are earned on the whole total', async () => {
    await bug(t, 'points_on_tax_shipping');
    const d = await delivered([['insulated-mug', 1]]);
    expect(d.order.pointsEarned).toBe(Math.floor(Number(d.order.totals.total)));
  });

  it('returned_keeps_points: a returned line keeps its pending points', async () => {
    await bug(t, 'returned_keeps_points');
    const d = await delivered([['titanium-pot', 1], ['headlamp-400', 1]]);
    const pot = lineOf(d.order, 'titanium-pot');
    const r = json(await startReturn(d.client, d.orderId, pot.productId, 1, 'damaged'));
    await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId: pot.productId, condition: 'as_new' }] });
    expect(json(await d.client.get('/account/points')).pending).toBe(99);
  });

  it('return_window_restarts: a cancelled return buys another 30 days', async () => {
    const d = await delivered([['titanium-pot', 1]]);
    const productId = d.order.lines[0].productId;
    await days(25, d.client);
    const first = json(await startReturn(d.client, d.orderId, productId, 1, 'changed_mind'));
    await d.client.post(`/returns/${first.id}/cancel`, {});
    await days(10, d.client);
    expect((await startReturn(d.client, d.orderId, productId, 1, 'changed_mind')).statusCode).toBe(409);
    await bug(t, 'return_window_restarts');
    expect((await startReturn(d.client, d.orderId, productId, 1, 'changed_mind')).statusCode).toBe(201);
  });

});
