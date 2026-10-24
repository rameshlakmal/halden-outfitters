import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VIEWER } from '../scripts/seed-data.js';
import { Client, json, productId, startApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

async function viewer() {
  const c = new Client(t.app);
  await c.login(VIEWER.email, VIEWER.password);
  return c;
}

const firstId = async (sql: string) => (await t.db.one<{ id: string }>(sql))!.id;

describe('the read-only viewer login', () => {
  it('reads the sections with no customer details', async () => {
    const v = await viewer();
    const id = await productId(t.db, 'titanium-pot');
    for (const url of [
      '/staff/dashboard',
      '/staff/products',
      `/staff/products/${id}`,
      `/staff/products/${id}/movements`,
      '/staff/coupons',
      '/staff/shipping-rates',
      '/staff/tax',
      '/qa/bugs',
    ]) {
      expect((await v.get(url)).statusCode, url).toBe(200);
    }
  });

  it('sees initials, not names, in the dashboard', async () => {
    await t.reseed({ orders: true });
    const recent = json(await (await viewer()).get('/staff/dashboard')).recentOrders as { customer: string }[];
    expect(recent.length).toBeGreaterThan(0);
    for (const o of recent) expect(o.customer).toMatch(/^([A-Z]\.\s?)+$/);
  });

  it('is refused the sections that hold customer details', async () => {
    const v = await viewer();
    for (const url of [
      '/staff/orders',
      '/staff/returns',
      '/staff/customers',
      '/staff/audit',
      '/staff/reviews',
      '/qa/webhooks',
    ]) {
      expect((await v.get(url)).statusCode, url).toBe(403);
    }
  });

  it("can't open someone else's order or return by its id", async () => {
    await t.reseed({ orders: true });
    const v = await viewer();
    const order = await firstId('SELECT id FROM orders ORDER BY id LIMIT 1');
    expect((await v.get(`/orders/${order}`)).statusCode).toBe(404);
    const ret = await t.db.one<{ id: string }>('SELECT id FROM returns ORDER BY id LIMIT 1');
    if (ret) expect((await v.get(`/returns/${ret.id}`)).statusCode).toBe(404);
  });

  it('changes nothing, not even its own account', async () => {
    const v = await viewer();
    const id = await productId(t.db, 'titanium-pot');
    const writes = [
      () => v.put('/qa/bugs/coupon_twice', { enabled: true }),
      () => v.put('/qa/clock', { offsetSeconds: 86400 }),
      () => v.req('PATCH', `/staff/products/${id}`, { price: '1.00' }, { 'if-match': '"1"' }),
      () => v.patch('/staff/coupons/WELCOME10', { active: false }),
      () => v.put('/staff/tax', { ratePercent: '0' }),
      () => v.post('/cart/items', { productId: id, qty: 1 }),
      () => v.post('/account/password', { currentPassword: VIEWER.password, newPassword: 'a brand new password' }),
      () => v.patch('/account/profile', { name: 'Someone else' }),
    ];
    for (const write of writes) {
      const res = await write();
      expect(res.statusCode, res.body).toBe(403);
      expect(json(res).detail).toMatch(/read-only demo account/);
    }
    const bug = await t.db.one<{ enabled: boolean }>("SELECT enabled FROM qa_bugs WHERE key = 'coupon_twice'");
    expect(bug!.enabled).toBe(false);
  });

  it('signs in and out like any account', async () => {
    const v = await viewer();
    expect(json(await v.get('/auth/session')).customer).toMatchObject({ email: VIEWER.email, role: 'viewer' });
    expect((await v.post('/auth/logout')).statusCode).toBeLessThan(300);
    expect(json(await v.get('/auth/session')).customer).toBeNull();
  });
});
