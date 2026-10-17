// Helpers for checkout and order tests.
import { randomUUID } from 'node:crypto';
import { Client, json, PASSWORDS, productId, type TestApp } from './helpers.js';

export const CARDS = {
  ok: '4242424242424242',
  declined: '4000000000000002',
  insufficient: '4000000000009995',
  bank: '4000000000003220',
  dispute: '4000000000000259',
};

export const card = (number: string = CARDS.ok) => ({
  number,
  expMonth: 12,
  expYear: 2030,
  cvc: '123',
  name: 'Test Shopper',
});

export async function signedIn(t: TestApp, email: string, staff = false) {
  const c = new Client(t.app);
  await c.login(email, email === 'admin@halden.test' ? PASSWORDS.admin : staff ? PASSWORDS.staff : PASSWORDS.shopper);
  return c;
}

/** A new verified customer with one address in `country`. */
export async function newCustomer(t: TestApp, country = 'US', name = 'Robin Fell') {
  const email = `c${randomUUID().slice(0, 8)}@example.com`;
  const c = new Client(t.app);
  const res = await c.post('/auth/register', { name, email, password: 'a long walk in the woods' });
  if (res.statusCode !== 201) throw new Error(res.body);
  await t.db.query('UPDATE customers SET email_verified_at = now() WHERE email = $1', [email]);
  const addr = json(
    await c.post('/account/addresses', {
      name,
      line1: '1 Test Way',
      city: 'Testville',
      postcode: '12345',
      countryCode: country,
    }),
  ).items[0];
  return { client: c, email, addressId: addr.id as string };
}

export async function fill(t: TestApp, c: Client, items: [slug: string, qty: number][]) {
  await c.delete('/cart');
  for (const [slug, qty] of items) {
    const res = await c.post('/cart/items', { productId: await productId(t.db, slug), qty });
    if (res.statusCode !== 200) throw new Error(`add ${slug}: ${res.body}`);
  }
}

export function checkout(
  c: Client,
  addressId: string,
  opts: { card?: string; method?: 'standard' | 'express'; key?: string } = {},
) {
  return c.post(
    '/checkout',
    { shipTo: { addressId }, shippingMethod: opts.method ?? 'standard', card: card(opts.card) },
    { 'idempotency-key': opts.key ?? randomUUID() },
  );
}

export async function available(t: TestApp, slug: string): Promise<number> {
  const row = await t.db.one<{ available: number }>(
    'SELECT sl.available FROM stock_levels sl JOIN products p ON p.id = sl.product_id WHERE p.slug = $1',
    [slug],
  );
  return row!.available;
}

export async function bug(t: TestApp, key: string, on = true) {
  await t.db.query('UPDATE qa_bugs SET enabled = $2 WHERE key = $1', [key, on]);
  t.app.ctx.bugs.forget();
}

/** A new customer's order of `items`, taken through pack, ship and deliver by the warehouse. */
export async function deliveredOrder(t: TestApp, items: [slug: string, qty: number][]) {
  const c = await newCustomer(t);
  await fill(t, c.client, items);
  const res = await checkout(c.client, c.addressId);
  if (res.statusCode !== 201) throw new Error(res.body);
  const orderId = json(res).orderId as string;
  const warehouse = await signedIn(t, 'warehouse@halden.test', true);
  const steps: [string, object][] = [
    ['pack', {}],
    ['ship', { trackingNumber: 'HX12345678' }],
    ['deliver', {}],
  ];
  for (const [step, body] of steps) {
    const r = await warehouse.post(`/staff/orders/${orderId}/${step}`, body);
    if (r.statusCode !== 200) throw new Error(`${step}: ${r.body}`);
  }
  return { ...c, orderId, warehouse };
}
