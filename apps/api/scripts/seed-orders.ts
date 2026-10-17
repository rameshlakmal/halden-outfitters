// Demo order history, placed through the real checkout and order services with backdated times, so every
// seeded order obeys the same rules as a real one (stock holds and sales, payments, coupon uses all add up).
import { loadConfig } from '../src/config.js';
import type { CurrentUser } from '../src/core/auth.js';
import { Bugs } from '../src/core/bugs.js';
import { Clock } from '../src/core/clock.js';
import type { AppContext } from '../src/core/context.js';
import type { Db } from '../src/core/db.js';
import { RateLimiter } from '../src/core/rate-limit.js';
import { CheckoutService } from '../src/modules/checkout/service.js';
import { OrderService } from '../src/modules/orders/service.js';
import { HaldenPay } from '../src/modules/payments/haldenpay.js';
import { DEMO_ORDERS } from './seed-data.js';

type Person = { id: string; name: string; email: string; role: CurrentUser['role'] };

const asUser = (p: Person): CurrentUser => ({
  id: p.id,
  sessionId: '00000000-0000-4000-8000-000000000000',
  name: p.name,
  email: p.email,
  role: p.role,
  emailVerified: true,
  createdAt: new Date(),
});

export async function seedOrders(db: Db): Promise<number> {
  const ctx: AppContext = {
    config: loadConfig({ DATABASE_URL: 'postgres://seed/seed', APP_URL: process.env.APP_URL ?? 'http://localhost:3001', NODE_ENV: 'development' }),
    db,
    clock: new Clock(db),
    limiter: new RateLimiter(db, false),
    bugs: new Bugs(db),
    gateway: new HaldenPay(),
    deliverWebhooks: async () => 0,
  };
  const checkout = new CheckoutService(ctx);
  const orders = new OrderService(ctx);
  const people = await db.query<Person>('SELECT id, name, email, role FROM customers');
  const by = (email: string) => people.find((p) => p.email === email)!;
  const warehouse = asUser(by('warehouse@halden.test'));
  const day = 86400_000;

  for (const [n, o] of DEMO_ORDERS.entries()) {
    const customer = by(o.email);
    const at = new Date(Date.now() - o.daysAgo * day - (n % 5) * 3600_000 - 2 * 3600_000);
    const cart = await db.one<{ id: string }>(
      `INSERT INTO carts (customer_id) VALUES ($1)
       ON CONFLICT (customer_id) WHERE customer_id IS NOT NULL DO UPDATE SET updated_at = now() RETURNING id`,
      [customer.id],
    );
    await db.query('DELETE FROM cart_items WHERE cart_id = $1', [cart!.id]);
    for (const [slug, qty] of o.items) {
      await db.query('INSERT INTO cart_items (cart_id, product_id, qty) SELECT $1, id, $3 FROM products WHERE slug = $2', [cart!.id, slug, qty]);
    }
    await db.query('UPDATE carts SET coupon_code = $2 WHERE id = $1', [cart!.id, o.coupon ?? null]);
    const address = await db.one<{ id: string }>('SELECT id FROM addresses WHERE customer_id = $1 AND is_default', [customer.id]);

    const placed = await checkout.place(
      asUser(customer),
      { shipTo: { addressId: address!.id }, shippingMethod: o.method ?? 'standard', pointsToRedeem: 0, useStoreCredit: false, card: { number: o.card ?? '4242424242424242' } },
      at,
    );
    const id = placed.orderId;
    const later = (hours: number) => new Date(at.getTime() + hours * 3600_000);
    if (o.status === 'cancelled') {
      await orders.cancel(id, asUser(customer), 'changed_mind', null, later(2));
      continue;
    }
    if (o.status === 'confirmed') continue;
    await orders.pack(id, warehouse, later(5));
    if (o.status === 'packed') continue;
    await orders.ship(id, warehouse, `HX${String(4815162342 + n * 7919).slice(0, 10)}`, later(20));
    if (o.status === 'shipped') continue;
    await orders.deliver(id, warehouse, later(20 + 48));
  }
  // The provider's events for the seeded orders are history: mark them delivered.
  await db.query('UPDATE haldenpay.events SET delivered_at = now(), attempts = 1');
  // Orders whose return window has passed become completed now.
  await orders.sweep(new Date());
  return DEMO_ORDERS.length;
}
