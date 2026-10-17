import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json, lastEmail, productId, startApp, type TestApp } from './helpers.js';
import { bug, checkout, deliveredOrder, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const admin = () => signedIn(t, 'admin@halden.test', true);

describe('product admin with optimistic locking', () => {
  it('needs If-Match, refuses a stale version with 412, saves a current one', async () => {
    const a = await admin();
    const id = await productId(t.db, 'titanium-pot');
    const loaded = await a.get(`/staff/products/${id}`);
    expect(loaded.headers.etag).toBe('"1"');
    expect(json(loaded)).toMatchObject({
      version: 1,
      price: '54.00',
      stock: { onHand: 18, reserved: 0, available: 18 },
    });

    const missing = await a.patch(`/staff/products/${id}`, { price: '49.00' });
    expect(missing.statusCode).toBe(428);
    expect(json(missing).code).toBe('precondition_required');

    const saved = await a.req('PATCH', `/staff/products/${id}`, { price: '49.00' }, { 'if-match': '"1"' });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers.etag).toBe('"2"');
    expect(json(saved)).toMatchObject({ price: '49.00', version: 2 });

    const stale = await a.req('PATCH', `/staff/products/${id}`, { name: 'Pot' }, { 'if-match': '"1"' });
    expect(stale.statusCode).toBe(412);
    expect(json(stale).code).toBe('precondition_failed');
    expect(json(await a.get(`/staff/products/${id}`)).name).not.toBe('Pot');
  });

  it('checks the sale price and records the change in the audit log with the request id', async () => {
    const a = await admin();
    const id = await productId(t.db, 'titanium-pot');
    const bad = await a.req('PATCH', `/staff/products/${id}`, { compareAtPrice: '50.00' }, { 'if-match': '1' });
    expect(json(bad).errors[0].path).toBe('compareAtPrice');
    const res = await a.req(
      'PATCH',
      `/staff/products/${id}`,
      { compareAtPrice: '60.00' },
      { 'if-match': '1', 'x-request-id': 'req-test-1234' },
    );
    expect(res.statusCode).toBe(200);
    const log = json(await a.get(`/staff/audit?entityType=product&entityId=${id}`)).items;
    expect(log[0]).toMatchObject({
      action: 'product.update',
      before: { compareAtPrice: null },
      after: { compareAtPrice: '60.00' },
      requestId: 'req-test-1234',
      actor: { role: 'admin' },
    });
  });

  it('only admin edits products; warehouse and support can read', async () => {
    const id = await productId(t.db, 'titanium-pot');
    const support = await signedIn(t, 'support@halden.test', true);
    const warehouse = await signedIn(t, 'warehouse@halden.test', true);
    expect((await support.get(`/staff/products/${id}`)).statusCode).toBe(200);
    expect(
      (await warehouse.req('PATCH', `/staff/products/${id}`, { price: '1.00' }, { 'if-match': '1' })).statusCode,
    ).toBe(403);
    const shopper = await newCustomer(t);
    expect((await shopper.client.get('/staff/products')).statusCode).toBe(403);
  });

  it('a price change leaves placed orders alone; planted bug price_edit_rewrites_orders rewrites them', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 2]]);
    const orderId = json(await checkout(c.client, c.addressId)).orderId;
    const a = await admin();
    const id = await productId(t.db, 'titanium-pot');
    await a.req('PATCH', `/staff/products/${id}`, { price: '40.00' }, { 'if-match': '1' });
    expect(json(await c.client.get(`/orders/${orderId}`)).lines[0]).toMatchObject({
      unitPrice: '54.00',
      lineTotal: '108.00',
    });

    await bug(t, 'price_edit_rewrites_orders');
    await a.req('PATCH', `/staff/products/${id}`, { price: '45.00' }, { 'if-match': '2' });
    const o = json(await c.client.get(`/orders/${orderId}`));
    expect(o.lines[0]).toMatchObject({ unitPrice: '45.00', lineTotal: '90.00' });
    expect(o.totals.subtotal).toBe('108.00');
  });
});

describe('stock', () => {
  it('restocks and writes off, with a movement and an audit entry each', async () => {
    const w = await signedIn(t, 'warehouse@halden.test', true);
    const id = await productId(t.db, 'titanium-pot');
    expect(
      json(await w.post(`/staff/products/${id}/stock`, { change: 5, reason: 'restock', note: 'Delivery 42' })).stock
        .onHand,
    ).toBe(23);
    expect(
      json(await w.post(`/staff/products/${id}/stock`, { change: -2, reason: 'write_off', note: 'Dented' })).stock
        .onHand,
    ).toBe(21);
    const moves = json(await w.get(`/staff/products/${id}/movements`)).items;
    expect(moves.slice(0, 2)).toMatchObject([
      { change: -2, reason: 'write_off', note: 'Dented', by: 'Tomas Berg' },
      { change: 5, reason: 'restock', note: 'Delivery 42' },
    ]);
    expect((await w.post(`/staff/products/${id}/stock`, { change: -1, reason: 'restock' })).statusCode).toBe(400);
    const a = await admin();
    expect(
      json(await a.get(`/staff/audit?entityType=product&entityId=${id}`)).items.map(
        (e: { action: string }) => e.action,
      ),
    ).toEqual(['stock.write_off', 'stock.restock']);
  });

  it('cannot remove stock that is held for orders', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['drift-hammock', 2]]);
    await checkout(c.client, c.addressId);
    const w = await signedIn(t, 'warehouse@halden.test', true);
    const id = await productId(t.db, 'drift-hammock');
    const res = await w.post(`/staff/products/${id}/stock`, { change: -2, reason: 'adjustment' });
    expect(res.statusCode).toBe(400);
    expect(json(res).errors[0].message).toBe('Only 1 can be removed: 2 are held for orders.');
  });

  it('emails the warehouse when an order takes a product to its low-stock threshold', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 13]]);
    await checkout(c.client, c.addressId);
    const email = await lastEmail(t.db, 'warehouse@halden.test', 'low_stock');
    expect(email?.subject).toBe('Low stock: Titanium Pot');
    expect(email?.body_text).toContain('down to 5 available');
  });
});

describe('settings', () => {
  it('a coupon switched off stops working', async () => {
    const a = await admin();
    const coupons = json(await a.get('/staff/coupons')).items;
    expect(coupons.find((c: { code: string }) => c.code === 'CAMP20')).toMatchObject({ active: true, uses: 0 });
    expect(json(await a.patch('/staff/coupons/CAMP20', { active: false })).active).toBe(false);
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    expect((await c.client.post('/cart/coupon', { code: 'CAMP20' })).statusCode).toBe(409);
  });

  it('a new shipping rate and tax rate apply to new quotes', async () => {
    const a = await admin();
    expect(
      json(await a.put('/staff/shipping-rates/domestic/standard', { price: '5.95', freeFrom: '60.00' })),
    ).toMatchObject({ price: '5.95', freeFrom: '60.00' });
    expect(json(await a.put('/staff/tax', { ratePercent: '10' })).ratePercent).toBe('10');
    const c = await newCustomer(t);
    await fill(t, c.client, [['insulated-mug', 1]]);
    const q = json(await c.client.post('/checkout/quote', { shipTo: { addressId: c.addressId } }));
    expect(q.totals).toMatchObject({ shipping: '5.95', tax: '2.80', taxRate: '10.00' });
    expect((await a.put('/staff/tax', { ratePercent: '45' })).statusCode).toBe(400);
    const log = json(await a.get('/staff/audit?entityType=setting')).items;
    expect(log[0]).toMatchObject({ action: 'tax_rate.update', before: '8', after: '10' });
  });

  it('settings are admin only', async () => {
    const support = await signedIn(t, 'support@halden.test', true);
    expect((await support.get('/staff/coupons')).statusCode).toBe(403);
    expect((await support.put('/staff/tax', { ratePercent: '1' })).statusCode).toBe(403);
    expect((await support.get('/staff/audit')).statusCode).toBe(403);
  });
});

describe('customers and roles', () => {
  it('support finds customers; admin changes a role, which signs that account out', async () => {
    const c = await newCustomer(t);
    const support = await signedIn(t, 'support@halden.test', true);
    const found = json(await support.get(`/staff/customers?q=${encodeURIComponent(c.email)}`)).items;
    expect(found).toMatchObject([{ email: c.email, role: 'customer', emailVerified: true, orderCount: 0 }]);
    expect((await support.put(`/staff/customers/${found[0].id}/role`, { role: 'support' })).statusCode).toBe(403);
    const a = await admin();
    expect((await a.put(`/staff/customers/${found[0].id}/role`, { role: 'warehouse' })).statusCode).toBe(204);
    expect(json(await c.client.get('/auth/session')).customer).toBeNull();
    const me = json(await a.get('/auth/session')).customer;
    expect((await a.put(`/staff/customers/${me.id}/role`, { role: 'customer' })).statusCode).toBe(403);
  });
});

describe('audit trail of staff actions', () => {
  it('records warehouse steps, return decisions and goodwill refunds', async () => {
    const d = await deliveredOrder(t, [
      ['titanium-pot', 1],
      ['headlamp-400', 1],
    ]);
    const productIdPot = json(await d.client.get(`/orders/${d.orderId}`)).lines[0].productId;
    const r = json(
      await d.client.post(`/orders/${d.orderId}/returns`, {
        items: [{ productId: productIdPot, qty: 1 }],
        reason: 'changed_mind',
      }),
    );
    const support = await signedIn(t, 'support@halden.test', true);
    await support.post(`/staff/returns/${r.id}/approve`);
    await support.post(
      `/staff/orders/${d.orderId}/goodwill`,
      { amount: '5.00', reason: 'Late' },
      { 'idempotency-key': 'goodwill-key-1' },
    );
    const a = await admin();
    const orderLog = json(await a.get(`/staff/audit?entityType=order&entityId=${d.orderId}`)).items.map(
      (e: { action: string }) => e.action,
    );
    expect(orderLog).toEqual(['refund.goodwill', 'order.deliver', 'order.ship', 'order.pack']);
    const returnLog = json(await a.get(`/staff/audit?entityType=return&entityId=${r.id}`)).items;
    expect(returnLog[0]).toMatchObject({ action: 'return.approve', actor: { role: 'support' } });
  });

  it('records QA lab switches', async () => {
    const a = await admin();
    await a.put('/qa/bugs/coupon_twice', { enabled: true });
    await a.put('/qa/clock', { offsetSeconds: 3600 });
    const log = json(await a.get('/staff/audit')).items.map(
      (e: { action: string; entityId: string }) => `${e.action} ${e.entityId}`,
    );
    expect(log.slice(0, 2)).toEqual(['qa.clock clock_offset_seconds', 'qa.bug_on coupon_twice']);
  });
});

describe('QA lab webhook list', () => {
  it("lists an order's payment events and whether the shop processed them", async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const orderId = json(await checkout(c.client, c.addressId)).orderId;
    const a = await admin();
    const events = json(await a.get(`/qa/webhooks?orderId=${orderId}`)).items;
    expect(events.map((e: { type: string }) => e.type)).toContain('payment.authorized');
    expect(events.every((e: { orderId: string }) => e.orderId === orderId)).toBe(true);
  });
});
