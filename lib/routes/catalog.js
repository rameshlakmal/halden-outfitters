// @ts-check
// Browsing: categories, the product list with filters, one product with related ones.
import { query } from '../db.js';
import { notFound } from '../http.js';

const PRODUCT_FIELDS = `
  p.id::text, p.slug, p.name, p.summary, p.price::text, p.image, p.featured,
  c.slug AS category, c.name AS "categoryName", i.stock`;

const SORTS = {
  featured: 'p.featured DESC, p.id',
  'price-asc': 'p.price, p.id',
  'price-desc': 'p.price DESC, p.id',
  newest: 'p.created_at DESC, p.id DESC',
};

/** @type {import('../router.js').Route[]} */
export const catalogRoutes = [
  ['GET', /^\/api\/categories$/, async () => query(`
    SELECT c.slug, c.name, c.blurb, count(p.id)::int AS "productCount"
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.active
     GROUP BY c.id
     ORDER BY c.position`)],

  ['GET', /^\/api\/products$/, async ({ query: q }) => {
    const sortKey = /** @type {keyof typeof SORTS} */ (q.get('sort') ?? 'featured');
    const order = SORTS[sortKey] ?? SORTS.featured;
    const search = (q.get('q') ?? '').trim().slice(0, 80);
    return query(`
      SELECT ${PRODUCT_FIELDS}
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN inventory i ON i.product_id = p.id
       WHERE p.active
         AND ($1::text IS NULL OR c.slug = $1)
         AND ($2::text = '' OR p.name ILIKE '%' || $2 || '%' OR p.summary ILIKE '%' || $2 || '%')
         AND (NOT $3::boolean OR p.featured)
       ORDER BY ${order}`, [q.get('category') || null, search, q.get('featured') === '1']);
  }],

  ['GET', /^\/api\/products\/([a-z0-9-]+)$/, async ({ params: [slug] }) => {
    const [product] = await query(`
      SELECT ${PRODUCT_FIELDS}, p.description, p.details
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN inventory i ON i.product_id = p.id
       WHERE p.slug = $1 AND p.active`, [slug]);
    if (!product) throw notFound('That product');
    const related = await query(`
      SELECT ${PRODUCT_FIELDS}
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN inventory i ON i.product_id = p.id
       WHERE p.active AND c.slug = $1 AND p.slug <> $2
       ORDER BY p.featured DESC, p.id
       LIMIT 3`, [product.category, slug]);
    return { ...product, related };
  }],
];
