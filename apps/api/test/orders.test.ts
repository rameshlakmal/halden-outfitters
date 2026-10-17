import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, json, lastEmail, startApp, type TestApp } from './helpers.js';
import { available, checkout, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

async function placed(items: [string, number][] = [['drift-hammock', 1]]) {
  const c = await newCustomer(t);
  await fill(t, c.client, items);
  const res = await checkout(c.client, c.addressId);
  if (res.statusCode !== 201) throw new Error(res.body);
  return { ...c, orderId: json(res).orderId as string };
}

describe('reading orders', () => {
  it("lists a customer's own orders and hides other people's", async () => {
    const a = await placed();
    const b = await newCustomer(t);
    expect(json(await a.client.get('/orders')).items.map((o: { id: string }) => o.id)).toEqual([a.orderId]);
    expect(json(await b.client.get('/orders')).items).toEqual([]);
    expect((await b.client.get(`/orders/${a.orderId}`)).statusCode).toBe(404);
  });

  it('staff can see any order; customers cannot use staff routes', async () => {
    const a = await placed();
    const support = await signedIn(t, 'support@halden.test', true);
    expect(json(await support.get(`/staff/orders/${a.orderId}`)).id).toBe(a.orderId);
    expect(json(await support.get('/staff/orders?status=confirmed')).items).toHaveLength(1);
    expect((await a.client.get('/staff/orders')).statusCode).toBe(403);
  });

  it('records each step with who did it', async () => {
    const a = await placed();
    const events = json(await a.client.get(`/orders/${a.orderId}`)).events;
    expect(events.map((e: { from: string | null; to: string; by: string }) => [e.from, e.to, e.by])).toEqual([
      [null, 'pending_payment', 'customer'],
      ['pending_payment', 'confirmed', 'system'],
    ]);
  });
});

describe('cancelling', () => {
  it('the customer cancels a confirmed order: card hold voided, stock back, email sent', async () => {
    const a = await placed([['drift-hammock', 2]]);
    expect(await available(t, 'drift-hammock')).toBe(1);
    const res = await a.client.post(`/orders/${a.orderId}/cancel`, { reason: 'changed_mind' });
    expect(res.statusCode).toBe(200);
    const o = json(res);
    expect(o).toMatchObject({ status: 'cancelled', cancel: { reason: 'changed_mind' }, allowedActions: [] });
    expect(o.payment).toMatchObject({ status: 'voided', captured: '0.00' });
    expect(await available(t, 'drift-hammock')).toBe(3);
    expect((await lastEmail(t.db, a.email))?.template).toBe('order_cancelled');
    const provider = await t.db.one<{ status: string }>('SELECT status FROM haldenpay.intents');
    expect(provider?.status).toBe('voided');
  });

  it('needs a reason, and a note when the reason is "other"', async () => {
    const a = await placed();
    expect((await a.client.post(`/orders/${a.orderId}/cancel`, {})).statusCode).toBe(400);
    expect(json(await a.client.post(`/orders/${a.orderId}/cancel`, { reason: 'other' })).errors[0].path).toBe('note');
    expect(json(await a.client.post(`/orders/${a.orderId}/cancel`, { reason: 'fraud_suspected' })).errors[0].path).toBe(
      'reason',
    );
    expect(
      (await a.client.post(`/orders/${a.orderId}/cancel`, { reason: 'other', note: 'Bought it in town' })).statusCode,
    ).toBe(200);
  });

  it('once packed only support can cancel; once shipped nobody can', async () => {
    const a = await placed();
    const warehouse = await signedIn(t, 'warehouse@halden.test', true);
    await warehouse.post(`/staff/orders/${a.orderId}/pack`);
    const mine = await a.client.post(`/orders/${a.orderId}/cancel`, { reason: 'changed_mind' });
    expect(mine.statusCode).toBe(409);
    expect(json(mine).detail).toMatch(/being packed/);
    const support = await signedIn(t, 'support@halden.test', true);
    expect(json(await support.post(`/orders/${a.orderId}/cancel`, { reason: 'out_of_stock' })).status).toBe(
      'cancelled',
    );

    const b = await placed([['camp-pillow', 1]]);
    await warehouse.post(`/staff/orders/${b.orderId}/pack`);
    await warehouse.post(`/staff/orders/${b.orderId}/ship`, { trackingNumber: 'HX12345678' });
    const late = await support.post(`/orders/${b.orderId}/cancel`, { reason: 'customer_request' });
    expect(json(late)).toMatchObject({ code: 'invalid_transition' });
    expect(json(late).detail).toMatch(/shipped/);
  });

  it("a cancelled order can't be cancelled again", async () => {
    const a = await placed();
    await a.client.post(`/orders/${a.orderId}/cancel`, { reason: 'changed_mind' });
    expect(json(await a.client.post(`/orders/${a.orderId}/cancel`, { reason: 'changed_mind' })).detail).toBe(
      'This order is already cancelled.',
    );
  });
});

describe('the warehouse', () => {
  it('packs, ships (charging the card, taking the stock) and marks delivered', async () => {
    const a = await placed([['drift-hammock', 2]]);
    const w = await signedIn(t, 'warehouse@halden.test', true);
    expect(json(await w.get(`/staff/orders/${a.orderId}`)).allowedActions).toEqual(['pack']);
    expect(json(await w.post(`/staff/orders/${a.orderId}/pack`)).status).toBe('packed');

    const shipped = json(await w.post(`/staff/orders/${a.orderId}/ship`, { trackingNumber: 'HX99887766' }));
    expect(shipped).toMatchObject({ status: 'shipped', shipping: { trackingNumber: 'HX99887766' } });
    expect(shipped.payment).toMatchObject({ status: 'captured', captured: shipped.totals.total });
    const stock = await t.db.one<{ on_hand: number; reserved: number }>(
      "SELECT on_hand, reserved FROM stock_levels WHERE product_id = (SELECT id FROM products WHERE slug = 'drift-hammock')",
    );
    expect(stock).toEqual({ on_hand: 1, reserved: 0 });
    const sale = await t.db.one<{ change: number }>("SELECT change FROM stock_movements WHERE reason = 'sale'");
    expect(sale?.change).toBe(-2);
    expect((await lastEmail(t.db, a.email))?.template).toBe('order_shipped');

    expect(json(await w.post(`/staff/orders/${a.orderId}/deliver`)).status).toBe('delivered');
    expect((await lastEmail(t.db, a.email))?.template).toBe('order_delivered');
  });

  it('refuses steps out of order, and refuses support doing warehouse work', async () => {
    const a = await placed();
    const w = await signedIn(t, 'warehouse@halden.test', true);
    expect(json(await w.post(`/staff/orders/${a.orderId}/ship`, { trackingNumber: 'HX12345678' })).code).toBe(
      'invalid_transition',
    );
    expect(json(await w.post(`/staff/orders/${a.orderId}/deliver`)).code).toBe('invalid_transition');
    const support = await signedIn(t, 'support@halden.test', true);
    expect((await support.post(`/staff/orders/${a.orderId}/pack`)).statusCode).toBe(403);
  });

  it('a delivered order completes once the return window has passed', async () => {
    const a = await placed();
    const w = await signedIn(t, 'warehouse@halden.test', true);
    await w.post(`/staff/orders/${a.orderId}/pack`);
    await w.post(`/staff/orders/${a.orderId}/ship`, { trackingNumber: 'HX12345678' });
    await w.post(`/staff/orders/${a.orderId}/deliver`);
    // Step through the days using the session (it slides; 14 days without use would end it).
    for (let d = 0; d < 3; d++) {
      await t.advance(10 * 86400);
      expect(json(await a.client.get(`/orders/${a.orderId}`)).status).toBe('delivered');
    }
    await t.advance(2 * 86400);
    const done = json(await a.client.get(`/orders/${a.orderId}`));
    expect(done.status).toBe('completed');
    expect(done.events.at(-1)).toMatchObject({ to: 'completed', by: 'system', note: 'Return window closed' });
  });
});

describe('sweeps', () => {
  it('admin sweep cancels unpaid orders past 30 minutes', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['camp-pillow', 1]]);
    await checkout(c.client, c.addressId, { card: '4000000000003220' });
    await t.advance(31 * 60);
    const admin = await signedIn(t, 'admin@halden.test', true);
    expect(json(await admin.post('/qa/sweeps'))).toMatchObject({ expired: 1 });
    expect((await t.db.one<{ status: string }>('SELECT status FROM orders'))?.status).toBe('cancelled');
    expect((await c.client.post('/qa/sweeps')).statusCode).toBe(403);
  });

  it('the cron endpoint needs the secret', async () => {
    expect((await new Client(t.app).get('/internal/cron/sweep')).statusCode).toBe(403);
  });
});
