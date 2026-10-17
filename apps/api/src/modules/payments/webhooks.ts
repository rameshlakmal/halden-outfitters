// HaldenPay webhooks. The provider signs each event: header `HaldenPay-Signature: t=<unix>,v1=<hex>` where v1
// is HMAC-SHA256(secret, `${t}.${raw body}`). The shop checks the signature (over the exact raw bytes), refuses
// timestamps more than 5 minutes off, and records each event id so a repeated delivery changes nothing.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../../core/context.js';
import { AppError } from '../../core/errors.js';
import { queueEmail } from '../../core/outbox.js';
import { OrderService } from '../orders/service.js';

const TOLERANCE_SECONDS = 300;

export const signPayload = (secret: string, timestamp: number, body: string) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

export function verifySignature(secret: string, header: string | undefined, body: string, nowSeconds: number): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowSeconds - t) > TOLERANCE_SECONDS || !parts.v1) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type Event = { id: string; type: string; payload: { intentId: string; amount?: string; code?: string } };

/**
 * What the shop does with one provider event, once its signature is trusted. Each event id is recorded, so a
 * repeated delivery changes nothing.
 */
export async function processEvent(
  ctx: AppContext,
  orders: OrderService,
  event: Event,
): Promise<'processed' | 'duplicate' | 'unknown_payment'> {
  return ctx.db.tx(async (tx) => {
    const { rowCount } = await tx.query(
      'INSERT INTO webhook_events (id, provider, type, payload) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [event.id, 'haldenpay', event.type, JSON.stringify(event.payload)],
    );
    if (rowCount === 0) return 'duplicate';
    const { rows } = await tx.query<{ order_id: string }>('SELECT order_id FROM payments WHERE intent_id = $1', [
      event.payload.intentId,
    ]);
    const orderId = rows[0]?.order_id;
    if (!orderId) return 'unknown_payment';
    const now = await ctx.clock.now();
    switch (event.type) {
      case 'payment.authorized':
        await orders.confirm(tx, orderId, now);
        break;
      case 'payment.failed':
        await orders.failPayment(tx, orderId, event.payload.code ?? 'failed', now);
        break;
      case 'charge.dispute.created':
        await tx.query('UPDATE payments SET disputed = true, updated_at = $2 WHERE order_id = $1', [orderId, now]);
        await tx.query(
          `INSERT INTO order_events (order_id, from_status, to_status, actor_id, actor_role, note, created_at)
           SELECT id, status, status, NULL, NULL, 'The card holder disputed this payment', $2 FROM orders WHERE id = $1`,
          [orderId, now],
        );
        await queueEmail(
          tx,
          'support@halden.test',
          'payment_disputed',
          { orderId, amount: event.payload.amount ?? '' },
          now,
        );
        break;
      default:
        break; // captured, voided, refunded: the shop already recorded these when it made the call
    }
    return 'processed';
  });
}

export const webhookRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const orders = new OrderService(ctx);
    // This scope keeps the raw body: the signature is over the exact bytes that were sent.
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(new AppError('invalid_json', 'The request body is not valid JSON.'), undefined);
      }
    });

    app.post('/webhooks/haldenpay', { schema: { hide: true } }, async (req, reply) => {
      const raw = (req as { rawBody?: string }).rawBody ?? '';
      const header = req.headers['haldenpay-signature'];
      if (
        !verifySignature(
          ctx.config.HALDENPAY_WEBHOOK_SECRET,
          typeof header === 'string' ? header : undefined,
          raw,
          Math.floor(Date.now() / 1000),
        )
      ) {
        throw new AppError('webhook_signature_invalid', 'The webhook signature is missing or wrong.');
      }
      const result = await processEvent(ctx, orders, req.body as Event);
      return reply.send({ received: true, result });
    });
  };

/**
 * Delivers the provider's queued events to the shop. The mock provider lives in the same process, so the events
 * are handed to processEvent directly instead of through an HTTP request to ourselves (Fastify's inject loads
 * light-my-request, which `require`s the ESM-only cookie 2 and fails on Vercel's Node runtime). The public
 * POST /webhooks/haldenpay endpoint still checks signatures for events sent from outside.
 */
export async function deliverWebhooks(app: FastifyInstance, ctx: AppContext, limit = 50): Promise<number> {
  const orders = new OrderService(ctx);
  const due = await ctx.db.query<{ id: string; type: string; payload: Event['payload'] }>(
    `SELECT id, type, payload FROM haldenpay.events WHERE delivered_at IS NULL AND deliver_after <= now()
      ORDER BY created_at, id LIMIT $1`,
    [limit],
  );
  let delivered = 0;
  for (const e of due) {
    let ok = true;
    try {
      await processEvent(ctx, orders, { id: e.id, type: e.type, payload: e.payload });
    } catch (err) {
      ok = false; // stays queued: the next sweep or redelivery tries again
      app.log.error({ err, eventId: e.id }, 'webhook delivery failed');
    }
    await ctx.db.query(
      'UPDATE haldenpay.events SET attempts = attempts + 1, delivered_at = CASE WHEN $2 THEN now() END WHERE id = $1',
      [e.id, ok],
    );
    if (ok) delivered++;
  }
  return delivered;
}
