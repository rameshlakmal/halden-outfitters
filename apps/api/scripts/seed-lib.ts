// Fills a migrated database with the demo shop. Empties every shop table first, so it can be run again.
import { hashPassword } from '../src/core/crypto.js';
import type { Db } from '../src/core/db.js';
import { ACCOUNTS, ADDRESSES, CATEGORIES, COUNTRIES, PRODUCTS } from './seed-data.js';

export type SeedPasswords = { staff: string; shopper: string };

export async function seed(db: Db, passwords: SeedPasswords): Promise<string> {
  // Hash outside the transaction: argon2 is deliberately slow.
  const staffHash = await hashPassword(passwords.staff);
  const shopperHash = await hashPassword(passwords.shopper);

  await db.tx(async (tx) => {
    const { rows: tables } = await tx.query<{ name: string }>(
      `SELECT quote_ident(tablename) AS name FROM pg_tables
        WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'qa_settings')`,
    );
    if (tables.length) await tx.query(`TRUNCATE ${tables.map((t) => t.name).join(', ')} RESTART IDENTITY CASCADE`);
    await tx.query("UPDATE qa_settings SET value = '0' WHERE key = 'clock_offset_seconds'");

    for (const [code, name] of COUNTRIES) await tx.query('INSERT INTO countries (code, name) VALUES ($1, $2)', [code, name]);

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
      await tx.query('INSERT INTO inventory (product_id, on_hand) VALUES ($1, $2)', [id, p.stock]);
      if (p.stock > 0) {
        await tx.query(
          "INSERT INTO stock_movements (product_id, change, reason, note, created_at) VALUES ($1, $2, 'initial', 'Opening stock', $3)",
          [id, p.stock, createdAt],
        );
      }
    }

    for (const a of ACCOUNTS) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO customers (email, name, password_hash, role, email_verified_at, is_demo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now() - interval '60 days', true, now() - interval '60 days', now() - interval '60 days')
         RETURNING id`,
        [a.email, a.name, a.staff ? staffHash : shopperHash, a.role],
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

  return `Shop ready: ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ${ACCOUNTS.length} accounts, ${COUNTRIES.length} countries.`;
}

export function seedPasswordsFromEnv(env = process.env): SeedPasswords {
  const staff = env.SEED_ADMIN_PASSWORD;
  const shopper = env.SEED_SHOPPER_PASSWORD;
  if (!staff || !shopper) throw new Error('Set SEED_ADMIN_PASSWORD and SEED_SHOPPER_PASSWORD (see .env.example).');
  return { staff, shopper };
}
