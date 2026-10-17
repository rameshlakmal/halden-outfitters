// The endpoints behind the admin app: the dashboard summary and coupon management.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toCents } from '@halden/money';
import { json, startApp, type TestApp } from './helpers.js';
import { checkout, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed({ orders: true }));
afterAll(() => t.close());

const admin = () => signedIn(t, 'admin@halden.test', true);

describe('dashboard', () => {
  it('sums the range from the orders themselves and counts open work', async () => {
    const d = json(await (await admin()).get('/staff/dashboard?days=90'));
    const db = await t.db.one<{ revenue: string; orders: number; to_pack: number; reviews: number }>(
      `SELECT coalesce(sum(total) FILTER (WHERE status <> 'cancelled'), 0)::numeric(12, 2)::text AS revenue,
              count(*) FILTER (WHERE status <> 'cancelled')::int AS orders,
              (SELECT count(*)::int FROM orders WHERE status = 'confirmed') AS to_pack,
              (SELECT count(*)::int FROM reviews WHERE status = 'pending') AS reviews
         FROM orders WHERE placed_at >= now() - interval '90 days'`,
    );
    expect(d.days).toBe(90);
    expect(d.revenue.value).toBe(db!.revenue);
    expect(d.orders.value).toBe(String(db!.orders));
    expect(d.queues.toPack).toBe(db!.to_pack);
    expect(d.queues.reviewsToModerate).toBe(db!.reviews);
    // One point per day, and the days add up to the total.
    expect(d.series).toHaveLength(91);
    const fromSeries = d.series.reduce((n: number, p: { revenue: string }) => n + toCents(p.revenue), 0);
    expect(fromSeries).toBe(toCents(d.revenue.value));
    expect(d.byStatus.map((s: { status: string }) => s.status)).toEqual([
      'pending_payment',
      'confirmed',
      'packed',
      'shipped',
      'delivered',
      'completed',
      'cancelled',
    ]);
  });

  it('counts a new order in today, and leaves cancelled orders out of revenue', async () => {
    const before = json(await (await admin()).get('/staff/dashboard?days=7'));
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const order = json(await checkout(c.client, c.addressId));
    const after = json(await (await admin()).get('/staff/dashboard?days=7'));
    expect(Number(after.orders.value)).toBe(Number(before.orders.value) + 1);
    expect(after.recentOrders[0]).toMatchObject({ id: order.orderId, customer: 'Robin Fell', status: 'confirmed' });

    await c.client.post(`/orders/${order.orderId}/cancel`, { reason: 'changed_mind' });
    const cancelled = json(await (await admin()).get('/staff/dashboard?days=7'));
    expect(cancelled.revenue.value).toBe(before.revenue.value);
  });

  it('is for staff only, and only for 7, 30 or 90 days', async () => {
    expect((await (await signedIn(t, 'maya@halden.test')).get('/staff/dashboard')).statusCode).toBe(403);
    expect((await (await signedIn(t, 'warehouse@halden.test', true)).get('/staff/dashboard')).statusCode).toBe(200);
    expect((await (await admin()).get('/staff/dashboard?days=12')).statusCode).toBe(400);
  });
});

describe('coupon management', () => {
  const coupon = {
    code: 'trail12',
    kind: 'percent',
    value: '12.00',
    description: '12% off for trail runners',
    minSubtotal: '40.00',
    maxUses: 50,
    perCustomerLimit: 1,
    firstOrderOnly: false,
    excludesSaleItems: true,
    startsAt: null,
    endsAt: null,
    active: true,
    excludedCategories: ['shelter'],
  };

  it('an admin creates a coupon that works at once, and it is audited', async () => {
    const a = await admin();
    const res = await a.post('/staff/coupons', coupon);
    expect(res.statusCode).toBe(201);
    expect(json(res)).toMatchObject({ code: 'TRAIL12', value: '12.00', uses: 0, excludedCategories: ['shelter'] });
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    expect((await c.client.post('/cart/coupon', { code: 'TRAIL12' })).statusCode).toBe(200);
    const log = await t.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'coupon.create' AND entity_id = 'TRAIL12'",
    );
    expect(log!.n).toBe(1);
  });

  it('a scheduled coupon only works from its start', async () => {
    const a = await admin();
    const startsAt = new Date(Date.now() + 3 * 86400_000).toISOString();
    expect((await a.post('/staff/coupons', { ...coupon, code: 'LATER10', startsAt })).statusCode).toBe(201);
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    expect((await c.client.post('/cart/coupon', { code: 'LATER10' })).statusCode).toBe(409);
    await t.advance(4 * 86400);
    expect((await c.client.post('/cart/coupon', { code: 'LATER10' })).statusCode).toBe(200);
  });

  it('refuses a duplicate code, a bad value, dates out of order and unknown categories', async () => {
    const a = await admin();
    const field = async (body: object) => json(await a.post('/staff/coupons', body)).errors?.[0]?.path;
    expect(await field({ ...coupon, code: 'WELCOME10' })).toBe('code');
    expect(await field({ ...coupon, value: '120.00' })).toBe('value');
    expect(await field({ ...coupon, kind: 'free_shipping', value: '5.00' })).toBe('value');
    expect(await field({ ...coupon, startsAt: '2026-12-10T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' })).toBe('endsAt');
    expect(await field({ ...coupon, excludedCategories: ['tents'] })).toBe('excludedCategories');
  });

  it('edits schedule and rules, and keeps an end after the start', async () => {
    const a = await admin();
    const edited = json(await a.patch('/staff/coupons/CAMP20', { perCustomerLimit: 2, firstOrderOnly: true }));
    expect(edited).toMatchObject({ perCustomerLimit: 2, firstOrderOnly: true });
    await a.patch('/staff/coupons/CAMP20', { startsAt: '2026-12-01T00:00:00Z' });
    const bad = await a.patch('/staff/coupons/CAMP20', { endsAt: '2026-11-20T00:00:00Z' });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).errors[0].path).toBe('endsAt');
  });

  it('is for admins only', async () => {
    const support = await signedIn(t, 'support@halden.test', true);
    expect((await support.post('/staff/coupons', coupon)).statusCode).toBe(403);
  });
});
