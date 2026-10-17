import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, json, startApp, type TestApp } from './helpers.js';

let t: TestApp;
let c: Client;
beforeAll(async () => {
  t = await startApp();
  c = new Client(t.app);
});
afterAll(() => t.close());

const names = (body: Record<string, any>) => body.items.map((i: { name: string }) => i.name);
const prices = (body: Record<string, any>) => body.items.map((i: { price: string }) => Number(i.price));

describe('categories', () => {
  it('come in shop order with active product counts', async () => {
    const body = json(await c.get('/categories'));
    expect(body.items.map((x: { slug: string }) => x.slug)).toEqual(['shelter', 'sleep', 'kitchen', 'carry']);
    expect(body.items.every((x: { productCount: number }) => x.productCount === 4)).toBe(true);
  });

  it('do not count inactive products', async () => {
    await t.db.query("UPDATE products SET active = false WHERE slug = 'trail-tarp'");
    const body = json(await c.get('/categories'));
    expect(body.items[0].productCount).toBe(3);
    await t.db.query("UPDATE products SET active = true WHERE slug = 'trail-tarp'");
  });
});

describe('product list', () => {
  it('sorts by price both ways', async () => {
    const up = prices(json(await c.get('/products?sort=price-asc&limit=48')));
    expect(up).toEqual([...up].sort((a, b) => a - b));
    const down = prices(json(await c.get('/products?sort=price-desc&limit=48')));
    expect(down).toEqual([...down].sort((a, b) => b - a));
  });

  it('puts featured products first by default', async () => {
    const body = json(await c.get('/products?limit=4'));
    expect(body.items.every((i: { featured: boolean }) => i.featured)).toBe(true);
  });

  it('filters by category, price range, stock and sale', async () => {
    expect(json(await c.get('/products?category=kitchen')).total).toBe(4);
    const range = json(await c.get('/products?minPrice=50&maxPrice=100&limit=48'));
    expect(prices(range).every((p: number) => p >= 50 && p <= 100)).toBe(true);
    expect(names(json(await c.get('/products?inStock=true&limit=48')))).not.toContain('Loft Sleeping Pad');
    const sale = json(await c.get('/products?onSale=true'));
    expect(sale.total).toBe(3);
    expect(sale.items.every((i: { compareAtPrice: string | null }) => i.compareAtPrice !== null)).toBe(true);
  });

  it('searches by whole words and by part of a name', async () => {
    expect(names(json(await c.get('/products?q=tent')))).toEqual(['Ridgeline 2P Tent']);
    expect(names(json(await c.get('/products?q=hamm')))).toEqual(['Drift Hammock']);
    expect(json(await c.get('/products?q=zzzz')).total).toBe(0);
  });

  it('pages with a cursor without skipping or repeating products, for every sort', async () => {
    for (const sort of ['featured', 'price-asc', 'price-desc', 'newest', 'rating']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: Record<string, any> = json(
          await c.get(`/products?sort=${sort}&limit=5${cursor ? `&cursor=${cursor}` : ''}`),
        );
        seen.push(...page.items.map((i: { id: string }) => i.id));
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(seen, sort).toHaveLength(16);
      expect(new Set(seen).size, sort).toBe(16);
      expect(pages, sort).toBe(4);
    }
  });

  it('rejects a forged cursor and an upside-down price range', async () => {
    expect(json(await c.get('/products?cursor=not-a-cursor')).errors[0].path).toBe('cursor');
    const res = await c.get('/products?minPrice=100&maxPrice=50');
    expect(res.statusCode).toBe(400);
    expect(json(res).errors[0].path).toBe('minPrice');
  });

  it('reports the price range of the matching products', async () => {
    expect(json(await c.get('/products?category=shelter')).priceRange).toEqual({ min: '59.00', max: '349.00' });
  });
});

describe('availability', () => {
  it('says in stock, low stock (with the count) or out of stock', async () => {
    const get = async (slug: string) => json(await c.get(`/products/${slug}`)).availability;
    expect(await get('ridgeline-2p-tent')).toEqual({ status: 'in_stock', available: null });
    expect(await get('drift-hammock')).toEqual({ status: 'low_stock', available: 3 });
    expect(await get('loft-sleeping-pad')).toEqual({ status: 'out_of_stock', available: 0 });
  });
});

describe('product page', () => {
  it('has the gallery, details and related products from the same category', async () => {
    const p = json(await c.get('/products/ember-stove'));
    expect(p.images.length).toBeGreaterThan(0);
    expect(p.details[0]).toEqual(['Fuel', 'Isobutane canister']);
    expect(p.related.length).toBe(3);
    expect(p.related.every((r: { category: { slug: string } }) => r.category.slug === 'kitchen')).toBe(true);
    expect(p.related.map((r: { slug: string }) => r.slug)).not.toContain('ember-stove');
  });

  it('marks final-sale items as not returnable', async () => {
    expect(json(await c.get('/products/water-filter')).returnable).toBe(false);
    expect(json(await c.get('/products/ember-stove')).returnable).toBe(true);
  });

  it('is a 404 for unknown and inactive products', async () => {
    expect((await c.get('/products/no-such-thing')).statusCode).toBe(404);
    await t.db.query("UPDATE products SET active = false WHERE slug = 'trail-tarp'");
    expect(json(await c.get('/products/trail-tarp')).code).toBe('not_found');
    await t.db.query("UPDATE products SET active = true WHERE slug = 'trail-tarp'");
  });
});
