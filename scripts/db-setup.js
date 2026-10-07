// @ts-check
// Creates the shop's tables and fills them with the demo catalogue, accounts and a few past orders.
// Usage: npm run db:setup   (DATABASE_URL from .env; drops and recreates the shop tables)
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../lib/auth.js';
import { BUGS } from '../lib/bugs.js';
import { closePool, getPool } from '../lib/db.js';
import { fromCents, toCents } from '../lib/money.js';
import { priceCart } from '../lib/pricing.js';
import { CATEGORIES, COUPONS, PRODUCTS } from '../db/seed-data.js';

try { process.loadEnvFile(); } catch { /* no .env: use the environment */ }


const ACCOUNTS = [
  { email: 'admin@halden.test', name: 'Halden staff', admin: true, passwordVar: 'SEED_ADMIN_PASSWORD' },
  { email: 'maya@halden.test', name: 'Maya Okafor', admin: false, passwordVar: 'SEED_SHOPPER_PASSWORD' },
  { email: 'jonas@halden.test', name: 'Jonas Lindqvist', admin: false, passwordVar: 'SEED_SHOPPER_PASSWORD' },
  { email: 'ari@halden.test', name: 'Ari Takahashi', admin: false, passwordVar: 'SEED_SHOPPER_PASSWORD' },
];

/** Past orders, so the account and admin pages have history. TRAILHEAD15 ends up used all 3 times. */
const ORDERS = [
  { email: 'maya@halden.test', daysAgo: 12, status: 'delivered', coupon: 'TRAILHEAD15', items: [['ridgeline-2p-tent', 1], ['ember-stove', 1]] },
  { email: 'jonas@halden.test', daysAgo: 6, status: 'delivered', coupon: null, items: [['camp-pillow', 2], ['insulated-mug', 1]] },
  { email: 'ari@halden.test', daysAgo: 5, status: 'cancelled', coupon: null, items: [['drift-hammock', 1]] },
  { email: 'jonas@halden.test', daysAgo: 3, status: 'shipped', coupon: 'TRAILHEAD15', items: [['summit-45l-pack', 1], ['roll-top-dry-bag', 2]] },
  { email: 'maya@halden.test', daysAgo: 1, status: 'paid', coupon: 'TRAILHEAD15', items: [['alpine-down-bag', 1]] },
  { email: 'ari@halden.test', daysAgo: 0, status: 'paid', coupon: 'WELCOME10', items: [['headlamp-400', 1], ['water-filter', 1]] },
];

const ADDRESSES = {
  'maya@halden.test': ['Maya Okafor', '14 Larch Street', 'Portland', '97205', 'United States'],
  'jonas@halden.test': ['Jonas Lindqvist', 'Storgatan 8', 'Umea', '903 26', 'Sweden'],
  'ari@halden.test': ['Ari Takahashi', '2-7-1 Asahi', 'Sapporo', '060-0042', 'Japan'],
};

/** Drops and recreates the shop tables in DATABASE_URL's database, then seeds them. */
export async function setupDatabase() {
  for (const a of ACCOUNTS) {
    if (!process.env[a.passwordVar]) throw new Error(`Set ${a.passwordVar} in .env (see .env.example).`);
  }
  const db = await getPool().connect();
  try {
    await db.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    await db.query('BEGIN');

    for (const [i, c] of CATEGORIES.entries()) {
      await db.query('INSERT INTO categories (slug, name, blurb, position) VALUES ($1, $2, $3, $4)', [c.slug, c.name, c.blurb, i + 1]);
    }
    /** @type {Map<string, { id: string, name: string, price: string }>} */
    const products = new Map();
    for (const p of PRODUCTS) {
      const { rows: [row] } = await db.query(`
        INSERT INTO products (slug, category_id, name, summary, description, details, price, image, featured)
        SELECT $1, id, $3, $4, $5, $6, $7, $8, $9 FROM categories WHERE slug = $2
        RETURNING id::text`,
        [p.slug, p.category, p.name, p.summary, p.description, JSON.stringify(Object.entries(p.details)), p.price, `/images/products/${p.slug}.jpg`, p.featured ?? false]);
      products.set(p.slug, { id: row.id, name: p.name, price: p.price });
      // Stock on hand is the catalogue's number; the opening movement also covers what the seeded orders sold,
      // so the movements always add up to the stock.
      const sold = ORDERS.filter((o) => o.status !== 'cancelled').flatMap((o) => o.items).filter(([s]) => s === p.slug).reduce((n, [, q]) => n + Number(q), 0);
      await db.query('INSERT INTO inventory (product_id, stock) VALUES ($1, $2)', [row.id, p.stock]);
      if (p.stock + sold > 0) {
        await db.query("INSERT INTO stock_movements (product_id, change, reason, note, created_at) VALUES ($1, $2, 'initial', 'Opening stock', now() - interval '30 days')",
          [row.id, p.stock + sold]);
      }
    }
    for (const c of COUPONS) {
      await db.query('INSERT INTO coupons (code, kind, value, min_subtotal, max_uses, active, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [c.code, c.kind, c.value, c.min_subtotal, c.max_uses, c.active, c.expires_at]);
    }
    for (const [i, b] of BUGS.entries()) {
      await db.query('INSERT INTO qa_bugs (key, title, description, how_to_see, position) VALUES ($1, $2, $3, $4, $5)', [b.key, b.title, b.description, b.howToSee, i + 1]);
    }
    /** @type {Map<string, string>} */
    const customers = new Map();
    for (const a of ACCOUNTS) {
      const { rows: [row] } = await db.query(
        "INSERT INTO customers (email, name, password_hash, is_admin, created_at) VALUES ($1, $2, $3, $4, now() - interval '40 days') RETURNING id::text",
        [a.email, a.name, await hashPassword(String(process.env[a.passwordVar])), a.admin]);
      customers.set(a.email, row.id);
    }

    for (const o of ORDERS) {
      const lines = o.items.map(([slug, qty]) => {
        const product = /** @type {{ id: string, name: string, price: string }} */ (products.get(String(slug)));
        return { ...product, unitPrice: product.price, qty: Number(qty) };
      });
      const coupon = o.coupon ? COUPONS.find((c) => c.code === o.coupon) : null;
      const totals = priceCart(lines, /** @type {any} */ (coupon), new Set());
      const at = `now() - interval '${o.daysAgo} days' - interval '${(o.daysAgo * 37) % 600} minutes'`;
      const ship = ADDRESSES[/** @type {keyof typeof ADDRESSES} */ (o.email)];
      const { rows: [order] } = await db.query(`
        INSERT INTO orders (customer_id, status, subtotal, discount, shipping, tax, total, coupon_code,
                            ship_name, ship_line1, ship_city, ship_postcode, ship_country, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, ${at}, ${at})
        RETURNING id`,
        [customers.get(o.email), o.status, totals.subtotal, totals.discount, totals.shipping, totals.tax, totals.total, o.coupon, ...ship]);
      for (const l of lines) {
        await db.query('INSERT INTO order_items (order_id, product_id, name, unit_price, qty, line_total) VALUES ($1, $2, $3, $4, $5, $6)',
          [order.id, l.id, l.name, l.unitPrice, l.qty, fromCents(toCents(l.unitPrice) * l.qty)]);
        await db.query(`INSERT INTO stock_movements (product_id, change, reason, order_id, created_at) VALUES ($1, $2, 'sale', $3, ${at})`, [l.id, -l.qty, order.id]);
        if (o.status === 'cancelled') {
          await db.query(`INSERT INTO stock_movements (product_id, change, reason, order_id, created_at) VALUES ($1, $2, 'cancel', $3, ${at} + interval '2 hours')`, [l.id, l.qty, order.id]);
        }
      }
      await db.query(`INSERT INTO payments (order_id, amount, card_last4, status, created_at, updated_at) VALUES ($1, $2, '4242', $3, ${at}, ${at})`,
        [order.id, totals.total, o.status === 'cancelled' ? 'refunded' : 'captured']);
      const history = { paid: ['paid'], shipped: ['paid', 'shipped'], delivered: ['paid', 'shipped', 'delivered'], cancelled: ['paid', 'cancelled'] }[o.status] ?? [];
      for (const [step, status] of history.entries()) {
        const note = { paid: 'Order placed and paid', shipped: 'Handed to the courier', delivered: 'Delivered', cancelled: 'Cancelled by the customer' }[status];
        await db.query(`INSERT INTO order_events (order_id, status, note, created_at) VALUES ($1, $2, $3, ${at} + interval '${step} days')`, [order.id, status, note]);
      }
      if (o.coupon) await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE code = $1', [o.coupon]);
    }

    await db.query('COMMIT');
    return `Shop ready: ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ${COUPONS.length} coupons, ${ACCOUNTS.length} accounts, ${ORDERS.length} past orders.`;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

// Run as a script: npm run db:setup
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupDatabase()
    .then((message) => console.log(message))
    .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
    .finally(() => closePool());
}
