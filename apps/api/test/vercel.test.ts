// The Vercel entry: requests arrive the way vercel.json's rewrite delivers them (/api?path=...), over real HTTP.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import handler, { originalUrl } from '../src/vercel.js';
import { APP_URL, PASSWORDS, startApp, testDbUrl, type TestApp } from './helpers.js';

let t: TestApp;
let server: Server;
let base: string;
beforeAll(async () => {
  t = await startApp(); // seeds the test database
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: testDbUrl(), APP_URL, LOG_LEVEL: 'silent' });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await t.close();
});

describe('originalUrl', () => {
  it('puts the rewritten path back under /api/v1 and keeps the rest of the query', () => {
    expect(originalUrl('/api?path=health')).toBe('/api/v1/health');
    expect(originalUrl('/api?path=orders/12&limit=5')).toBe('/api/v1/orders/12?limit=5');
    expect(originalUrl('/api?q=tent&path=products')).toBe('/api/v1/products?q=tent');
    expect(originalUrl('/api?path=docs/')).toBe('/api/v1/docs/');
    expect(originalUrl('/api/v1/health')).toBe('/api/v1/health');
  });
});

describe('the Vercel function', () => {
  it('answers health, catalogue reads and a sign-in with its cookie', async () => {
    expect(await (await fetch(`${base}/api?path=health`)).json()).toMatchObject({ status: 'ok', database: 'ok' });
    const product = (await (await fetch(`${base}/api?path=products/titanium-pot`)).json()) as { slug: string };
    expect(product.slug).toBe('titanium-pot');
    const login = await fetch(`${base}/api?path=auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ email: 'maya@halden.test', password: PASSWORDS.shopper }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toMatch(/halden_session=/);
  });

  it('refuses the daily sweep without the cron secret', async () => {
    expect((await fetch(`${base}/api?path=internal/cron/sweep`)).status).toBe(403);
  });
});
