import { CategoryList, Problem, Product, ProductPage, ProductQuery, Slug } from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../../core/errors.js';
import { CatalogRepository, decodeCursor, encodeCursor, toCard } from './repository.js';

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  const repo = new CatalogRepository(app.ctx.db);

  app.get(
    '/categories',
    { schema: { tags: ['Catalog'], summary: 'All categories, in shop order', response: { 200: CategoryList } } },
    async () => ({
      items: (await repo.listCategories()).map((c) => ({
        slug: c.slug,
        name: c.name,
        blurb: c.blurb,
        image: c.image,
        productCount: c.product_count,
      })),
    }),
  );

  app.get(
    '/products',
    {
      schema: {
        tags: ['Catalog'],
        summary: 'Search and filter products',
        description: 'Cursor-paginated. Pass `nextCursor` back as `cursor` with the same filters to get the next page.',
        querystring: ProductQuery,
        response: { 200: ProductPage, 400: Problem },
      },
    },
    async (req) => {
      const q = req.query;
      if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
        throw new AppError('validation_failed', 'The lowest price must not be above the highest.', {
          errors: [{ path: 'minPrice', message: 'Must not be above the highest price.' }],
        });
      }
      const cursor = decodeCursor(q.cursor);
      if (q.cursor && !cursor) {
        throw new AppError('validation_failed', 'That page link is not valid any more.', {
          errors: [{ path: 'cursor', message: 'Not a valid cursor.' }],
        });
      }
      const { rows, total, min, max } = await repo.listProducts(q, cursor);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page.map(toCard),
        nextCursor: rows.length > q.limit && last ? encodeCursor({ key: last.sort_key, id: last.id }) : null,
        total,
        priceRange: min && max ? { min, max } : null,
      };
    },
  );

  app.get(
    '/products/:slug',
    {
      schema: {
        tags: ['Catalog'],
        summary: 'One product, with its gallery and related products',
        params: z.object({ slug: Slug }),
        response: { 200: Product, 404: Problem },
      },
    },
    async (req) => {
      const row = await repo.findProduct(req.params.slug);
      if (!row) throw notFound('That product');
      const [images, related] = await Promise.all([repo.images(row.id), repo.related(row.category_slug, row.id)]);
      const card = toCard(row);
      return {
        ...card,
        description: row.description,
        details: row.details,
        images: images.length ? images : [card.image],
        returnable: row.returnable,
        related: related.map(toCard),
      };
    },
  );
};
