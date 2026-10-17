import { Authenticate, CheckoutInput, CheckoutResult, Problem, Quote, QuoteInput, TokenBody } from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { needsUser, requireUser } from '../../core/auth.js';
import { withIdempotency } from '../../core/idempotency.js';
import { CheckoutService } from './service.js';

const security = [{ session: [] }];

export const checkoutRoutes: FastifyPluginAsyncZod = async (app) => {
  const checkout = new CheckoutService(app.ctx);
  const tags = ['Checkout'];

  app.post(
    '/checkout/quote',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Price the cart for an address and delivery option',
        description: 'Shipping depends on the zone of the address. Nothing is placed or held.',
        security,
        body: QuoteInput,
        response: { 200: Quote, 400: Problem, 401: Problem, 409: Problem },
      },
    },
    async (req) => {
      const q = await checkout.quote(requireUser(req), req.body, req.now);
      return {
        zone: q.zone,
        shippingOptions: q.shippingOptions,
        shippingMethod: q.shippingMethod,
        coupon: q.coupon,
        totals: q.totals,
        toFreeShipping: q.toFreeShipping,
        points: q.points,
        storeCredit: q.storeCredit,
      };
    },
  );

  app.post(
    '/checkout',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Place the order and authorize the card',
        description:
          'Needs an `Idempotency-Key` header: repeating the key with the same body returns the first result, so a ' +
          'double-click places one order. 201: confirmed. 202: the card needs the bank step (`nextAction.url`). ' +
          '402: declined. Test cards: 4242 4242 4242 4242 (success), 4000 0000 0000 0002 (declined), ' +
          '4000 0000 0000 9995 (insufficient funds), 4000 0000 0000 3220 (bank step), 4000 0000 0000 0259 (dispute later).',
        security,
        headers: z.object({ 'idempotency-key': z.string().optional() }),
        body: CheckoutInput,
        response: { 201: CheckoutResult, 202: CheckoutResult, 400: Problem, 401: Problem, 402: Problem, 403: Problem, 409: Problem, 422: Problem },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      return withIdempotency(app.ctx.db, req, reply, user.id, async () => {
        const result = await checkout.place(user, req.body, req.now);
        return { status: result.nextAction ? 202 : 201, body: result };
      });
    },
  );

  app.post(
    '/payments/authenticate',
    {
      schema: {
        tags,
        summary: 'Answer the bank step (HaldenPay test bank)',
        description: 'The page the bank step links to calls this with the token from the link.',
        body: TokenBody.extend(Authenticate.shape),
        response: { 200: z.object({ orderId: z.string(), status: z.string() }), 400: Problem, 410: Problem },
      },
    },
    async (req) => checkout.authenticate(req.body.token, req.body.approve),
  );
};
