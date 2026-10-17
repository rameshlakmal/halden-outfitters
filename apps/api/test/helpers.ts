// Test harness: a real Postgres database (TEST_DATABASE_URL), rebuilt from the migrations once per run and
// reseeded before each test, and the real app driven through Fastify's inject (no network).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Clock } from '../src/core/clock.js';
import { Db } from '../src/core/db.js';
import { seed } from '../scripts/seed-lib.js';

export const PASSWORDS = {
  admin: 'admin-test-password-1',
  staff: 'staff-test-password-1',
  shopper: 'shopper-test-password-1',
};
export const APP_URL = 'http://localhost:3000';

export function testDbUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL (see apps/api/.env.example). The tests drop and rebuild it.');
  if (!/test/.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must name a database with "test" in it.');
  return url;
}

export type TestApp = {
  app: FastifyInstance;
  db: Db;
  clock: Clock;
  /** Moves the shop clock forward (the app's clock and SQL's shop_now() together). */
  advance: (seconds: number) => Promise<void>;
  /** Puts the demo data back and the clock back to real time. */
  reseed: (opts?: { orders?: boolean }) => Promise<void>;
  close: () => Promise<void>;
};

export async function startApp({ rateLimits = false } = {}): Promise<TestApp> {
  const db = new Db(testDbUrl(), 4);
  const clock = new Clock(db);
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testDbUrl(),
    APP_URL,
    LOG_LEVEL: 'silent',
  });
  const app = await buildApp({ config, db, clock, rateLimits });
  await app.ready();
  await seed(db, PASSWORDS, { orders: false });
  return {
    app,
    db,
    clock,
    advance: async (seconds) => {
      await clock.setOffsetSeconds((await clock.offsetSeconds()) + seconds);
    },
    reseed: async (opts = {}) => {
      await seed(db, PASSWORDS, { orders: opts.orders ?? false });
      await clock.setOffsetSeconds(0);
    },
    close: async () => {
      await app.close();
      await db.close();
    },
  };
}

/** A browser-like client: keeps cookies between requests and sends JSON with the shop's Origin. */
export class Client {
  cookies = new Map<string, string>();

  constructor(private readonly app: FastifyInstance) {}

  async req(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: APP_URL,
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      const gone = c.value === '' || c.maxAge === 0 || (c.expires && c.expires.getTime() < Date.now());
      if (gone) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  get = (url: string, headers?: Record<string, string>) => this.req('GET', url, undefined, headers);
  post = (url: string, body: unknown = {}, headers?: Record<string, string>) => this.req('POST', url, body, headers);
  put = (url: string, body: unknown) => this.req('PUT', url, body);
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  delete = (url: string) => this.req('DELETE', url);

  async login(email: string, password: string) {
    const res = await this.post('/auth/login', { email, password });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
    return res.json();
  }
}

export const json = (res: LightMyRequestResponse) => res.json() as Record<string, any>;

/** The newest email to `to`, read the way an admin sees the fake inbox. */
export async function lastEmail(db: Db, to: string, template?: string) {
  const row = await db.one<{ subject: string; body_text: string; template: string }>(
    `SELECT subject, body_text, template FROM outbox WHERE to_email = $1 ${template ? 'AND template = $2' : ''}
      ORDER BY id DESC LIMIT 1`,
    template ? [to, template] : [to],
  );
  return row;
}

export const tokenFrom = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? '';

export async function productId(db: Db, slug: string): Promise<string> {
  const row = await db.one<{ id: string }>('SELECT id FROM products WHERE slug = $1', [slug]);
  return row!.id;
}
