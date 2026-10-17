import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, json, PASSWORDS, startApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed({ orders: true }));
afterAll(() => t.close());

const signedIn = async (email: string, password: string) => {
  const c = new Client(t.app);
  await c.login(email, password);
  return c;
};

/** Every item across all pages, following nextCursor; checks each page reports the same total. */
async function walk(c: Client, url: string) {
  const items: unknown[] = [];
  let cursor: string | null = null;
  let total: number | undefined;
  do {
    const sep = url.includes('?') ? '&' : '?';
    const page = json(await c.get(`${url}${sep}limit=2${cursor ? `&cursor=${cursor}` : ''}`));
    total ??= page.total;
    expect(page.total).toBe(total);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return { items, total };
}

describe('list totals', () => {
  it.each([
    ['admin@halden.test', PASSWORDS.admin, '/staff/orders'],
    ['admin@halden.test', PASSWORDS.admin, '/staff/orders?status=delivered'],
    ['admin@halden.test', PASSWORDS.admin, '/staff/customers?role=customer'],
    ['admin@halden.test', PASSWORDS.admin, '/staff/products?lowStock=true'],
    ['admin@halden.test', PASSWORDS.admin, '/staff/audit'],
    ['admin@halden.test', PASSWORDS.admin, '/staff/reviews'],
    ['admin@halden.test', PASSWORDS.admin, '/staff/returns'],
    ['maya@halden.test', PASSWORDS.shopper, '/orders'],
    ['maya@halden.test', PASSWORDS.shopper, '/returns'],
    ['maya@halden.test', PASSWORDS.shopper, '/account/reviews'],
  ])('%s: %s counts every item across the pages', async (email, password, url) => {
    const { items, total } = await walk(await signedIn(email, password), url);
    expect(total).toBe(items.length);
  });

  it('counts only what the filters match, ignoring the cursor', async () => {
    const admin = await signedIn('admin@halden.test', PASSWORDS.admin);
    const all = json(await admin.get('/staff/orders?limit=1')).total;
    const delivered = json(await admin.get('/staff/orders?status=delivered&limit=1'));
    expect(delivered.total).toBeLessThan(all);
    const next = json(await admin.get(`/staff/orders?limit=1&cursor=${delivered.items[0].id}`));
    expect(next.total).toBe(all);
  });

  it('counts the published reviews of a product, per rating filter too', async () => {
    const c = new Client(t.app);
    const slug = (await t.db.one<{ slug: string }>(
      "SELECT p.slug FROM products p JOIN reviews r ON r.product_id = p.id WHERE r.status = 'published' GROUP BY p.slug ORDER BY count(*) DESC LIMIT 1",
    ))!.slug;
    const { items, total } = await walk(c, `/products/${slug}/reviews`);
    expect(total).toBe(items.length);
    expect(total).toBeGreaterThan(0);
    const fives = json(await c.get(`/products/${slug}/reviews?rating=5`));
    const n = await t.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.slug = $1 AND r.status = 'published' AND r.rating = 5",
      [slug],
    );
    expect(fives.total).toBe(n?.n);
  });

  it('is 0 for an empty list', async () => {
    const res = await (await signedIn('ari@halden.test', PASSWORDS.shopper)).get('/returns');
    expect(json(res)).toMatchObject({ items: [], nextCursor: null, total: 0 });
  });
});
