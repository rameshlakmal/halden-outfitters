// What every route can reach: settings, the database, the shop clock and the rate limiter.
import type { Config } from '../config.js';
import type { CurrentUser } from './auth.js';
import type { Clock } from './clock.js';
import type { Db } from './db.js';
import type { PaymentGateway } from '../modules/payments/gateway.js';
import type { Bugs } from './bugs.js';
import type { RateLimiter } from './rate-limit.js';

export type AppContext = {
  config: Config;
  db: Db;
  clock: Clock;
  limiter: RateLimiter;
  bugs: Bugs;
  gateway: PaymentGateway;
  /** Delivers the payment provider's queued webhook events (set once the app is built). */
  deliverWebhooks: () => Promise<number>;
};

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user: CurrentUser | null;
    /** The shop clock's time for this request: one reading, so every rule in a request sees the same instant. */
    now: Date;
  }
}
