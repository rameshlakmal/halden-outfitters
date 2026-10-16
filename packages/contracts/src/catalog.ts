import { z } from 'zod';
import { Amount, Id, Page, Slug } from './common.js';

export const PRODUCT_SORTS = ['featured', 'price-asc', 'price-desc', 'newest', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** in_stock: plenty; low_stock: at or under the product's threshold (the count is shown); out_of_stock: none. */
export const Availability = z
  .object({
    status: z.enum(['in_stock', 'low_stock', 'out_of_stock']),
    available: z.number().int().nullable().describe('Units left; only given when stock is low'),
  })
  .meta({ id: 'Availability' });

export const Image = z
  .object({ url: z.string(), alt: z.string(), width: z.number().int(), height: z.number().int() })
  .meta({ id: 'Image' });

export const Category = z
  .object({
    slug: Slug,
    name: z.string(),
    blurb: z.string(),
    image: z.string(),
    productCount: z.number().int(),
  })
  .meta({ id: 'Category' });

export const ProductCard = z
  .object({
    id: Id,
    slug: Slug,
    sku: z.string(),
    name: z.string(),
    summary: z.string(),
    price: Amount,
    compareAtPrice: Amount.nullable().describe('The old price when on sale'),
    category: z.object({ slug: Slug, name: z.string() }),
    image: Image,
    featured: z.boolean(),
    rating: z.object({ average: z.number().nullable(), count: z.number().int() }),
    availability: Availability,
  })
  .meta({ id: 'ProductCard' });
export type ProductCard = z.infer<typeof ProductCard>;

export const Product = ProductCard.extend({
  description: z.string(),
  details: z.array(z.tuple([z.string(), z.string()])),
  images: z.array(Image),
  returnable: z.boolean(),
  related: z.array(ProductCard),
}).meta({ id: 'Product' });
export type Product = z.infer<typeof Product>;

export const ProductQuery = z.object({
  category: Slug.optional(),
  q: z.string().trim().max(80).optional().describe('Search words, matched against name and summary'),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  inStock: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  onSale: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  featured: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(PRODUCT_SORTS).default('featured'),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  cursor: z.string().max(200).optional(),
});
export type ProductQuery = z.infer<typeof ProductQuery>;

export const ProductPage = Page(ProductCard)
  .extend({ priceRange: z.object({ min: Amount, max: Amount }).nullable() })
  .meta({ id: 'ProductPage' });
export type ProductPage = z.infer<typeof ProductPage>;

export const CategoryList = z.object({ items: z.array(Category) }).meta({ id: 'CategoryList' });
export type Category = z.infer<typeof Category>;
