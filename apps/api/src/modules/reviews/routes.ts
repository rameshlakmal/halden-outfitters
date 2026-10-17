import {
  HideReview,
  Id,
  OwnReview,
  Problem,
  REVIEW_STATUSES,
  ReviewInput,
  ReviewPage,
  ReviewQuery,
  Slug,
} from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { needsUser, requireRole, requireUser } from '../../core/auth.js';
import { ReviewService } from './service.js';

const security = [{ session: [] }];
const OwnList = z.object({ items: z.array(OwnReview), nextCursor: z.string().nullable() });
const listQuery = z.object({ cursor: Id.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
const params = z.object({ id: Id });

export const reviewRoutes: FastifyPluginAsyncZod = async (app) => {
  const reviews = new ReviewService(app.ctx);
  const tags = ['Reviews'];

  app.get(
    '/products/:slug/reviews',
    {
      schema: {
        tags,
        summary: "A product's published reviews, with the rating summary",
        description: 'Signed in, `viewer` says whether you can review it and why not.',
        params: z.object({ slug: Slug }),
        querystring: ReviewQuery,
        response: { 200: ReviewPage, 404: Problem },
      },
    },
    async (req) => reviews.page(req.params.slug, req.user, req.query),
  );

  app.post(
    '/products/:slug/reviews',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Review a product you bought',
        description:
          'Verified buyers only, one review per product. Reviews with a link, an email address or a blocked word wait for support.',
        security,
        params: z.object({ slug: Slug }),
        body: ReviewInput,
        response: { 201: OwnReview, 400: Problem, 401: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const id = await reviews.create(req.params.slug, user, req.body, req.now);
      return reply.code(201).send(await reviews.own(id, user));
    },
  );

  app.put(
    '/reviews/:id',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Edit your review (within 30 days)',
        security,
        params,
        body: ReviewInput,
        response: { 200: OwnReview, 400: Problem, 401: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireUser(req);
      await reviews.update(req.params.id, user, req.body, req.now);
      return reviews.own(req.params.id, user);
    },
  );

  app.delete(
    '/reviews/:id',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Delete your review',
        security,
        params,
        response: { 204: z.null(), 401: Problem, 404: Problem },
      },
    },
    async (req, reply) => {
      await reviews.remove(req.params.id, requireUser(req));
      return reply.code(204).send(null);
    },
  );

  const vote = (method: 'put' | 'delete', helpful: boolean, summary: string) =>
    app[method](
      '/reviews/:id/helpful',
      {
        preValidation: needsUser,
        schema: {
          tags,
          summary,
          security,
          params,
          response: { 204: z.null(), 401: Problem, 403: Problem, 404: Problem, 409: Problem },
        },
      },
      async (req, reply) => {
        await reviews.vote(req.params.id, requireUser(req), helpful, req.now);
        return reply.code(204).send(null);
      },
    );
  vote('put', true, 'Mark a review helpful');
  vote('delete', false, 'Take back your helpful mark');

  app.get(
    '/account/reviews',
    {
      schema: {
        tags: ['Account'],
        summary: 'Your reviews, with their moderation state',
        security,
        querystring: listQuery,
        response: { 200: OwnList, 401: Problem },
      },
    },
    async (req) =>
      reviews.moderationList({ customerId: requireUser(req).id }, false, req.query.cursor ?? null, req.query.limit),
  );

  // ---------- moderation ----------

  app.get(
    '/staff/reviews',
    {
      preValidation: needsUser,
      schema: {
        tags: ['Staff'],
        summary: 'Reviews by status (support)',
        security,
        querystring: listQuery.extend({ status: z.enum(REVIEW_STATUSES).optional() }),
        response: { 200: OwnList, 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'support', 'admin');
      return reviews.moderationList({ status: req.query.status }, true, req.query.cursor ?? null, req.query.limit);
    },
  );

  app.post(
    '/staff/reviews/:id/hide',
    {
      preValidation: needsUser,
      schema: {
        tags: ['Staff'],
        summary: 'Hide a review with a reason (support)',
        security,
        params,
        body: HideReview,
        response: { 200: OwnReview, 400: Problem, 401: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireRole(req, 'support', 'admin');
      await reviews.hide(req.params.id, user, req.body.reason, req.now);
      return reviews.own(req.params.id, user);
    },
  );

  app.post(
    '/staff/reviews/:id/publish',
    {
      preValidation: needsUser,
      schema: {
        tags: ['Staff'],
        summary: 'Publish a held or hidden review (support)',
        security,
        params,
        response: { 200: OwnReview, 401: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireRole(req, 'support', 'admin');
      await reviews.publish(req.params.id, user, req.now);
      return reviews.own(req.params.id, user);
    },
  );
};
