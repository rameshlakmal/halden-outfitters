import { AddToCart, ApplyCoupon, Cart, Id, Problem, SetQty } from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CART_COOKIE } from '../../core/auth.js';
import { LIMITS } from '../../core/rate-limit.js';
import { CartCoupons } from './coupon.js';
import { CartService, type CartOwner } from './service.js';

const GUEST_CART_DAYS = 30;

const owner = (req: FastifyRequest): CartOwner => ({
  customerId: req.user?.id ?? null,
  guestCartId: req.cookies[CART_COOKIE],
});

export const cartRoutes: FastifyPluginAsyncZod = async (app) => {
  const carts = new CartService(app.ctx.db);
  const coupons = new CartCoupons(app.ctx.db, app.ctx.bugs);
  const tags = ['Cart'];
  const errors = { 400: Problem, 404: Problem, 409: Problem };

  /** Every cart response also says whether its coupon can be used now, and what it takes off. */
  const finish = async (req: FastifyRequest, cart: Cart, cartId?: string | null) => {
    const id = cartId === undefined ? await carts.find(owner(req)) : cartId;
    return coupons.decorate(cart, id, req.user?.id ?? null, req.now);
  };
  const setGuestCookie = (reply: FastifyReply, id: string) =>
    reply.setCookie(CART_COOKIE, id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: app.ctx.config.secureCookies,
      maxAge: GUEST_CART_DAYS * 86400,
    });

  app.get('/cart', { schema: { tags, summary: 'The current cart', response: { 200: Cart } } }, async (req) =>
    finish(req, await carts.view(owner(req))),
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
      if (newGuestCartId) setGuestCookie(reply, newGuestCartId);
      return finish(req, cart, newGuestCartId ?? undefined);
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
    async (req) => finish(req, await carts.setQty(owner(req), req.params.productId, req.body.qty)),
  );

  app.delete(
    '/cart/items/:productId',
    {
      schema: { tags, summary: 'Remove a line', params: z.object({ productId: Id }), response: { 200: Cart, 404: Problem } },
    },
    async (req) => finish(req, await carts.remove(owner(req), req.params.productId)),
  );

  app.delete('/cart', { schema: { tags, summary: 'Empty the cart', response: { 200: Cart } } }, async (req) =>
    finish(req, await carts.clear(owner(req))),
  );

  app.post(
    '/cart/coupon',
    {
      schema: {
        tags,
        summary: 'Apply a coupon code',
        description:
          'Checked against the cart straight away: dates, minimum spend on eligible items, use limits, first-order-only. ' +
          'Sale items and some categories do not count towards a coupon.',
        body: ApplyCoupon,
        response: { 200: Cart, 400: Problem, 409: Problem },
      },
    },
    async (req, reply) => {
      // Slows down guessing codes: each answer says whether a code exists.
      await app.ctx.limiter.hit(LIMITS.couponPerIp, req.ip);
      const o = owner(req);
      let id = await carts.find(o);
      if (!id) {
        const created = await carts.ensure(o);
        id = created.id;
        if (created.newGuestCartId) setGuestCookie(reply, created.newGuestCartId);
      }
      await coupons.apply(id, req.body.code, o.customerId, req.now);
      return finish(req, await carts.view(o.customerId ? o : { ...o, guestCartId: id }), id);
    },
  );

  app.delete('/cart/coupon', { schema: { tags, summary: 'Remove the coupon', response: { 200: Cart } } }, async (req) => {
    const id = await carts.find(owner(req));
    if (id) await coupons.remove(id);
    return finish(req, await carts.view(owner(req)), id);
  });
};
