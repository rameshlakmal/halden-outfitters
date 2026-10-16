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
};
