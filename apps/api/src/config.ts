// Configuration comes from the environment and is checked once at startup, so a missing or malformed
// setting stops the deploy instead of failing a customer's request later.
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  /** Where the shop's web pages live; used for links in emails. */
  APP_URL: z.url().default('http://localhost:3000'),
  /** Origins allowed to send state-changing requests (comma-separated). APP_URL's origin is always allowed. */
  ALLOWED_ORIGINS: z.string().default(''),
  /** Behind Vercel's proxy, X-Forwarded-* headers are trusted for the client IP and protocol. */
  TRUST_PROXY: bool.default(false),
  /** The QA lab (fake inbox, shop clock, planted bugs). On for this demo shop; a real shop would turn it off. */
  QA_LAB_ENABLED: bool.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  GIT_SHA: z.string().default(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'),
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
  return { ...c, allowedOrigins, secureCookies: new URL(c.APP_URL).protocol === 'https:' };
}
