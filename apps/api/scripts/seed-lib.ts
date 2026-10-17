// Fills a migrated database with the demo shop. Empties every shop table first, so it can be run again.
import { hashPassword } from '../src/core/crypto.js';
import type { Db } from '../src/core/db.js';
import { BUGS } from '../src/core/bugs.js';
import { ACCOUNTS, ADDRESSES, CATEGORIES, COUNTRIES, COUPONS, GALLERY, PRODUCTS, RATES, SIZED, ZONES, zoneOf } from './seed-data.js';
import { seedOrders } from './seed-orders.js';

/** admin: the admin account. staff: support and warehouse, so their testers can't sign in as admin. */
export type SeedPasswords = { admin: string; staff: string; shopper: string };

export async function seed(db: Db, passwords: SeedPasswords, opts: { orders?: boolean } = {}): Promise<string> {
  // Hash outside the transaction: argon2 is deliberately slow.
  const adminHash = await hashPassword(passwords.admin);
  const staffHash = await hashPassword(passwords.staff);
  const shopperHash = await hashPassword(passwords.shopper);

  await db.tx(async (tx) => {
    const { rows: tables } = await tx.query<{ name: string }>(
      `SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS name FROM pg_tables
        WHERE schemaname IN ('public', 'haldenpay') AND tablename NOT IN ('schema_migrations', 'qa_settings', 'shop_settings')`,
    );
    if (tables.length) await tx.query(`TRUNCATE ${tables.map((t) => t.name).join(', ')} RESTART IDENTITY CASCADE`);
    await tx.query("UPDATE qa_settings SET value = '0' WHERE key = 'clock_offset_seconds'");
    await tx.query("UPDATE shop_settings SET value = '8' WHERE key = 'tax_rate_percent'");

    for (const [i, z] of ZONES.entries()) {
      await tx.query('INSERT INTO shipping_zones (code, name, position) VALUES ($1, $2, $3)', [z.code, z.name, i + 1]);
    }
    for (const r of RATES) {
      await tx.query(
        'INSERT INTO shipping_rates (zone_code, method, price, free_from, days_min, days_max) VALUES ($1, $2, $3, $4, $5, $6)',
        [r.zone, r.method, r.price, r.freeFrom, r.days[0], r.days[1]],
      );
    }
    for (const [code, name] of COUNTRIES) {
      await tx.query('INSERT INTO countries (code, name, zone_code) VALUES ($1, $2, $3)', [code, name, zoneOf(code)]);
    }

    for (const [i, c] of CATEGORIES.entries()) {
      await tx.query('INSERT INTO categories (slug, name, blurb, image, position) VALUES ($1, $2, $3, $4, $5)', [
        c.slug,
        c.name,
        c.blurb,
        c.image,
        i + 1,
      ]);
    }

    for (const [i, p] of PRODUCTS.entries()) {
      // Older products first, so "newest" has a stable, meaningful order.
      const createdAt = new Date(Date.now() - (PRODUCTS.length - i) * 86400_000 * 3);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO products (slug, sku, category_id, name, summary, description, details, price, compare_at_price,
                               returnable, featured, created_at, updated_at)
         SELECT $1, $2, id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12 FROM categories WHERE slug = $3
         RETURNING id`,
        [
          p.slug,
          p.sku,
          p.category,
          p.name,
          p.summary,
          p.description,
          JSON.stringify(Object.entries(p.details)),
          p.price,
          p.compareAt,
          p.returnable,
          p.featured ?? false,
          createdAt,
        ],
      );
      const id = rows[0]!.id;
      await tx.query(
        'INSERT INTO product_images (product_id, url, alt, width, height, position) VALUES ($1, $2, $3, 1200, 1200, 1)',
        [id, `/images/products/${p.slug}.jpg`, p.name],
      );
      for (const [i, alt] of (GALLERY[p.slug] ?? []).entries()) {
        await tx.query(
          'INSERT INTO product_images (product_id, url, alt, width, height, position) VALUES ($1, $2, $3, 1200, 1200, $4)',
          [id, `/images/products/${p.slug}-${i + 2}.jpg`, alt, i + 2],
        );
      }
      await tx.query('INSERT INTO inventory (product_id, on_hand) VALUES ($1, $2)', [id, p.stock]);
      if (p.stock > 0) {
        await tx.query(
          "INSERT INTO stock_movements (product_id, change, reason, note, created_at) VALUES ($1, $2, 'initial', 'Opening stock', $3)",
          [id, p.stock, createdAt],
        );
      }
    }

    for (const c of COUPONS) {
      await tx.query(
        `INSERT INTO coupons (code, kind, value, min_subtotal, max_uses, per_customer_limit, first_order_only,
                              excludes_sale_items, ends_at, active, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [c.code, c.kind, c.value, c.minSubtotal ?? '0', c.maxUses ?? null, c.perCustomer ?? null, c.firstOrderOnly ?? false,
          !c.includeSaleItems, c.endsAt ?? null, c.active ?? true, c.description],
      );
      for (const slug of c.excludeCategories ?? []) {
        await tx.query('INSERT INTO coupon_excluded_categories (coupon_code, category_id) SELECT $1, id FROM categories WHERE slug = $2', [c.code, slug]);
      }
    }
    await tx.query('UPDATE products SET sized = true WHERE slug = ANY($1)', [SIZED]);
    for (const [i, b] of BUGS.entries()) {
      await tx.query(
        'INSERT INTO qa_bugs (key, phase, title, description, how_to_see, rule, position) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [b.key, b.phase, b.title, b.description, b.howToSee, b.rule, i + 1],
      );
    }

    for (const a of ACCOUNTS) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO customers (email, name, password_hash, role, email_verified_at, is_demo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now() - interval '60 days', true, now() - interval '60 days', now() - interval '60 days')
         RETURNING id`,
        [a.email, a.name, a.role === 'admin' ? adminHash : a.staff ? staffHash : shopperHash, a.role],
      );
      for (const [i, ad] of (ADDRESSES[a.email] ?? []).entries()) {
        await tx.query(
          `INSERT INTO addresses (customer_id, name, line1, city, region, postcode, country_code, is_default, label)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [rows[0]!.id, ad.name, ad.line1, ad.city, ad.region ?? null, ad.postcode, ad.country, i === 0, i === 0 ? 'Home' : 'Cabin'],
        );
      }
    }
  });

  const orders = opts.orders === false ? 0 : await seedOrders(db);
  return `Shop ready: ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ${ACCOUNTS.length} accounts, ${COUNTRIES.length} countries, ${COUPONS.length} coupons, ${orders} orders.`;
}

export function seedPasswordsFromEnv(env = process.env): SeedPasswords {
  const admin = env.SEED_ADMIN_PASSWORD;
  const staff = env.SEED_STAFF_PASSWORD;
  const shopper = env.SEED_SHOPPER_PASSWORD;
  if (!admin || !staff || !shopper) {
    throw new Error('Set SEED_ADMIN_PASSWORD, SEED_STAFF_PASSWORD and SEED_SHOPPER_PASSWORD (see .env.example).');
  }
  if (new Set([admin, staff, shopper]).size < 3) throw new Error('The three SEED_*_PASSWORD values must all differ.');
  return { admin, staff, shopper };
}
