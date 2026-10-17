import { CancelOrder, Id, ORDER_STATUSES, Order, OrderSummary, Problem, ShipOrder } from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { needsUser, requireRole, requireUser } from '../../core/auth.js';
import { OrderService } from './service.js';

const security = [{ session: [] }];
const OrderList = z.object({ items: z.array(OrderSummary), nextCursor: z.string().nullable() });
const StaffOrderList = z.object({
  items: z.array(OrderSummary.extend({ email: z.string() })),
  nextCursor: z.string().nullable(),
});

export const orderRoutes: FastifyPluginAsyncZod = async (app) => {
  const orders = new OrderService(app.ctx);
  const tags = ['Orders'];
  const staffTags = ['Staff'];
  const listQuery = z.object({ cursor: Id.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

  app.get(
    '/orders',
    { schema: { tags, summary: 'Your orders, newest first', security, querystring: listQuery, response: { 200: OrderList, 401: Problem } } },
    async (req) => {
      const user = requireUser(req);
      // Settle any of this customer's unpaid orders that have timed out, so the list is current.
      const due = await app.ctx.db.query<{ id: string }>(
        "SELECT id FROM orders WHERE customer_id = $1 AND status = 'pending_payment' AND payment_expires_at <= $2",
        [user.id, req.now],
      );
      for (const d of due) await app.ctx.db.tx((tx) => orders.settle(tx, d.id, req.now));
      const page = await orders.list({ customerId: user.id }, req.query.cursor ?? null, req.query.limit);
      return { items: page.items.map(({ email: _email, ...o }) => o), nextCursor: page.nextCursor };
    },
  );

  app.get(
    '/orders/:id',
    {
      preValidation: needsUser,
      schema: { tags, summary: 'One of your orders', security, params: z.object({ id: Id }), response: { 200: Order, 401: Problem, 404: Problem } },
    },
    async (req) => orders.view(req.params.id, requireUser(req), req.now),
  );

  app.post(
    '/orders/:id/cancel',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Cancel an order',
        description:
          'Customers can cancel until the order is packed; support and admin until it ships. The card hold is released ' +
          '(nothing was charged), the stock and any coupon use are given back.',
        security,
        params: z.object({ id: Id }),
        body: CancelOrder,
        response: { 200: Order, 400: Problem, 401: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireUser(req);
      await orders.cancel(req.params.id, user, req.body.reason, req.body.note, req.now);
      return orders.view(req.params.id, user, req.now);
    },
  );

  // ---------- staff ----------

  app.get(
    '/staff/orders',
    {
      preValidation: needsUser,
      schema: {
        tags: staffTags,
        summary: 'All orders (staff)',
        security,
        querystring: listQuery.extend({ status: z.enum(ORDER_STATUSES).optional() }),
        response: { 200: StaffOrderList, 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'support', 'warehouse', 'admin');
      return orders.list({ status: req.query.status }, req.query.cursor ?? null, req.query.limit);
    },
  );

  app.get(
    '/staff/orders/:id',
    {
      preValidation: needsUser,
      schema: { tags: staffTags, summary: 'One order (staff)', security, params: z.object({ id: Id }), response: { 200: Order, 401: Problem, 403: Problem, 404: Problem } },
    },
    async (req) => orders.view(req.params.id, requireRole(req, 'support', 'warehouse', 'admin'), req.now),
  );

  const step = (path: 'pack' | 'deliver', summary: string) =>
    app.post(
      `/staff/orders/:id/${path}`,
      {
        preValidation: needsUser,
      schema: { tags: staffTags, summary, security, params: z.object({ id: Id }), response: { 200: Order, 401: Problem, 403: Problem, 404: Problem, 409: Problem } },
      },
      async (req) => {
        const user = requireRole(req, 'warehouse', 'admin');
        await orders[path](req.params.id, user, req.now);
        return orders.view(req.params.id, user, req.now);
      },
    );
  step('pack', 'Mark an order packed (warehouse)');
  step('deliver', 'Mark an order delivered (warehouse)');

  app.post(
    '/staff/orders/:id/ship',
    {
      preValidation: needsUser,
      schema: {
        tags: staffTags,
        summary: 'Ship an order and charge the card (warehouse)',
        security,
        params: z.object({ id: Id }),
        body: ShipOrder,
        response: { 200: Order, 400: Problem, 401: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req) => {
      const user = requireRole(req, 'warehouse', 'admin');
      await orders.ship(req.params.id, user, req.body.trackingNumber, req.now);
      return orders.view(req.params.id, user, req.now);
    },
  );
};
