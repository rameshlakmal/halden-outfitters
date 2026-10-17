// HaldenPay: a mock card provider that behaves like a real one, for testing. Test cards (like real providers'
// test pages):
//   4242 4242 4242 4242  success
//   4000 0000 0000 0002  declined
//   4000 0000 0000 9995  insufficient funds
//   4000 0000 0000 3220  needs an extra step at the "bank" (3-D Secure style), then succeeds or fails
//   4000 0000 0000 0259  succeeds; once captured, a dispute webhook arrives later
//   any other number that passes the Luhn check: success
// Every state change is also queued as an event for the shop's webhook endpoint (see webhooks.ts).
import { randomBytes } from 'node:crypto';
import type { Queryable } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import type { AuthorizeInput, AuthorizeResult, PaymentGateway } from './gateway.js';

const SCENARIOS: Record<string, 'decline' | 'insufficient' | 'action' | 'dispute'> = {
  '4000000000000002': 'decline',
  '4000000000009995': 'insufficient',
  '4000000000003220': 'action',
  '4000000000000259': 'dispute',
};

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function cardBrand(number: string): string {
  if (number.startsWith('4')) return 'visa';
  if (/^5[1-5]/.test(number) || /^2[2-7]/.test(number)) return 'mastercard';
  if (/^3[47]/.test(number)) return 'amex';
  return 'card';
}

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('base64url')}`;

async function emit(client: Queryable, intentId: string, type: string, payload: Record<string, unknown>, delayMs = 0) {
  await client.query(
    `INSERT INTO haldenpay.events (id, intent_id, type, payload, deliver_after)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5::float / 1000))`,
    [id('evt'), intentId, type, JSON.stringify({ intentId, ...payload }), delayMs],
  );
}

export class HaldenPay implements PaymentGateway {
  async authorize(client: Queryable, input: AuthorizeInput): Promise<AuthorizeResult> {
    if (!luhnValid(input.cardNumber)) {
      throw new AppError('validation_failed', 'Please check the card number.', {
        errors: [{ path: 'card.number', message: 'That card number is not valid.' }],
      });
    }
    const scenario = SCENARIOS[input.cardNumber] ?? 'success';
    const intentId = id('pi');
    const brand = cardBrand(input.cardNumber);
    const last4 = input.cardNumber.slice(-4);
    const base = { intentId, brand, last4 };

    const status =
      scenario === 'decline' || scenario === 'insufficient' ? 'failed' : scenario === 'action' ? 'requires_action' : 'authorized';
    const actionToken = scenario === 'action' ? randomBytes(24).toString('base64url') : null;
    await client.query(
      `INSERT INTO haldenpay.intents (id, merchant_ref, amount, status, card_last4, card_brand, scenario, action_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [intentId, input.orderId, input.amount, status, last4, brand, scenario, actionToken],
    );

    if (status === 'failed') {
      const code = scenario === 'decline' ? 'card_declined' : 'insufficient_funds';
      await emit(client, intentId, 'payment.failed', { code });
      return { status: 'failed', ...base, code };
    }
    if (status === 'requires_action') {
      return { status: 'requires_action', ...base, actionUrl: `${input.returnUrl}?token=${actionToken}` };
    }
    await emit(client, intentId, 'payment.authorized', { amount: input.amount });
    return { status: 'authorized', ...base };
  }

  async authenticate(client: Queryable, actionToken: string, approve: boolean) {
    const { rows } = await client.query<{ id: string; status: string; amount: string }>(
      'SELECT id, status, amount FROM haldenpay.intents WHERE action_token = $1 FOR UPDATE',
      [actionToken],
    );
    const intent = rows[0];
    if (!intent || intent.status !== 'requires_action') {
      throw new AppError('token_invalid', 'This bank check has expired or was already answered.');
    }
    const status = approve ? 'authorized' : 'failed';
    await client.query('UPDATE haldenpay.intents SET status = $2, action_token = NULL, updated_at = now() WHERE id = $1', [
      intent.id,
      status,
    ]);
    if (approve) await emit(client, intent.id, 'payment.authorized', { amount: intent.amount });
    else await emit(client, intent.id, 'payment.failed', { code: 'authentication_failed' });
    return { intentId: intent.id, status: status as 'authorized' | 'failed' };
  }

  async capture(client: Queryable, intentId: string, amount: string) {
    const { rows } = await client.query<{ status: string; scenario: string; amount: string }>(
      'SELECT status, scenario, amount FROM haldenpay.intents WHERE id = $1 FOR UPDATE',
      [intentId],
    );
    const intent = rows[0];
    if (!intent || intent.status !== 'authorized') throw new Error(`HaldenPay: cannot capture ${intentId} (${intent?.status})`);
    await client.query("UPDATE haldenpay.intents SET status = 'captured', captured = $2, updated_at = now() WHERE id = $1", [
      intentId,
      amount,
    ]);
    await emit(client, intentId, 'payment.captured', { amount });
    if (intent.scenario === 'dispute') await emit(client, intentId, 'charge.dispute.created', { amount, reason: 'fraudulent' });
  }

  async void(client: Queryable, intentId: string) {
    const { rows } = await client.query<{ status: string }>('SELECT status FROM haldenpay.intents WHERE id = $1 FOR UPDATE', [
      intentId,
    ]);
    const status = rows[0]?.status;
    if (status !== 'authorized' && status !== 'requires_action') return; // nothing held
    await client.query("UPDATE haldenpay.intents SET status = 'voided', action_token = NULL, updated_at = now() WHERE id = $1", [
      intentId,
    ]);
    await emit(client, intentId, 'payment.voided', {});
  }

  async refund(client: Queryable, intentId: string, amount: string) {
    const { rows } = await client.query<{ captured: string; refunded: string }>(
      'SELECT captured, refunded FROM haldenpay.intents WHERE id = $1 FOR UPDATE',
      [intentId],
    );
    const intent = rows[0];
    if (!intent) throw new Error(`HaldenPay: no intent ${intentId}`);
    await client.query('UPDATE haldenpay.intents SET refunded = refunded + $2, updated_at = now() WHERE id = $1', [
      intentId,
      amount,
    ]);
    await emit(client, intentId, 'payment.refunded', { amount });
  }
}
