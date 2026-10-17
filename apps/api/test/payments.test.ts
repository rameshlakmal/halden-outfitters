import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signPayload } from '../src/modules/payments/webhooks.js';
import { json, lastEmail, startApp, type TestApp } from './helpers.js';
import { CARDS, checkout, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const SECRET = 'whsec_local_development_only';
const post = (body: string, signature?: string) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/haldenpay',
    headers: { 'content-type': 'application/json', ...(signature ? { 'haldenpay-signature': signature } : {}) },
    payload: body,
  });

describe('webhook security', () => {
  it('refuses a missing, wrong or stale signature', async () => {
    const body = JSON.stringify({ id: 'evt_test', type: 'payment.authorized', payload: { intentId: 'pi_x' } });
    expect((await post(body)).statusCode).toBe(401);
    expect((await post(body, signPayload('whsec_someone_elses_secret', Math.floor(Date.now() / 1000), body))).statusCode).toBe(401);
    expect((await post(body, signPayload(SECRET, Math.floor(Date.now() / 1000) - 600, body))).statusCode).toBe(401);
    // A valid signature over different bytes is also refused.
    const sig = signPayload(SECRET, Math.floor(Date.now() / 1000), body);
    expect((await post(body.replace('authorized', 'failed'), sig)).statusCode).toBe(401);
    expect((await post(body, sig)).statusCode).toBe(200);
  });
});

describe('repeated delivery', () => {
  it('a webhook delivered twice is processed once', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['camp-pillow', 1]]);
    const { orderId, nextAction } = json(await checkout(c.client, c.addressId, { card: CARDS.bank }));
    await t.app.inject({ method: 'POST', url: '/api/v1/payments/authenticate', headers: { 'content-type': 'application/json' }, payload: { token: new URL(nextAction.url).searchParams.get('token'), approve: true } });
    const ev = await t.db.one<{ id: string }>("SELECT id FROM haldenpay.events WHERE type = 'payment.authorized'");
    const admin = await signedIn(t, 'admin@halden.test', true);
    expect(json(await admin.post(`/qa/webhooks/${ev!.id}/redeliver`)).delivered).toBe(1);
    const order = json(await c.client.get(`/orders/${orderId}`));
    expect(order.events.filter((e: { to: string }) => e.to === 'confirmed')).toHaveLength(1);
    const emails = await t.db.query("SELECT 1 FROM outbox WHERE template = 'order_confirmed'");
    expect(emails).toHaveLength(1);
  });
});

describe('disputes', () => {
  it('the dispute card: after capture, a dispute webhook flags the payment and tells support', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['camp-pillow', 1]]);
    const { orderId } = json(await checkout(c.client, c.addressId, { card: CARDS.dispute }));
    const w = await signedIn(t, 'warehouse@halden.test', true);
    await w.post(`/staff/orders/${orderId}/pack`);
    await w.post(`/staff/orders/${orderId}/ship`, { trackingNumber: 'HX12345678' });
    const admin = await signedIn(t, 'admin@halden.test', true);
    await admin.post('/qa/sweeps'); // delivers the queued webhooks
    const order = json(await c.client.get(`/orders/${orderId}`));
    expect(order.payment).toMatchObject({ status: 'captured', disputed: true });
    expect(order.events.at(-1).note).toBe('The card holder disputed this payment');
    expect((await lastEmail(t.db, 'support@halden.test'))?.template).toBe('payment_disputed');
  });
});
