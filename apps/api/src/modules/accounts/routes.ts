import {
  ActiveSession,
  Address,
  AddressInput,
  ChangePassword,
  Country,
  ForgotPassword,
  Id,
  Login,
  Me,
  Ok,
  Problem,
  Register,
  ResetPassword,
  Session,
  TokenBody,
  UpdateProfile,
} from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CART_COOKIE, clearCookie, requireUser, SESSION_COOKIE, setSessionCookie } from '../../core/auth.js';
import { CartService } from '../cart/service.js';
import { AccountService, userToMe } from './service.js';

const ok = { ok: true as const };
const security = [{ session: [] }];

export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  const { config } = app.ctx;
  const accounts = new AccountService(app.ctx, new CartService(app.ctx.db));
  const auth = ['Auth'];
  const account = ['Account'];

  // ---------- auth ----------

  app.get(
    '/auth/session',
    {
      schema: {
        tags: auth,
        summary: 'Who is signed in',
        description: 'Always 200: `customer` is null when signed out.',
        response: { 200: Session },
      },
    },
    async (req) => ({ customer: req.user ? userToMe(req.user) : null }),
  );

  app.post(
    '/auth/register',
    {
      schema: {
        tags: auth,
        summary: 'Create an account and sign in',
        description: 'Sends a confirmation email. A browser cart is merged into the new account.',
        body: Register,
        response: { 201: z.object({ customer: Me }), 400: Problem, 409: Problem, 429: Problem },
      },
    },
    async (req, reply) => {
      const { me, sessionToken } = await accounts.register(req, req.body);
      setSessionCookie(reply, sessionToken, config.secureCookies);
      clearCookie(reply, CART_COOKIE, config.secureCookies);
      return reply.status(201).send({ customer: me });
    },
  );

  app.post(
    '/auth/login',
    {
      schema: {
        tags: auth,
        summary: 'Sign in',
        description:
          'Five wrong passwords in a row pause sign-in for 15 minutes (423 account_locked, with Retry-After). ' +
          'A browser cart is merged into the account.',
        body: Login,
        response: { 200: z.object({ customer: Me }), 400: Problem, 401: Problem, 423: Problem, 429: Problem },
      },
    },
    async (req, reply) => {
      const { me, sessionToken } = await accounts.login(req, req.body.email, req.body.password);
      setSessionCookie(reply, sessionToken, config.secureCookies);
      clearCookie(reply, CART_COOKIE, config.secureCookies);
      return { customer: me };
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags: auth, summary: 'Sign out this device', response: { 200: Ok } } },
    async (req, reply) => {
      if (req.user) await accounts.logout(req.user.sessionId, req.now);
      clearCookie(reply, SESSION_COOKIE, config.secureCookies);
      return ok;
    },
  );

  app.post(
    '/auth/verify-email',
    {
      schema: {
        tags: auth,
        summary: 'Confirm an email address with the link token',
        body: TokenBody,
        response: { 200: Ok, 400: Problem, 410: Problem },
      },
    },
    async (req) => {
      await accounts.verifyEmail(req.body.token, req.now);
      return ok;
    },
  );

  app.post(
    '/auth/verify-email/resend',
    {
      schema: {
        tags: auth,
        summary: 'Send a new confirmation link',
        security,
        response: { 200: Ok, 401: Problem, 409: Problem, 429: Problem },
      },
    },
    async (req) => {
      await accounts.resendVerification(requireUser(req), req.now);
      return ok;
    },
  );

  app.post(
    '/auth/forgot-password',
    {
      schema: {
        tags: auth,
        summary: 'Email a password-reset link',
        description: 'Answers 202 whether or not the email has an account, so it reveals nothing.',
        body: ForgotPassword,
        response: { 202: Ok, 400: Problem, 429: Problem },
      },
    },
    async (req, reply) => {
      await accounts.forgotPassword(req, req.body.email);
      return reply.status(202).send(ok);
    },
  );

  app.post(
    '/auth/reset-password',
    {
      schema: {
        tags: auth,
        summary: 'Set a new password with the link token',
        description: 'Signs out every device. Sign in again with the new password.',
        body: ResetPassword,
        response: { 200: Ok, 400: Problem, 410: Problem },
      },
    },
    async (req, reply) => {
      await accounts.resetPassword(req.body.token, req.body.password, req.now);
      clearCookie(reply, SESSION_COOKIE, config.secureCookies);
      return ok;
    },
  );

  // ---------- account ----------

  app.patch(
    '/account/profile',
    {
      schema: {
        tags: account,
        summary: 'Change your name',
        security,
        body: UpdateProfile,
        response: { 200: Me, 400: Problem, 401: Problem },
      },
    },
    async (req) => accounts.updateProfile(requireUser(req), req.body.name, req.now),
  );

  app.post(
    '/account/password',
    {
      schema: {
        tags: account,
        summary: 'Change your password',
        description: 'Needs the current password. Every other device is signed out.',
        security,
        body: ChangePassword,
        response: { 200: Ok, 400: Problem, 401: Problem },
      },
    },
    async (req) => {
      await accounts.changePassword(requireUser(req), req.body.currentPassword, req.body.newPassword, req.now);
      return ok;
    },
  );

  app.get(
    '/account/sessions',
    {
      schema: {
        tags: account,
        summary: 'Devices signed in to your account',
        security,
        response: { 200: z.object({ items: z.array(ActiveSession) }), 401: Problem },
      },
    },
    async (req) => ({ items: await accounts.sessions(requireUser(req), req.now) }),
  );

  app.delete(
    '/account/sessions/:id',
    {
      schema: {
        tags: account,
        summary: 'Sign out one device',
        security,
        params: z.object({ id: z.uuid() }),
        response: { 200: Ok, 401: Problem, 404: Problem },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      await accounts.revokeSession(user, req.params.id, req.now);
      if (req.params.id === user.sessionId) clearCookie(reply, SESSION_COOKIE, config.secureCookies);
      return ok;
    },
  );

  app.post(
    '/account/sessions/revoke-others',
    {
      schema: {
        tags: account,
        summary: 'Sign out every other device',
        security,
        response: { 200: z.object({ revoked: z.number().int() }), 401: Problem },
      },
    },
    async (req) => ({ revoked: await accounts.revokeOtherSessions(requireUser(req), req.now) }),
  );

  // ---------- addresses ----------

  const AddressList = z.object({ items: z.array(Address) });

  app.get(
    '/account/addresses',
    { schema: { tags: account, summary: 'Your address book', security, response: { 200: AddressList, 401: Problem } } },
    async (req) => ({ items: await accounts.addresses(requireUser(req).id) }),
  );

  app.post(
    '/account/addresses',
    {
      schema: {
        tags: account,
        summary: 'Add an address',
        description: 'Up to 5. The first address becomes the default.',
        security,
        body: AddressInput,
        response: { 201: AddressList, 400: Problem, 401: Problem, 409: Problem },
      },
    },
    async (req, reply) =>
      reply.status(201).send({ items: await accounts.addAddress(requireUser(req).id, req.body, req.now) }),
  );

  app.put(
    '/account/addresses/:id',
    {
      schema: {
        tags: account,
        summary: 'Replace an address',
        security,
        params: z.object({ id: Id }),
        body: AddressInput,
        response: { 200: AddressList, 400: Problem, 401: Problem, 404: Problem },
      },
    },
    async (req) => ({ items: await accounts.updateAddress(requireUser(req).id, req.params.id, req.body, req.now) }),
  );

  app.post(
    '/account/addresses/:id/default',
    {
      schema: {
        tags: account,
        summary: 'Make an address the default',
        security,
        params: z.object({ id: Id }),
        response: { 200: AddressList, 401: Problem, 404: Problem },
      },
    },
    async (req) => ({ items: await accounts.setDefaultAddress(requireUser(req).id, req.params.id) }),
  );

  app.delete(
    '/account/addresses/:id',
    {
      schema: {
        tags: account,
        summary: 'Remove an address',
        description: 'When the default is removed, the newest remaining address becomes the default.',
        security,
        params: z.object({ id: Id }),
        response: { 200: AddressList, 401: Problem, 404: Problem },
      },
    },
    async (req) => ({ items: await accounts.deleteAddress(requireUser(req).id, req.params.id) }),
  );

  app.get(
    '/countries',
    {
      schema: {
        tags: account,
        summary: 'Countries we ship to',
        response: { 200: z.object({ items: z.array(Country) }) },
      },
    },
    async () => ({ items: await accounts.countries() }),
  );
};
