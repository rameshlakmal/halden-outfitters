// Configuration comes from the environment and is checked once at startup, so a missing or malformed
// setting stops the deploy instead of failing a customer's request later.
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  /** Where the shop's web pages live; used for links in emails. */
  APP_URL: z.url().default('http://localhost:3001'),
  /** Origins allowed to send state-changing requests (comma-separated). APP_URL's origin is always allowed. */
  ALLOWED_ORIGINS: z.string().default(''),
  /**
   * How many proxy hops in front of the API may set X-Forwarded-For (the client IP behind every per-IP rate limit).
   * A number, not "true": trusting every hop would take the left-most address, which the client writes itself, so
   * a made-up header per request would dodge the limits. 0 means no proxy. "false"/"true" are read as 0/1.
   */
  TRUST_PROXY: z
    .string()
    .default('0')
    .transform((v) => (v === 'false' ? 0 : v === 'true' ? 1 : Number(v)))
    .pipe(z.number().int().min(0).max(5)),
  /** The QA lab (fake inbox, shop clock, planted bugs). On for this demo shop; a real shop would turn it off. */
  QA_LAB_ENABLED: bool.default(true),
  /** Off only for end-to-end test runs, where one machine signs up many accounts in minutes. */
  RATE_LIMITS: bool.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  GIT_SHA: z.string().default(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'),
  /** Shared secret for HaldenPay webhook signatures. Must be set to a real secret in production. */
  HALDENPAY_WEBHOOK_SECRET: z.string().min(16).default('whsec_local_development_only'),
  /** Vercel Cron sends this as a bearer token to the sweep endpoint. */
  CRON_SECRET: z.string().min(16).optional(),
});

export type Config = z.infer<typeof Env> & { allowedOrigins: Set<string>; secureCookies: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  const allowedOrigins = new Set(
    [new URL(c.APP_URL).origin, ...c.ALLOWED_ORIGINS.split(',')].map((o) => o.trim()).filter(Boolean),
  );
  // Any deploy counts, not only NODE_ENV=production: with the public default secret anyone could sign a fake
  // "payment.authorized" webhook and get an order confirmed without paying.
  const deployed = c.NODE_ENV === 'production' || Boolean(env.VERCEL);
  if (deployed && c.HALDENPAY_WEBHOOK_SECRET === 'whsec_local_development_only') {
    throw new Error('Invalid configuration:\n  HALDENPAY_WEBHOOK_SECRET: set a real secret in production');
  }
  return { ...c, allowedOrigins, secureCookies: new URL(c.APP_URL).protocol === 'https:' };
}
