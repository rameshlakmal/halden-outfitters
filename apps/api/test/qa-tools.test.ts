import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, json, PASSWORDS, startApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed({ orders: true }));
afterAll(() => t.close());

const admin = async () => {
  const c = new Client(t.app);
  await c.login('admin@halden.test', PASSWORDS.admin);
  return c;
};

describe('mock status', () => {
  it.each([200, 201, 202])('answers %i with a small JSON body', async (code) => {
    const res = await new Client(t.app).get(`/qa/mock/status/${code}`);
    expect(res.statusCode).toBe(code);
    expect(json(res)).toMatchObject({ status: code, delayMs: 0, method: 'GET' });
  });

  it('answers 204 with no body', async () => {
    const res = await new Client(t.app).req('DELETE', '/qa/mock/status/204');
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it.each([400, 401, 404, 422, 500, 502, 504])('answers %i as problem+json', async (code) => {
    const res = await new Client(t.app).post(`/qa/mock/status/${code}`, { any: 'body' });
    expect(res.statusCode).toBe(code);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(json(res)).toMatchObject({ status: code, code: 'simulated_error', title: 'Simulated error' });
  });

  it.each([429, 503])('adds Retry-After to %i', async (code) => {
    const res = await new Client(t.app).get(`/qa/mock/status/${code}`);
    expect(res.headers['retry-after']).toBe('30');
  });

  it('refuses a status it does not offer', async () => {
    const res = await new Client(t.app).get('/qa/mock/status/418');
    expect(res.statusCode).toBe(400);
    expect(json(res).code).toBe('validation_failed');
  });
});

describe('mock delay', () => {
  it('waits, then answers 200', async () => {
    const started = Date.now();
    const res = await new Client(t.app).get('/qa/mock/delay/300');
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-mock-delay-ms']).toBe('300');
    expect(json(res).delayMs).toBe(300);
  });

  it('can answer with another status after the delay', async () => {
    const res = await new Client(t.app).get('/qa/mock/delay/10?status=503');
    expect(res.statusCode).toBe(503);
    expect(json(res).code).toBe('simulated_error');
  });

  it('caps the delay at 5 seconds', async () => {
    expect((await new Client(t.app).get('/qa/mock/delay/5001')).statusCode).toBe(400);
  });
});

describe('QA reset', () => {
  it('puts the clock and bugs back and removes unused fixture accounts', async () => {
    const a = await admin();
    await a.put('/qa/clock', { offsetSeconds: 3600 });
    await a.req('PUT', '/qa/bugs/coupon_twice', { enabled: true });
    await a.req('PUT', '/qa/bugs/eu_domestic_rate', { enabled: true });
    const unused = json(await a.post('/qa/fixtures/shopper', { storeCredit: '10.00', points: 100 }));

    // A fixture shopper who ordered is kept.
    const buyer = json(await a.post('/qa/fixtures/shopper', { cart: [{ slug: 'ridgeline-2p-tent', qty: 1 }] }));
    const order = await new Client(t.app).post(
      '/checkout',
      {
        shipTo: { addressId: buyer.address.id },
        card: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123', name: 'Buyer' },
      },
      { authorization: `Bearer ${buyer.accessToken}`, 'idempotency-key': 'reset-test-order-1' },
    );
    expect(order.statusCode).toBe(201);

    const res = await a.post('/qa/reset', {});
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({
      clockOffsetSeconds: 0,
      bugsSwitchedOff: 2,
      fixtureAccountsRemoved: 1,
      fixtureAccountsKept: 1,
    });
    expect(json(await a.get('/qa/clock')).offsetSeconds).toBe(0);
    expect(json(await a.get('/qa/bugs')).items.filter((b: { enabled: boolean }) => b.enabled)).toEqual([]);
    const left = await t.db.query<{ email: string }>("SELECT email FROM customers WHERE email LIKE '%@fixtures.test'");
    expect(left.map((r) => r.email)).toEqual([buyer.customer.email]);
    expect(unused.customer.email).not.toBe(buyer.customer.email);
  });

  it('keeps every seeded account and order', async () => {
    const before = await t.db.one<{ c: number; o: number }>(
      'SELECT (SELECT count(*)::int FROM customers) AS c, (SELECT count(*)::int FROM orders) AS o',
    );
    await (await admin()).post('/qa/reset', {});
    const after = await t.db.one<{ c: number; o: number }>(
      'SELECT (SELECT count(*)::int FROM customers) AS c, (SELECT count(*)::int FROM orders) AS o',
    );
    expect(after).toEqual(before);
  });

  it('is for admins only', async () => {
    expect((await new Client(t.app).post('/qa/reset', {})).statusCode).toBe(401);
    const shopper = new Client(t.app);
    await shopper.login('maya@halden.test', PASSWORDS.shopper);
    expect((await shopper.post('/qa/reset', {})).statusCode).toBe(403);
  });
});
