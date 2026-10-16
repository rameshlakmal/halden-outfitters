import { AddToCart, Cart, Id, Problem, SetQty } from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CART_COOKIE } from '../../core/auth.js';
import { CartService, type CartOwner } from './service.js';

const GUEST_CART_DAYS = 30;

const owner = (req: FastifyRequest): CartOwner => ({
  customerId: req.user?.id ?? null,
  guestCartId: req.cookies[CART_COOKIE],
});

export const cartRoutes: FastifyPluginAsyncZod = async (app) => {
  const carts = new CartService(app.ctx.db);
  const tags = ['Cart'];
  const errors = { 400: Problem, 404: Problem, 409: Problem };

  app.get('/cart', { schema: { tags, summary: 'The current cart', response: { 200: Cart } } }, async (req) =>
    carts.view(owner(req)),
  );

  app.post(
    '/cart/items',
    {
      schema: {
        tags,
        summary: 'Add a product to the cart',
        description: 'Adds to the quantity already in the cart. Signed out, the cart is kept in a cookie for 30 days.',
        body: AddToCart,
        response: { 200: Cart, ...errors },
      },
    },
    async (req, reply) => {
      const { cart, newGuestCartId } = await carts.add(owner(req), req.body.productId, req.body.qty);
      if (newGuestCartId) {
        reply.setCookie(CART_COOKIE, newGuestCartId, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: app.ctx.config.secureCookies,
          maxAge: GUEST_CART_DAYS * 86400,
        });
      }
      return cart;
    },
  );

  app.patch(
    '/cart/items/:productId',
    {
      schema: {
        tags,
        summary: 'Change the quantity of a line',
        params: z.object({ productId: Id }),
        body: SetQty,
        response: { 200: Cart, ...errors },
      },
    },
    async (req) => carts.setQty(owner(req), req.params.productId, req.body.qty),
  );

  app.delete(
    '/cart/items/:productId',
    {
      schema: {
        tags,
        summary: 'Remove a line',
        params: z.object({ productId: Id }),
        response: { 200: Cart, 404: Problem },
      },
    },
    async (req) => carts.remove(owner(req), req.params.productId),
  );

  app.delete('/cart', { schema: { tags, summary: 'Empty the cart', response: { 200: Cart } } }, async (req) =>
    carts.clear(owner(req)),
  );
};
