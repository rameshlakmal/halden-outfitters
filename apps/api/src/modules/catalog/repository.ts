// Catalogue queries. Product lists use keyset pagination: every sort is turned into an ascending key plus the
// id, so "the next page" is simply WHERE (key, id) > (last key, last id), which stays fast and never skips rows.
import type { ProductCard, ProductQuery, ProductSort } from '@halden/contracts';
import type { Db } from '../../core/db.js';

export type CardRow = {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string;
  price: string;
  compare_at_price: string | null;
  featured: boolean;
  rating_avg: string | null;
  rating_count: number;
  category_slug: string;
  category_name: string;
  image_url: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
  available: number;
  low_stock_threshold: number;
  sort_key: string;
};

/** The ascending sort key for each sort. Text, so one cursor format fits all (numbers are zero-padded). */
const SORT_KEYS: Record<ProductSort, string> = {
  featured: "(CASE WHEN p.featured THEN '0' ELSE '1' END)",
  'price-asc': "lpad((p.price * 100)::bigint::text, 12, '0')",
  'price-desc': "lpad((999999999999 - p.price * 100)::bigint::text, 12, '0')",
  newest: "lpad((9999999999 - extract(epoch FROM p.created_at))::bigint::text, 12, '0')",
  rating: "lpad((99 - coalesce(p.rating_avg, 0) * 10)::int::text, 2, '0') || lpad((999999 - p.rating_count)::text, 6, '0')",
};

export const CARD_SELECT = (sortKey = "''") => `
  p.id, p.slug, p.sku, p.name, p.summary, p.price, p.compare_at_price, p.featured, p.rating_avg, p.rating_count,
  p.low_stock_threshold, c.slug AS category_slug, c.name AS category_name,
  img.url AS image_url, img.alt AS image_alt, img.width AS image_width, img.height AS image_height,
  sl.available, ${sortKey} AS sort_key`;

export const CARD_FROM = `
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN stock_levels sl ON sl.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT url, alt, width, height FROM product_images pi WHERE pi.product_id = p.id ORDER BY position LIMIT 1
  ) img ON true`;

export function toAvailability(available: number, threshold: number): ProductCard['availability'] {
  if (available <= 0) return { status: 'out_of_stock', available: 0 };
  if (available <= threshold) return { status: 'low_stock', available };
  return { status: 'in_stock', available: null };
}

export function toCard(r: CardRow): ProductCard {
  return {
    id: r.id,
    slug: r.slug,
    sku: r.sku,
    name: r.name,
    summary: r.summary,
    price: r.price,
    compareAtPrice: r.compare_at_price,
    category: { slug: r.category_slug, name: r.category_name },
    image: {
      url: r.image_url ?? '/images/placeholder.jpg',
      alt: r.image_alt ?? r.name,
      width: r.image_width ?? 1200,
      height: r.image_height ?? 1200,
    },
    featured: r.featured,
    rating: { average: r.rating_avg === null ? null : Number(r.rating_avg), count: r.rating_count },
    availability: toAvailability(r.available, r.low_stock_threshold),
  };
}

export type Cursor = { key: string; id: string };

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify([c.key, c.id])).toString('base64url');

export function decodeCursor(s: string | undefined): Cursor | null {
  if (!s) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && /^\d+$/.test(v[1])) {
      return { key: v[0], id: v[1] };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export class CatalogRepository {
  constructor(private readonly db: Db) {}

  listCategories() {
    return this.db.query<{ slug: string; name: string; blurb: string; image: string; product_count: number }>(`
      SELECT c.slug, c.name, c.blurb, c.image, count(p.id)::int AS product_count
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id AND p.active
       GROUP BY c.id
       ORDER BY c.position`);
  }

  async listProducts(q: ProductQuery, cursor: Cursor | null) {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = ['p.active'];
    if (q.category) where.push(`c.slug = ${p(q.category)}`);
    if (q.q) {
      // Full-text match on whole words, or a prefix match on the name for "half-typed" searches.
      // % and _ in the search are literal characters, not LIKE wildcards ("_" alone must not match everything).
      const words = p(q.q);
      const literal = p(q.q.replace(/[\\%_]/g, '\\$&'));
      where.push(
        `(to_tsvector('english', p.name || ' ' || p.summary) @@ websearch_to_tsquery('english', ${words})
          OR p.name ILIKE '%' || ${literal} || '%' ESCAPE '\\')`,
      );
    }
    if (q.minPrice !== undefined) where.push(`p.price >= ${p(q.minPrice)}`);
    if (q.maxPrice !== undefined) where.push(`p.price <= ${p(q.maxPrice)}`);
    if (q.inStock) where.push('sl.available > 0');
    if (q.onSale) where.push('p.compare_at_price IS NOT NULL');
    if (q.featured) where.push('p.featured');
    const filters = where.join(' AND ');
    const filterParams = [...params];

    const sortKey = SORT_KEYS[q.sort];
    const pageWhere = cursor ? ` AND (${sortKey}, p.id) > (${p(cursor.key)}, ${p(cursor.id)}::bigint)` : '';
    const rows = await this.db.query<CardRow>(
      `SELECT ${CARD_SELECT(sortKey)} ${CARD_FROM}
        WHERE ${filters}${pageWhere}
        ORDER BY ${sortKey}, p.id
        LIMIT ${p(q.limit + 1)}`,
      params,
    );
    const stats = await this.db.one<{ total: number; min: string | null; max: string | null }>(
      `SELECT count(*)::int AS total, min(p.price)::text AS min, max(p.price)::text AS max ${CARD_FROM} WHERE ${filters}`,
      filterParams,
    );
    return { rows, total: stats?.total ?? 0, min: stats?.min ?? null, max: stats?.max ?? null };
  }

  findProduct(slug: string) {
    return this.db.one<CardRow & { description: string; details: [string, string][]; returnable: boolean; sized: boolean }>(
      `SELECT ${CARD_SELECT()}, p.description, p.details, p.returnable, p.sized ${CARD_FROM} WHERE p.slug = $1 AND p.active`,
      [slug],
    );
  }

  images(productId: string) {
    return this.db.query<{ url: string; alt: string; width: number; height: number }>(
      'SELECT url, alt, width, height FROM product_images WHERE product_id = $1 ORDER BY position',
      [productId],
    );
  }

  related(categorySlug: string, productId: string, limit = 4) {
    return this.db.query<CardRow>(
      `SELECT ${CARD_SELECT()} ${CARD_FROM}
        WHERE p.active AND c.slug = $1 AND p.id <> $2
        ORDER BY p.featured DESC, p.rating_avg DESC NULLS LAST, p.id
        LIMIT $3`,
      [categorySlug, productId, limit],
    );
  }
}
