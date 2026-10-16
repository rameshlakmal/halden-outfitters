// Fixed-window rate limits kept in Postgres, because serverless instances share no memory.
// Uses real time, not the shop clock: moving the QA clock must not lift a limit.
import type { Db } from './db.js';
import { AppError } from './errors.js';

export type Limit = { name: string; max: number; windowSeconds: number };

export const LIMITS = {
  loginPerIp: { name: 'login-ip', max: 30, windowSeconds: 600 },
  loginPerEmail: { name: 'login-email', max: 10, windowSeconds: 600 },
  registerPerIp: { name: 'register-ip', max: 10, windowSeconds: 3600 },
  resetPerEmail: { name: 'reset-email', max: 3, windowSeconds: 3600 },
  resetPerIp: { name: 'reset-ip', max: 10, windowSeconds: 3600 },
  verifyResend: { name: 'verify-resend', max: 3, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

export class RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly enabled: boolean,
  ) {}

  /** Counts one hit for `subject`; throws `rate_limited` once the window's limit is passed. */
  async hit(limit: Limit, subject: string): Promise<void> {
    if (!this.enabled) return;
    const nowMs = Date.now();
    const windowStart = new Date(Math.floor(nowMs / (limit.windowSeconds * 1000)) * limit.windowSeconds * 1000);
    const row = await this.db.one<{ hits: number }>(
      `INSERT INTO rate_limits (key, window_start, hits) VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`,
      [`${limit.name}:${subject}`, windowStart],
    );
    // Now and then, clear windows that ended a day ago.
    if (Math.random() < 0.01) {
      await this.db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
    }
    if ((row?.hits ?? 0) > limit.max) {
      const retryAfterSeconds = Math.ceil((windowStart.getTime() + limit.windowSeconds * 1000 - nowMs) / 1000);
      throw new AppError('rate_limited', 'Too many attempts. Please wait a little and try again.', { retryAfterSeconds });
    }
  }
}
