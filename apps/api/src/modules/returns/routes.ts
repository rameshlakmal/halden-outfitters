import {
  Goodwill,
  Id,
  Order,
  PointsAccount,
  Problem,
  ReceiveReturn,
  RejectReturn,
  RequestReturn,
  Return,
  RETURN_STATUSES,
  ReturnSummary,
  StoreCreditAccount,
  Total,
} from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { needsUser, requireRole, requireUser } from '../../core/auth.js';
import { withIdempotency } from '../../core/idempotency.js';
import { balance, isSummit } from '../loyalty/points.js';
import { creditBalance } from '../loyalty/store-credit.js';
import { OrderService } from '../orders/service.js';
import { ReturnService } from './service.js';

const security: Record<string, string[]>[] = [{ session: [] }, { bearer: [] }];
const ReturnList = z.object({ items: z.array(ReturnSummary), nextCursor: z.string().nullable(), total: Total });
const listQuery = z.object({ cursor: Id.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
const params = z.object({ id: Id });

export const returnRoutes: FastifyPluginAsyncZod = async (app) => {
  const returns = new ReturnService(app.ctx);
  const orders = new OrderService(app.ctx);
  const tags = ['Returns'];
  const staffTags = ['Staff'];
  const accountTags = ['Account'];

  // ---------- customer ----------

  app.post(
    '/orders/:id/returns',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Start a return',
        description:
          'Within 30 days of delivery, for returnable products. Damaged, wrong or not-as-described items worth up to 150.00 are ' +
          'approved straight away with a free label; other reasons wait for support and pay a 4.95 label fee from the refund.',
        security,
        params,
        body: RequestReturn,
        response: { 201: Return, 400: Problem, 401: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const id = await returns.request(req.params.id, user, req.body, req.now);
      return reply.code(201).send(await returns.view(id, user, req.now));
    },
  );

  app.get(
    '/returns',
    {
      schema: {
        tags,
        summary: 'Your returns, newest first',
        security,
        querystring: listQuery,
        response: { 200: ReturnList, 401: Problem },
      },
    },
    async (req) => returns.list({ customerId: requireUser(req).id }, req.query.cursor ?? null, req.query.limit),
  );

  app.get(
    '/returns/:id',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'One of your returns',
        security,
        params,
        response: { 200: Return, 401: Problem, 404: Problem },
      },
    },
    async (req) => returns.view(req.params.id, requireUser(req), req.now),
  );

  app.post(
    '/returns/:id/cancel',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Cancel a return before it is sent',
        security,
        params,
        response: { 200: Return, 401: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireUser(req);
      await returns.cancel(req.params.id, user, req.now);
      return returns.view(req.params.id, user, req.now);
    },
  );

  // ---------- account: points and store credit ----------

  app.get(
    '/account/points',
    {
      schema: {
        tags: accountTags,
        summary: 'Halden Points balance and history',
        security,
        response: { 200: PointsAccount, 401: Problem },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const db = app.ctx.db;
      const [b, summit, next, history] = await Promise.all([
        balance(db.pool, user.id, req.now),
        isSummit(db.pool, user.id, req.now),
        db.one<{ points: number; expires_at: Date }>(
          `SELECT sum(remaining)::int AS points, min(expires_at) AS expires_at FROM loyalty_ledger
            WHERE customer_id = $1 AND remaining > 0 AND expires_at > $2
              AND expires_at = (SELECT min(expires_at) FROM loyalty_ledger WHERE customer_id = $1 AND remaining > 0 AND expires_at > $2)`,
          [user.id, req.now],
        ),
        db.query<{
          kind: string;
          points: number;
          bucket: 'pending' | 'available';
          order_id: string | null;
          note: string | null;
          created_at: Date;
        }>(
          'SELECT kind, points, bucket, order_id, note, created_at FROM loyalty_ledger WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
          [user.id],
        ),
      ]);
      return {
        available: b.available,
        pending: b.pending,
        tier: summit ? ('summit' as const) : ('base' as const),
        nextExpiry: next?.points && next.expires_at ? { points: next.points, at: next.expires_at.toISOString() } : null,
        history: history.map((h) => ({
          kind: h.kind,
          points: h.points,
          bucket: h.bucket,
          orderId: h.order_id,
          note: h.note,
          at: h.created_at.toISOString(),
        })),
      };
    },
  );

  app.get(
    '/account/store-credit',
    {
      schema: {
        tags: accountTags,
        summary: 'Store credit balance and history',
        security,
        response: { 200: StoreCreditAccount, 401: Problem },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const [b, history] = await Promise.all([
        creditBalance(app.ctx.db.pool, user.id),
        app.ctx.db.query<{ amount: string; reason: string; order_id: string | null; created_at: Date }>(
          'SELECT amount, reason, order_id, created_at FROM store_credit_ledger WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
          [user.id],
        ),
      ]);
      return {
        balance: b,
        history: history.map((h) => ({
          amount: h.amount,
          reason: h.reason,
          orderId: h.order_id,
          at: h.created_at.toISOString(),
        })),
      };
    },
  );

  // ---------- staff ----------

  app.get(
    '/staff/returns',
    {
      preValidation: needsUser,
      schema: {
        tags: staffTags,
        summary: 'All returns (staff)',
        security,
        querystring: listQuery.extend({ status: z.enum(RETURN_STATUSES).optional() }),
        response: { 200: ReturnList, 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'support', 'warehouse', 'admin');
      return returns.list({ status: req.query.status }, req.query.cursor ?? null, req.query.limit);
    },
  );

  app.get(
    '/staff/returns/:id',
    {
      preValidation: needsUser,
      schema: {
        tags: staffTags,
        summary: 'One return (staff)',
        security,
        params,
        response: { 200: Return, 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => returns.view(req.params.id, requireRole(req, 'support', 'warehouse', 'admin'), req.now),
  );

  app.post(
    '/staff/returns/:id/approve',
    {
      preValidation: needsUser,
      schema: {
        tags: staffTags,
        summary: 'Approve a return and issue the label (support)',
        security,
        params,
        response: { 200: Return, 401: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireRole(req, 'support', 'admin');
      await returns.approve(req.params.id, user, req.now);
      return returns.view(req.params.id, user, req.now);
    },
  );

  app.post(
    '/staff/returns/:id/reject',
    {
      preValidation: needsUser,
      schema: {
        tags: staffTags,
        summary: 'Reject a return (support)',
        security,
        params,
        body: RejectReturn,
        response: { 200: Return, 400: Problem, 401: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireRole(req, 'support', 'admin');
      await returns.reject(req.params.id, user, req.body.reason, req.now);
      return returns.view(req.params.id, user, req.now);
    },
  );

  app.post(
    '/staff/returns/:id/receive',
    {
      preValidation: needsUser,
      schema: {
        tags: staffTags,
        summary: 'Receive and grade a return, then refund it (warehouse)',
        description:
          'as_new: full refund, restocked. opened: 15% restocking fee unless the shop was at fault, restocked. ' +
          'damaged_by_customer: no refund, written off. faulty: full refund, written off.',
        security,
        params,
        body: ReceiveReturn,
        response: { 200: Return, 400: Problem, 401: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireRole(req, 'warehouse', 'admin');
      await returns.receive(req.params.id, user, req.body.items, req.now);
      return returns.view(req.params.id, user, req.now);
    },
  );

  app.post(
    '/staff/orders/:id/goodwill',
    {
      preValidation: needsUser,
      schema: {
        tags: staffTags,
        summary: 'Goodwill refund without a return (support up to 50.00 per order)',
        description: 'Needs an Idempotency-Key header. Never more than is left to refund on the order.',
        security,
        params,
        body: Goodwill,
        response: { 200: Order, 400: Problem, 401: Problem, 403: Problem, 404: Problem, 409: Problem, 422: Problem },
      },
    },
    async (req, reply) => {
      const user = requireRole(req, 'support', 'admin');
      return withIdempotency(app.ctx.db, req, reply, user.id, async () => {
        await returns.goodwill(req.params.id, user, req.body, req.now);
        return { status: 200, body: await orders.view(req.params.id, user, req.now) };
      });
    },
  );
};
