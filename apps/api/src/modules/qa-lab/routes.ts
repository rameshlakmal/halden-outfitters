// The QA lab: tools that a real shop wouldn't have, for testing this one.
//   - Fake inbox: every email the shop "sends". Anyone can read the mail of an address at a reserved test domain
//     (RFC 2606: *.test, *.example, *.invalid, *.localhost, example.com/net/org), so testers can follow confirmation
//     and reset links. Other addresses (someone's real email) are readable only by their signed-in owner. Mail to
//     the seeded demo accounts and to staff is only shown to admins: otherwise anyone could reset their passwords.
//   - Shop clock: admins can move business time forward to test expiry rules.
//   - Fixtures: admins can make a ready-to-use test account in one call, so a test sets up its own data.
import { Clock, Email, InboxEmail, Problem, SetClock, ShopperFixture, ShopperFixtureInput } from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createSession, requireRole } from '../../core/auth.js';
import { audit } from '../../core/audit.js';
import { hashPassword } from '../../core/crypto.js';
import { AppError } from '../../core/errors.js';
import { AccountService, toMe, type CustomerRow } from '../accounts/service.js';
import { cartRepo } from '../cart/repository.js';
import { CartService, toCart } from '../cart/service.js';
import { addCredit, creditBalance } from '../loyalty/store-credit.js';
import { OrderService } from '../orders/service.js';
import { ReturnService } from '../returns/service.js';
import { balance, expire, giveBack } from '../loyalty/points.js';

type OutboxRow = {
  id: string;
  to_email: string;
  template: string;
  subject: string;
  body_text: string;
  created_at: Date;
};

const LINK = /https?:\/\/[^\s]+/g;
const TEST_DOMAIN = /@(?:[^@]+\.)?(?:[^@.]+\.(?:test|example|invalid|localhost)|example\.(?:com|net|org))$/;

const toEmail = (r: OutboxRow): InboxEmail => ({
  id: r.id,
  to: r.to_email,
  template: r.template,
  subject: r.subject,
  body: r.body_text,
  links: r.body_text.match(LINK) ?? [],
  createdAt: r.created_at.toISOString(),
});

export const qaRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, clock, config } = app.ctx;
  const tags = ['QA lab'];

  const enabled = () => {
    if (!config.QA_LAB_ENABLED) throw new AppError('qa_lab_disabled', 'The QA lab is switched off on this server.');
  };
  const canRead = async (req: FastifyRequest, email: string) => {
    if (req.user?.role === 'admin') return true;
    if (req.user?.email === email) return true;
    if (!TEST_DOMAIN.test(email)) return false;
    const guarded = await db.one("SELECT 1 FROM customers WHERE email = $1 AND (is_demo OR role <> 'customer')", [
      email,
    ]);
    return !guarded;
  };

  app.get(
    '/qa/inbox',
    {
      schema: {
        tags,
        summary: 'Emails sent to an address, newest first',
        description: 'Mail to the seeded demo accounts is only shown to admins.',
        querystring: z.object({ email: Email, limit: z.coerce.number().int().min(1).max(50).default(20) }),
        response: { 200: z.object({ items: z.array(InboxEmail) }), 400: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      if (!(await canRead(req, req.query.email))) return { items: [] };
      const rows = await db.query<OutboxRow>(
        `SELECT id, to_email, template, subject, body_text, created_at FROM outbox
          WHERE to_email = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [req.query.email, req.query.limit],
      );
      return { items: rows.map(toEmail) };
    },
  );

  app.get(
    '/qa/clock',
    { schema: { tags, summary: 'The shop clock', response: { 200: Clock, 404: Problem } } },
    async (req) => {
      enabled();
      return { now: req.now.toISOString(), offsetSeconds: await clock.offsetSeconds() };
    },
  );

  app.put(
    '/qa/clock',
    {
      schema: {
        tags,
        summary: 'Move the shop clock (admin)',
        description: 'Sets how far ahead of real time the shop runs. 0 puts it back to real time.',
        security: [{ session: [] }, { bearer: [] }],
        body: SetClock,
        response: { 200: Clock, 400: Problem, 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      const user = requireRole(req, 'admin');
      const before = await clock.offsetSeconds();
      await db.tx(async (tx) => {
        await clock.setOffsetSeconds(req.body.offsetSeconds, tx);
        await audit(
          tx,
          user,
          'qa.clock',
          { type: 'setting', id: 'clock_offset_seconds' },
          { before, after: req.body.offsetSeconds },
        );
      });
      return { now: (await clock.now()).toISOString(), offsetSeconds: req.body.offsetSeconds };
    },
  );

  // ---------- planted bugs ----------

  const Bug = z.object({
    key: z.string(),
    phase: z.number().int(),
    title: z.string(),
    description: z.string(),
    howToSee: z.string(),
    rule: z.string(),
    enabled: z.boolean(),
  });

  app.get(
    '/qa/bugs',
    {
      schema: {
        tags,
        summary: 'Planted bugs and whether each is on',
        response: { 200: z.object({ items: z.array(Bug) }), 404: Problem },
      },
    },
    async () => {
      enabled();
      const rows = await db.query<{
        key: string;
        phase: number;
        title: string;
        description: string;
        how_to_see: string;
        rule: string;
        enabled: boolean;
      }>('SELECT key, phase, title, description, how_to_see, rule, enabled FROM qa_bugs ORDER BY position');
      return {
        items: rows.map((r) => ({
          key: r.key,
          phase: r.phase,
          title: r.title,
          description: r.description,
          howToSee: r.how_to_see,
          rule: r.rule,
          enabled: r.enabled,
        })),
      };
    },
  );

  app.put(
    '/qa/bugs/:key',
    {
      schema: {
        tags,
        summary: 'Switch a planted bug on or off (admin)',
        security: [{ session: [] }, { bearer: [] }],
        params: z.object({ key: z.string().regex(/^[a-z_]+$/) }),
        body: z.object({ enabled: z.boolean() }),
        response: { 200: Bug, 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      const user = requireRole(req, 'admin');
      const row = await db.tx(async (tx) => {
        const { rows } = await tx.query<{
          key: string;
          phase: number;
          title: string;
          description: string;
          how_to_see: string;
          rule: string;
          enabled: boolean;
        }>(
          'UPDATE qa_bugs SET enabled = $2 WHERE key = $1 RETURNING key, phase, title, description, how_to_see, rule, enabled',
          [req.params.key, req.body.enabled],
        );
        const r = rows[0];
        if (!r) throw new AppError('not_found', 'No planted bug with that key.');
        await audit(tx, user, req.body.enabled ? 'qa.bug_on' : 'qa.bug_off', { type: 'qa_bug', id: r.key });
        return r;
      });
      app.ctx.bugs.forget();
      return {
        key: row.key,
        phase: row.phase,
        title: row.title,
        description: row.description,
        howToSee: row.how_to_see,
        rule: row.rule,
        enabled: row.enabled,
      };
    },
  );

  // ---------- sweeps and webhooks ----------

  const Sweep = z.object({
    expired: z.number().int(),
    completed: z.number().int(),
    returnsExpired: z.number().int(),
    pointsExpired: z.number().int(),
    webhooksDelivered: z.number().int(),
  });
  const orders = new OrderService(app.ctx);
  const returns = new ReturnService(app.ctx);
  const runSweep = async (now: Date) => {
    const returnsExpired = await returns.sweep(now);
    const result = await orders.sweep(now);
    const pointsExpired = await app.ctx.db.tx((tx) => expire(tx, now));
    return { ...result, returnsExpired, pointsExpired, webhooksDelivered: await app.ctx.deliverWebhooks() };
  };

  app.post(
    '/qa/sweeps',
    {
      schema: {
        tags,
        summary: 'Run the time-based rules now (admin)',
        description:
          'Cancels unpaid orders past their 30 minutes, expires unused return labels, completes orders past their return window, expires 12-month-old points, delivers queued webhooks.',
        security: [{ session: [] }, { bearer: [] }],
        response: { 200: Sweep, 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      const user = requireRole(req, 'admin');
      const result = await runSweep(req.now);
      await audit(db.pool, user, 'qa.sweep', { type: 'setting', id: 'sweep' }, { after: result });
      return result;
    },
  );

  const WebhookEvent = z.object({
    id: z.string(),
    type: z.string(),
    orderId: z.string().nullable(),
    payload: z.unknown(),
    attempts: z.number().int(),
    createdAt: z.string(),
    deliveredAt: z.string().nullable(),
    processed: z.boolean().describe('The shop has recorded this event id'),
  });

  app.get(
    '/qa/webhooks',
    {
      schema: {
        tags,
        summary: 'Payment webhook events, newest first (admin)',
        security: [{ session: [] }, { bearer: [] }],
        querystring: z.object({ orderId: z.string().regex(/^\d+$/).optional() }),
        response: { 200: z.object({ items: z.array(WebhookEvent) }), 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      requireRole(req, 'admin');
      const rows = await db.query<{
        id: string;
        type: string;
        order_id: string | null;
        payload: unknown;
        attempts: number;
        created_at: Date;
        delivered_at: Date | null;
        processed: boolean;
      }>(
        `SELECT e.id, e.type, i.merchant_ref AS order_id, e.payload, e.attempts, e.created_at, e.delivered_at,
                EXISTS (SELECT 1 FROM webhook_events w WHERE w.id = e.id) AS processed
           FROM haldenpay.events e JOIN haldenpay.intents i ON i.id = e.intent_id
          WHERE ($1::text IS NULL OR i.merchant_ref = $1)
          ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
        [req.query.orderId ?? null],
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          type: r.type,
          orderId: r.order_id,
          payload: r.payload,
          attempts: r.attempts,
          createdAt: r.created_at.toISOString(),
          deliveredAt: r.delivered_at?.toISOString() ?? null,
          processed: r.processed,
        })),
      };
    },
  );

  app.post(
    '/qa/webhooks/:id/redeliver',
    {
      schema: {
        tags,
        summary: 'Send a payment webhook again (admin)',
        description: 'For testing that a repeated delivery changes nothing.',
        security: [{ session: [] }, { bearer: [] }],
        params: z.object({ id: z.string().regex(/^evt_[A-Za-z0-9_-]+$/) }),
        response: { 200: z.object({ delivered: z.number().int() }), 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      const user = requireRole(req, 'admin');
      const rows = await db.query(
        'UPDATE haldenpay.events SET delivered_at = NULL, deliver_after = now() WHERE id = $1 RETURNING id',
        [req.params.id],
      );
      if (rows.length === 0) throw new AppError('not_found', 'No webhook event with that id.');
      await audit(db.pool, user, 'qa.webhook_redeliver', { type: 'webhook_event', id: req.params.id });
      return { delivered: await app.ctx.deliverWebhooks() };
    },
  );

  // Vercel Cron calls this once a day with the CRON_SECRET as a bearer token.
  // ---------- fixtures ----------

  const accounts = new AccountService(app.ctx, new CartService(db));

  app.post(
    '/qa/fixtures/shopper',
    {
      schema: {
        tags,
        summary: 'Make a ready-to-use test account (admin)',
        description:
          'Creates an account at a new `@fixtures.test` address and signs it in, in one step: confirmed email, a ' +
          'default address, a filled cart, store credit and points as asked. Send `{}` for the defaults. The ' +
          'answer holds the generated password and a Bearer token for the new account.',
        security: [{ session: [] }, { bearer: [] }],
        body: ShopperFixtureInput,
        response: { 201: ShopperFixture, 400: Problem, 401: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
    },
    async (req, reply) => {
      enabled();
      const admin = requireRole(req, 'admin');
      const input = req.body;
      const now = req.now;
      const tag = randomBytes(5).toString('hex');
      const email = `${input.role === 'customer' ? 'shopper' : input.role}-${tag}@fixtures.test`;
      const password = `fixture-${randomBytes(12).toString('base64url')}`;
      const passwordHash = await hashPassword(password);

      const made = await db.tx(async (tx) => {
        const { rows } = await tx.query<CustomerRow>(
          `INSERT INTO customers (email, name, password_hash, role, email_verified_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING id, name, email, role, password_hash, email_verified_at, failed_logins, locked_until, created_at`,
          [email, input.name, passwordHash, input.role, input.emailVerified ? now : null, now],
        );
        const customer = rows[0]!;
        if (input.address) {
          await tx.query(
            `INSERT INTO addresses (customer_id, label, name, line1, city, region, postcode, country_code, is_default, created_at, updated_at)
             VALUES ($1, 'Home', $2, '14 Larch Street', 'Portland', 'OR', '97205', 'US', true, $3, $3)`,
            [customer.id, input.name, now],
          );
        }
        const cartId = await cartRepo.ensureForCustomer(tx, customer.id);
        for (const line of input.cart) {
          const found = await tx.query<{ id: string }>('SELECT id FROM products WHERE slug = $1', [line.slug]);
          const productId = found.rows[0]?.id;
          const product = productId ? await cartRepo.product(tx, productId) : undefined;
          if (!productId || !product?.active) {
            throw new AppError('product_unavailable', `There is no product on sale with the slug ${line.slug}.`);
          }
          const qty = (await cartRepo.lineQty(tx, cartId, productId)) + line.qty;
          if (qty > product.available) {
            throw new AppError('not_enough_stock', `Only ${product.available} ${product.name} left.`);
          }
          await cartRepo.setQty(tx, cartId, productId, qty);
        }
        const note = 'QA fixture';
        await addCredit(tx, customer.id, input.storeCredit, 'adjustment', { actorId: admin.id, note }, now);
        await giveBack(tx, customer.id, input.points, 'adjustment', { actorId: admin.id, note }, now);
        const accessToken = await createSession(tx, customer.id, req, now);
        await audit(tx, admin, 'qa.fixture', { type: 'customer', id: customer.id }, { after: input }, now);
        return { customer, cart: toCart(await cartRepo.lines(tx, cartId)), accessToken };
      });

      const id = made.customer.id;
      return reply.status(201).send({
        customer: toMe(made.customer),
        password,
        accessToken: made.accessToken,
        address: (await accounts.addresses(id))[0] ?? null,
        cart: made.cart,
        storeCredit: await creditBalance(db.pool, id),
        points: (await balance(db.pool, id, now)).available,
      });
    },
  );

  app.get('/internal/cron/sweep', { schema: { hide: true } }, async (req) => {
    const secret = app.ctx.config.CRON_SECRET;
    const given = Buffer.from(String(req.headers.authorization ?? ''));
    const expected = Buffer.from(`Bearer ${secret}`);
    // Constant-time, so the secret can't be guessed one character at a time from response times.
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new AppError('forbidden', 'Not allowed.');
    return runSweep(req.now);
  });
};
