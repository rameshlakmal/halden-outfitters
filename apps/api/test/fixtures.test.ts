import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, json, PASSWORDS, startApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const admin = async () => {
  const c = new Client(t.app);
  await c.login('admin@halden.test', PASSWORDS.admin);
  return c;
};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('shopper fixture', () => {
  it('makes a confirmed, signed-in shopper with an address and an empty cart by default', async () => {
    const res = await (await admin()).post('/qa/fixtures/shopper', {});
    expect(res.statusCode).toBe(201);
    const body = json(res);
    expect(body.customer).toMatchObject({ name: 'Test Shopper', role: 'customer', emailVerified: true });
    expect(body.customer.email).toMatch(/^shopper-[0-9a-f]{10}@fixtures\.test$/);
    expect(body.address).toMatchObject({ countryCode: 'US', isDefault: true });
    expect(body.cart).toMatchObject({ itemCount: 0 });
    expect(body).toMatchObject({ storeCredit: '0.00', points: 0 });

    const session = await new Client(t.app).get('/auth/session', bearer(body.accessToken));
    expect(json(session).customer.email).toBe(body.customer.email);
    const login = await new Client(t.app).post('/auth/login', { email: body.customer.email, password: body.password });
    expect(login.statusCode).toBe(200);
  });

  it('fills the cart and adds store credit and points', async () => {
    const res = await (
      await admin()
    ).post('/qa/fixtures/shopper', {
      name: 'Cart Tester',
      cart: [{ slug: 'ridgeline-2p-tent', qty: 2 }],
      storeCredit: '25.00',
      points: 300,
    });
    const body = json(res);
    expect(body.cart.itemCount).toBe(2);
    expect(body.cart.lines[0]).toMatchObject({ slug: 'ridgeline-2p-tent', qty: 2 });
    expect(body).toMatchObject({ storeCredit: '25.00', points: 300 });
    const points = json(await new Client(t.app).get('/account/points', bearer(body.accessToken)));
    expect(points.available).toBe(300);
  });

  it('can leave the email unconfirmed and the address book empty', async () => {
    const body = json(await (await admin()).post('/qa/fixtures/shopper', { emailVerified: false, address: false }));
    expect(body.customer.emailVerified).toBe(false);
    expect(body.address).toBeNull();
  });

  it('makes staff accounts for role tests', async () => {
    const body = json(await (await admin()).post('/qa/fixtures/shopper', { role: 'warehouse' }));
    expect(body.customer.email).toMatch(/^warehouse-/);
    const staff = await new Client(t.app).get('/staff/orders', bearer(body.accessToken));
    expect(staff.statusCode).toBe(200);
  });

  it('refuses an unknown product and asking for more than is in stock, creating nothing', async () => {
    const a = await admin();
    const before = await t.db.one<{ n: number }>('SELECT count(*)::int AS n FROM customers');
    const unknown = await a.post('/qa/fixtures/shopper', { cart: [{ slug: 'no-such-thing', qty: 1 }] });
    expect(unknown.statusCode).toBe(409);
    expect(json(unknown).code).toBe('product_unavailable');
    const tooMany = await a.post('/qa/fixtures/shopper', { cart: [{ slug: 'ridgeline-2p-tent', qty: 20 }] });
    expect(json(tooMany).code).toBe('not_enough_stock');
    const after = await t.db.one<{ n: number }>('SELECT count(*)::int AS n FROM customers');
    expect(after?.n).toBe(before?.n);
  });

  it('validates the body', async () => {
    const res = await (await admin()).post('/qa/fixtures/shopper', { role: 'admin', storeCredit: '-5.00', points: -1 });
    expect(res.statusCode).toBe(400);
    expect(
      json(res)
        .errors.map((e: { path: string }) => e.path)
        .sort(),
    ).toEqual(['points', 'role', 'storeCredit']);
  });

  it('is for admins only', async () => {
    expect((await new Client(t.app).post('/qa/fixtures/shopper', {})).statusCode).toBe(401);
    const shopper = new Client(t.app);
    await shopper.login('maya@halden.test', PASSWORDS.shopper);
    expect((await shopper.post('/qa/fixtures/shopper', {})).statusCode).toBe(403);
  });

  it('is written to the audit log', async () => {
    const body = json(await (await admin()).post('/qa/fixtures/shopper', {}));
    const row = await t.db.one<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_type = 'customer' AND entity_id = $1",
      [body.customer.id],
    );
    expect(row?.action).toBe('qa.fixture');
  });
});
