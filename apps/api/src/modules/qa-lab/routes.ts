// The QA lab: tools that a real shop wouldn't have, for testing this one.
//   - Fake inbox: every email the shop "sends". Anyone can read the mail of an address they type in, so testers
//     can follow confirmation and reset links, except mail to the seeded demo accounts, which only an admin can
//     read (otherwise anyone could reset a demo account's password).
//   - Shop clock: admins can move business time forward to test expiry rules.
import { Clock, Email, InboxEmail, Problem, SetClock } from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../../core/auth.js';
import { AppError } from '../../core/errors.js';
import { OrderService } from '../orders/service.js';
import { ReturnService } from '../returns/service.js';
import { expire } from '../loyalty/points.js';

type OutboxRow = { id: string; to_email: string; template: string; subject: string; body_text: string; created_at: Date };

const LINK = /https?:\/\/[^\s]+/g;

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
    const demo = await db.one('SELECT 1 FROM customers WHERE email = $1 AND is_demo', [email]);
    return !demo;
  };

  app.get(
    '/qa/inbox',
    {
      schema: {
        tags,
        summary: 'Emails sent to an address, newest first',
        description: "Mail to the seeded demo accounts is only shown to admins.",
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
        security: [{ session: [] }],
        body: SetClock,
        response: { 200: Clock, 400: Problem, 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      requireRole(req, 'admin');
      await clock.setOffsetSeconds(req.body.offsetSeconds);
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
    { schema: { tags, summary: 'Planted bugs and whether each is on', response: { 200: z.object({ items: z.array(Bug) }), 404: Problem } } },
    async () => {
      enabled();
      const rows = await db.query<{ key: string; phase: number; title: string; description: string; how_to_see: string; rule: string; enabled: boolean }>(
        'SELECT key, phase, title, description, how_to_see, rule, enabled FROM qa_bugs ORDER BY position',
      );
      return { items: rows.map((r) => ({ key: r.key, phase: r.phase, title: r.title, description: r.description, howToSee: r.how_to_see, rule: r.rule, enabled: r.enabled })) };
    },
  );

  app.put(
    '/qa/bugs/:key',
    {
      schema: {
        tags,
        summary: 'Switch a planted bug on or off (admin)',
        security: [{ session: [] }],
        params: z.object({ key: z.string().regex(/^[a-z_]+$/) }),
        body: z.object({ enabled: z.boolean() }),
        response: { 200: Bug, 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      requireRole(req, 'admin');
      const row = await db.one<{ key: string; phase: number; title: string; description: string; how_to_see: string; rule: string; enabled: boolean }>(
        'UPDATE qa_bugs SET enabled = $2 WHERE key = $1 RETURNING key, phase, title, description, how_to_see, rule, enabled',
        [req.params.key, req.body.enabled],
      );
      if (!row) throw new AppError('not_found', 'No planted bug with that key.');
      app.ctx.bugs.forget();
      return { key: row.key, phase: row.phase, title: row.title, description: row.description, howToSee: row.how_to_see, rule: row.rule, enabled: row.enabled };
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
        description: 'Cancels unpaid orders past their 30 minutes, expires unused return labels, completes orders past their return window, expires 12-month-old points, delivers queued webhooks.',
        security: [{ session: [] }],
        response: { 200: Sweep, 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      requireRole(req, 'admin');
      return runSweep(req.now);
    },
  );

  app.post(
    '/qa/webhooks/:id/redeliver',
    {
      schema: {
        tags,
        summary: 'Send a payment webhook again (admin)',
        description: 'For testing that a repeated delivery changes nothing.',
        security: [{ session: [] }],
        params: z.object({ id: z.string().regex(/^evt_[A-Za-z0-9_-]+$/) }),
        response: { 200: z.object({ delivered: z.number().int() }), 401: Problem, 403: Problem, 404: Problem },
      },
    },
    async (req) => {
      enabled();
      requireRole(req, 'admin');
      const rows = await db.query("UPDATE haldenpay.events SET delivered_at = NULL, deliver_after = now() WHERE id = $1 RETURNING id", [req.params.id]);
      if (rows.length === 0) throw new AppError('not_found', 'No webhook event with that id.');
      return { delivered: await app.ctx.deliverWebhooks() };
    },
  );

  // Vercel Cron calls this once a day with the CRON_SECRET as a bearer token.
  app.get('/internal/cron/sweep', { schema: { hide: true } }, async (req) => {
    const secret = app.ctx.config.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw new AppError('forbidden', 'Not allowed.');
    return runSweep(req.now);
  });
};
