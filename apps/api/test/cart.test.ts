import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, json, PASSWORDS, productId, startApp, type TestApp } from './helpers.js';

let t: TestApp;
let ids: Record<string, string>;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(async () => {
  await t.reseed();
  ids = {};
  for (const slug of ['ridgeline-2p-tent', 'drift-hammock', 'loft-sleeping-pad', 'camp-pillow', 'fold-camp-chair']) {
    ids[slug] = await productId(t.db, slug);
  }
});
afterAll(() => t.close());

const add = (c: Client, slug: string, qty = 1) => c.post('/cart/items', { productId: ids[slug], qty });

describe('guest cart', () => {
  it('starts empty and cannot check out', async () => {
    expect(json(await new Client(t.app).get('/cart'))).toEqual({
      lines: [],
      itemCount: 0,
      subtotal: '0.00',
      savings: '0.00',
      coupon: null,
      discount: '0.00',
      canCheckOut: false,
    });
  });

  it('is kept in an HttpOnly cookie and adds up quantities', async () => {
    const c = new Client(t.app);
    const first = await add(c, 'ridgeline-2p-tent');
    const cookie = first.cookies.find((k) => k.name === 'halden_cart') as
      { httpOnly?: boolean; sameSite?: string } | undefined;
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    const cart = json(await add(c, 'ridgeline-2p-tent', 2));
    expect(cart.lines[0]).toMatchObject({ qty: 3, unitPrice: '349.00', lineTotal: '1047.00', problem: null });
    expect(cart).toMatchObject({ itemCount: 3, subtotal: '1047.00', canCheckOut: true });
  });

  it('shows what sale items save', async () => {
    const c = new Client(t.app);
    const cart = json(await add(c, 'fold-camp-chair', 2)); // 59.00, was 75.00
    expect(cart.savings).toBe('32.00');
  });

  it('two browsers have separate carts', async () => {
    const a = new Client(t.app);
    const b = new Client(t.app);
    await add(a, 'camp-pillow');
    expect(json(await b.get('/cart')).itemCount).toBe(0);
  });

  it('ignores a made-up cart cookie', async () => {
    const c = new Client(t.app);
    c.cookies.set('halden_cart', '00000000-0000-4000-8000-000000000000');
    expect(json(await c.get('/cart')).itemCount).toBe(0);
  });
});

describe('quantity rules', () => {
  it('never more than is in stock', async () => {
    const c = new Client(t.app);
    const res = await add(c, 'drift-hammock', 4); // 3 in stock
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'not_enough_stock', detail: 'Only 3 Drift Hammock left.' });
    await add(c, 'drift-hammock', 2);
    const again = await add(c, 'drift-hammock', 2);
    expect(json(again).detail).toBe('Only 3 Drift Hammock left, and 2 are already in your cart.');
  });

  it('nothing that is sold out or no longer sold', async () => {
    const c = new Client(t.app);
    expect(json(await add(c, 'loft-sleeping-pad')).code).toBe('out_of_stock');
    await t.db.query("UPDATE products SET active = false WHERE slug = 'camp-pillow'");
    expect(json(await add(c, 'camp-pillow')).code).toBe('product_unavailable');
    expect(json(await c.post('/cart/items', { productId: '999999' })).code).toBe('product_unavailable');
  });

  it('at most 20 of one product', async () => {
    const c = new Client(t.app);
    await t.db.query('UPDATE inventory SET on_hand = 100 WHERE product_id = $1', [ids['camp-pillow']]);
    await add(c, 'camp-pillow', 15);
    const res = await add(c, 'camp-pillow', 6);
    expect(res.statusCode).toBe(400);
    expect(json(res).errors[0].path).toBe('qty');
    expect((await c.post('/cart/items', { productId: ids['camp-pillow'], qty: 21 })).statusCode).toBe(400);
    expect((await c.post('/cart/items', { productId: ids['camp-pillow'], qty: 0 })).statusCode).toBe(400);
  });

  it('changing the quantity checks stock too', async () => {
    const c = new Client(t.app);
    await add(c, 'drift-hammock');
    expect(json(await c.patch(`/cart/items/${ids['drift-hammock']}`, { qty: 3 })).lines[0].qty).toBe(3);
    expect(json(await c.patch(`/cart/items/${ids['drift-hammock']}`, { qty: 4 })).code).toBe('not_enough_stock');
    expect(json(await c.patch(`/cart/items/${ids['camp-pillow']}`, { qty: 1 })).code).toBe('not_found');
  });

  it('removing and emptying', async () => {
    const c = new Client(t.app);
    await add(c, 'drift-hammock');
    await add(c, 'camp-pillow');
    expect(json(await c.delete(`/cart/items/${ids['drift-hammock']}`)).itemCount).toBe(1);
    expect((await c.delete(`/cart/items/${ids['drift-hammock']}`)).statusCode).toBe(404);
    expect(json(await c.delete('/cart')).itemCount).toBe(0);
    expect(json(await c.get('/cart')).itemCount).toBe(0);
  });

  it('two quick adds both count', async () => {
    const c = new Client(t.app);
    await add(c, 'camp-pillow'); // creates the cart
    await Promise.all([add(c, 'camp-pillow'), add(c, 'camp-pillow'), add(c, 'camp-pillow')]);
    expect(json(await c.get('/cart')).lines[0].qty).toBe(4);
  });
});

describe('lines that went bad', () => {
  it('stay in the cart with a problem, and block checkout', async () => {
    const c = new Client(t.app);
    await add(c, 'drift-hammock', 3);
    await add(c, 'camp-pillow');
    await add(c, 'ridgeline-2p-tent');
    await t.db.query('UPDATE inventory SET on_hand = 1 WHERE product_id = $1', [ids['drift-hammock']]);
    await t.db.query('UPDATE inventory SET on_hand = 0 WHERE product_id = $1', [ids['camp-pillow']]);
    await t.db.query('UPDATE products SET active = false WHERE id = $1', [ids['ridgeline-2p-tent']]);
    const cart = json(await c.get('/cart'));
    const problems = Object.fromEntries(cart.lines.map((l: { slug: string; problem: string }) => [l.slug, l.problem]));
    expect(problems).toEqual({
      'drift-hammock': 'not_enough_stock',
      'camp-pillow': 'out_of_stock',
      'ridgeline-2p-tent': 'unavailable',
    });
    expect(cart.canCheckOut).toBe(false);
  });

  it('use the current price, not the price when added', async () => {
    const c = new Client(t.app);
    await add(c, 'camp-pillow');
    await t.db.query('UPDATE products SET price = 30.00 WHERE id = $1', [ids['camp-pillow']]);
    expect(json(await c.get('/cart')).subtotal).toBe('30.00');
  });
});

describe('signing in merges the browser cart', () => {
  it('adds quantities to the account cart, capped by stock, and drops the browser cart', async () => {
    const shopper = new Client(t.app);
    await shopper.login('maya@halden.test', PASSWORDS.shopper);
    await add(shopper, 'drift-hammock', 2);
    await add(shopper, 'camp-pillow', 1);
    await shopper.post('/auth/logout');

    const browser = new Client(t.app);
    await add(browser, 'drift-hammock', 2); // 2 + 2 > 3 in stock: capped at 3
    await add(browser, 'ridgeline-2p-tent', 1);
    const guestCart = browser.cookies.get('halden_cart');
    await browser.login('maya@halden.test', PASSWORDS.shopper);

    const cart = json(await browser.get('/cart'));
    const qty = Object.fromEntries(cart.lines.map((l: { slug: string; qty: number }) => [l.slug, l.qty]));
    expect(qty).toEqual({ 'drift-hammock': 3, 'camp-pillow': 1, 'ridgeline-2p-tent': 1 });
    expect(browser.cookies.has('halden_cart')).toBe(false);
    expect(await t.db.one('SELECT 1 FROM carts WHERE id = $1', [guestCart])).toBeUndefined();
  });

  it('keeps the cart when the shopper registers', async () => {
    const browser = new Client(t.app);
    await add(browser, 'camp-pillow', 2);
    await browser.post('/auth/register', {
      name: 'Lena Moss',
      email: 'lena@example.com',
      password: 'a long walk in the woods',
    });
    expect(json(await browser.get('/cart')).itemCount).toBe(2);
  });

  it('signed-in carts follow the account to another device', async () => {
    const phone = new Client(t.app);
    await phone.login('jonas@halden.test', PASSWORDS.shopper);
    await add(phone, 'camp-pillow');
    const laptop = new Client(t.app);
    await laptop.login('jonas@halden.test', PASSWORDS.shopper);
    expect(json(await laptop.get('/cart')).itemCount).toBe(1);
  });
});
