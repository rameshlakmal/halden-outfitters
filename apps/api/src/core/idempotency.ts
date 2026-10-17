// Idempotency keys for requests that must never run twice (placing an order, refunds). The client sends an
// Idempotency-Key header; the first request with a key runs and its response is stored. Repeating the key
// with the same body returns that stored response; with a different body it's refused (422). A repeat that
// arrives while the first is still running gets 409.
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Db } from './db.js';
import { AppError } from './errors.js';

const KEY = /^[A-Za-z0-9_-]{8,100}$/;

export type Stored = { status: number; body: unknown };

export async function withIdempotency<T>(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  customerId: string,
  run: () => Promise<{ status: number; body: T }>,
): Promise<T> {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !KEY.test(key)) {
    throw new AppError('idempotency_key_missing', 'Send an Idempotency-Key header (8 to 100 letters, digits, - or _).');
  }
  const route = `${req.method} ${req.routeOptions.url}`;
  const hash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');

  try {
    await db.query('INSERT INTO idempotency_keys (customer_id, key, route, request_hash) VALUES ($1, $2, $3, $4)', [
      customerId,
      key,
      route,
      hash,
    ]);
  } catch (err) {
    if ((err as pg.DatabaseError).code !== '23505') throw err;
    const row = await db.one<{ route: string; request_hash: string; status_code: number | null; response: unknown }>(
      'SELECT route, request_hash, status_code, response FROM idempotency_keys WHERE customer_id = $1 AND key = $2',
      [customerId, key],
    );
    if (!row || row.route !== route || row.request_hash !== hash) {
      throw new AppError('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.');
    }
    if (row.status_code === null) {
      throw new AppError('idempotency_in_progress', 'The first request with this key is still being processed.');
    }
    reply.header('idempotent-replayed', 'true');
    replayError(row.response);
    reply.status(row.status_code);
    return row.response as T;
  }

  try {
    const { status, body } = await run();
    await db.query('UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE customer_id = $1 AND key = $2', [
      customerId,
      key,
      status,
      JSON.stringify(body),
    ]);
    reply.status(status);
    return body;
  } catch (err) {
    // Errors the client can see (declined card, stock gone) are remembered like successes, so a retry with the
    // same key gets the same answer. Anything unexpected frees the key for a real retry.
    if (err instanceof AppError) {
      await db.query('UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE customer_id = $1 AND key = $2', [
        customerId,
        key,
        err.status,
        JSON.stringify({ __error: { code: err.code, message: err.message, extra: err.extra } }),
      ]);
    } else {
      await db.query('DELETE FROM idempotency_keys WHERE customer_id = $1 AND key = $2', [customerId, key]);
    }
    throw err;
  }
}

/** A stored error response is replayed as the same AppError. */
export function replayError(stored: unknown): void {
  const e = (stored as { __error?: { code: AppError['code']; message: string; extra: AppError['extra'] } } | null)?.__error;
  if (e) throw new AppError(e.code, e.message, e.extra);
}
