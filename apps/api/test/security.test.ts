// Regression tests for the security review of 2026-10-17: each test replays an attack that used to work.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { APP_URL, Client, json, lastEmail, PASSWORDS, startApp, testDbUrl, tokenFrom, type TestApp } from './helpers.js';
import { card, CARDS, checkout, deliveredOrder, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const inbox = (c: Client, email: string) => c.get(`/qa/inbox?email=${encodeURIComponent(email)}`);

describe('denial of service', () => {
  it('an email made of thousands of dots is refused at once, not after seconds of regex backtracking', async () => {
    const started = performance.now();
    const res = await new Client(t.app).post('/auth/login', { email: `a@${'.'.repeat(60_000)}@`, password: 'x' });
    expect(res.statusCode).toBe(400);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('% and _ in a search are plain characters, not wildcards that match every product', async () => {
    expect(json(await new Client(t.app).get('/products?q=_')).items).toHaveLength(0);
    expect(json(await new Client(t.app).get('/products?q=%25')).items).toHaveLength(0);
  });
});

describe('fake inbox', () => {
  it("anyone can read a test-domain inbox, but not someone's real address", async () => {
    const anon = new Client(t.app);
    await anon.post('/auth/register', { name: 'Real Person', email: 'real.person@gmail.com', password: 'a long walk in the woods' });
    await new Client(t.app).post('/auth/register', { name: 'Tess Ter', email: 'tess@halden.test', password: 'a long walk in the woods' });
    const stranger = new Client(t.app);
    expect(json(await inbox(stranger, 'real.person@gmail.com')).items).toHaveLength(0);
    expect(json(await inbox(stranger, 'tess@halden.test')).items.length).toBeGreaterThan(0);
    // The owner, signed in, still reads their own mail (the confirmation link).
    expect(json(await inbox(anon, 'real.person@gmail.com')).items.length).toBeGreaterThan(0);
  });

  it('a shopper promoted to staff is no longer open to a reset-link takeover through the inbox', async () => {
    const email = 'promoted@halden.test';
    await new Client(t.app).post('/auth/register', { name: 'Pro Moted', email, password: 'a long walk in the woods' });
    const admin = await signedIn(t, 'admin@halden.test', true);
    const { id } = (await t.db.one<{ id: string }>('SELECT id FROM customers WHERE email = $1', [email]))!;
    expect((await admin.put(`/staff/customers/${id}/role`, { role: 'admin' })).statusCode).toBe(204);

    const attacker = new Client(t.app);
    expect((await attacker.post('/auth/forgot-password', { email })).statusCode).toBe(202);
    expect(json(await inbox(attacker, email)).items).toHaveLength(0);
    expect(json(await inbox(admin, email)).items[0].template).toBe('password_reset');
  });
});

describe('accounts', () => {
  it('changing the password kills a reset link that was sent before', async () => {
    const c = await signedIn(t, 'maya@halden.test');
    await new Client(t.app).post('/auth/forgot-password', { email: 'maya@halden.test' });
    const token = tokenFrom((await lastEmail(t.db, 'maya@halden.test', 'password_reset'))!.body_text);
    expect((await c.post('/account/password', { currentPassword: PASSWORDS.shopper, newPassword: 'a brand new password' })).statusCode).toBe(200);
    const reset = await new Client(t.app).post('/auth/reset-password', { token, password: 'the attacker chose this one' });
    expect(reset.statusCode).toBe(410);
  });

  it('a session ends 90 days after sign-in, however often it is used', async () => {
    const c = await signedIn(t, 'maya@halden.test');
    expect((await c.get('/account/sessions')).statusCode).toBe(200);
    await t.db.query("UPDATE sessions SET created_at = now() - interval '91 days'");
    expect((await c.get('/account/sessions')).statusCode).toBe(401);
  });

  it('the per-email sign-in limit counts per address and IP, so a stranger cannot block the owner', async () => {
    const limited = await startApp({ rateLimits: true });
    try {
      const attacker = new Client(limited.app);
      for (let i = 0; i < 11; i++) {
        await attacker.post('/auth/login', { email: 'maya@halden.test', password: 'wrong' }, { 'x-forwarded-for': '203.0.113.9' });
      }
      expect((await attacker.post('/auth/login', { email: 'maya@halden.test', password: 'wrong' })).statusCode).toBe(429);
      // Without a trusted proxy, inject's address is the same for both clients; the limit is keyed per address,
      // so a different address (another IP) still signs in.
      const owner = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.7',
        headers: { origin: APP_URL, 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'maya@halden.test', password: PASSWORDS.shopper }),
      });
      expect(owner.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('behind one proxy hop, a client-written X-Forwarded-For does not change the IP the limits see', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: testDbUrl(), APP_URL, LOG_LEVEL: 'silent', TRUST_PROXY: '1' });
    expect(config.TRUST_PROXY).toBe(1);
    const app = await buildApp({ config, db: t.db, clock: t.clock, rateLimits: false });
    try {
      // The client claims 1.2.3.4; the proxy appends the address it really saw.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: APP_URL, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4, 198.51.100.20' },
        payload: JSON.stringify({ email: 'maya@halden.test', password: PASSWORDS.shopper }),
      });
      expect(res.statusCode).toBe(200);
      const row = await t.db.one<{ ip: string }>(
        "SELECT host(ip) AS ip FROM sessions s JOIN customers c ON c.id = s.customer_id WHERE c.email = 'maya@halden.test' ORDER BY s.id DESC LIMIT 1",
      );
      expect(row!.ip).toBe('198.51.100.20');
    } finally {
      await app.close();
    }
  });
});

describe('payments', () => {
  async function bankOrder() {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const res = await checkout(c.client, c.addressId, { card: CARDS.bank });
    expect(res.statusCode).toBe(202);
    const body = json(res);
    return { ...c, orderId: body.orderId as string, token: new URL(body.nextAction.url).searchParams.get('token')! };
  }
  const authenticate = (token: string) =>
    t.app.inject({ method: 'POST', url: '/api/v1/payments/authenticate', headers: { 'content-type': 'application/json' }, payload: { token, approve: true } });
  const intentStatus = async (orderId: string) =>
    (await t.db.one<{ status: string }>('SELECT i.status FROM haldenpay.intents i JOIN payments p ON p.intent_id = i.id WHERE p.order_id = $1', [orderId]))!.status;

  it('approving the bank step after the 30 minutes cancels the order instead of confirming it', async () => {
    const o = await bankOrder();
    await t.advance(31 * 60);
    await authenticate(o.token);
    expect(json(await o.client.get(`/orders/${o.orderId}`)).status).toBe('cancelled');
    expect(await intentStatus(o.orderId)).toBe('voided');
  });

  it('an order that times out voids its payment, so the bank step cannot be approved later', async () => {
    const o = await bankOrder();
    await t.advance(31 * 60);
    expect(json(await o.client.get(`/orders/${o.orderId}`)).status).toBe('cancelled');
    expect(await intentStatus(o.orderId)).toBe('voided');
    expect((await authenticate(o.token)).statusCode).toBe(410);
  });

  it('one customer can hold at most 3 unpaid orders', async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    for (let i = 0; i < 3; i++) expect((await checkout(c.client, c.addressId, { card: CARDS.bank })).statusCode).toBe(202);
    expect((await checkout(c.client, c.addressId, { card: CARDS.bank })).statusCode).toBe(409);
  });
});

describe('points', () => {
  async function givePoints(email: string, points: number, expiresInDays: number) {
    await t.db.query(
      `INSERT INTO loyalty_ledger (customer_id, bucket, kind, points, remaining, expires_at, created_at)
       SELECT id, 'available', 'adjustment', $2, $2, now() + make_interval(days => $3), now() FROM customers WHERE email = $1`,
      [email, points, expiresInDays],
    );
  }
  const pay = (c: Client, addressId: string, pointsToRedeem: number) =>
    c.post('/checkout', { shipTo: { addressId }, shippingMethod: 'standard', card: card(), pointsToRedeem }, { 'idempotency-key': randomUUID() });

  it('expired points that the sweep has not written off yet cannot be spent', async () => {
    const c = await newCustomer(t);
    await givePoints(c.email, 200, -1);
    await fill(t, c.client, [['titanium-pot', 2]]);
    expect(json(await c.client.get('/account/points')).available).toBe(0);
    const res = await pay(c.client, c.addressId, 200);
    expect(res.statusCode).toBe(400);
  });

  it('cancelling an order gives its points back with their old expiry, not a fresh 12 months', async () => {
    const c = await newCustomer(t);
    await givePoints(c.email, 200, 10);
    await fill(t, c.client, [['titanium-pot', 2]]);
    const res = await pay(c.client, c.addressId, 200);
    expect(res.statusCode).toBe(201);
    expect((await c.client.post(`/orders/${json(res).orderId}/cancel`, { reason: 'changed_mind' })).statusCode).toBe(200);
    const back = await t.db.one<{ days: number }>(
      `SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM loyalty_ledger l
         JOIN customers c ON c.id = l.customer_id WHERE c.email = $1 AND kind = 'redeem_reversal'`,
      [c.email],
    );
    expect(back!.days).toBe(10);
  });
});

describe('staff', () => {
  it("support can't pay themselves goodwill on their own order", async () => {
    const o = await deliveredOrder(t, [['titanium-pot', 1]]);
    await t.db.query("UPDATE orders SET customer_id = (SELECT id FROM customers WHERE email = 'support@halden.test') WHERE id = $1", [o.orderId]);
    const support = await signedIn(t, 'support@halden.test', true);
    const res = await support.post(`/staff/orders/${o.orderId}/goodwill`, { amount: '20.00', reason: 'Arrived late', method: 'store_credit' }, { 'idempotency-key': randomUUID() });
    expect(res.statusCode).toBe(403);
  });
});

describe('reviews', () => {
  const review = { rating: 1, title: 'Not good at all', body: 'It broke on the first night out in the hills, sadly.' };

  it('an author cannot delete a hidden review to post it again past moderation', async () => {
    const a = await deliveredOrder(t, [['titanium-pot', 1]]);
    const r = json(await a.client.post('/products/titanium-pot/reviews', review));
    const support = await signedIn(t, 'support@halden.test', true);
    expect((await support.post(`/staff/reviews/${r.id}/hide`, { reason: 'Off topic' })).statusCode).toBe(200);
    expect((await a.client.delete(`/reviews/${r.id}`)).statusCode).toBe(403);
  });

  it('only confirmed accounts vote reviews helpful', async () => {
    const a = await deliveredOrder(t, [['titanium-pot', 1]]);
    const r = json(await a.client.post('/products/titanium-pot/reviews', { ...review, rating: 5 }));
    const fresh = new Client(t.app);
    await fresh.post('/auth/register', { name: 'New Voter', email: 'voter@halden.test', password: 'a long walk in the woods' });
    const res = await fresh.put(`/reviews/${r.id}/helpful`, {});
    expect(res.statusCode).toBe(403);
    expect(json(res).code).toBe('email_not_verified');
  });
});
