// Cross-cutting behaviour: error format, CSRF defences, request ids, health, OpenAPI.
import { ERROR_CODES } from '@halden/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, json, startApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());

describe('errors', () => {
  it('are problem+json with a stable code, status and request id', async () => {
    const res = await new Client(t.app).get('/no-such-thing');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const body = json(res);
    expect(body).toMatchObject({
      code: 'route_not_found',
      status: 404,
      title: expect.any(String),
      detail: expect.any(String),
    });
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });

  it('list every invalid field', async () => {
    const res = await new Client(t.app).post('/auth/register', { name: '', email: 'nope', password: 'short' });
    expect(res.statusCode).toBe(400);
    const body = json(res);
    expect(body.code).toBe('validation_failed');
    expect(body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('report bad JSON as invalid_json', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).code).toBe('invalid_json');
  });

  it('keep each code at its documented status', async () => {
    for (const [code, status] of Object.entries(ERROR_CODES)) expect(status, code).toBeGreaterThanOrEqual(400);
  });
});

describe('cross-site request defences', () => {
  it('refuse changes from another origin', async () => {
    const res = await new Client(t.app).post('/auth/logout', {}, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(json(res).code).toBe('origin_not_allowed');
  });

  it('allow reads from anywhere and changes without an Origin (API clients)', async () => {
    expect((await new Client(t.app).get('/categories', { origin: 'https://evil.example' })).statusCode).toBe(200);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuse form-encoded and plain-text bodies', async () => {
    for (const type of ['application/x-www-form-urlencoded', 'text/plain']) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': type },
        payload: 'email=a@b.c&password=x',
      });
      expect(res.statusCode, type).toBe(415);
      expect(json(res).code).toBe('unsupported_media_type');
    }
  });
});

describe('request ids', () => {
  it('reuse a valid incoming id and make one up otherwise', async () => {
    const given = await new Client(t.app).get('/health', { 'x-request-id': 'web-1234abcd' });
    expect(given.headers['x-request-id']).toBe('web-1234abcd');
    const bad = await new Client(t.app).get('/health', { 'x-request-id': 'bad id with spaces' });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('system', () => {
  it('health checks the database', async () => {
    const res = await new Client(t.app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ status: 'ok', database: 'ok' });
  });

  it('never caches API responses', async () => {
    expect((await new Client(t.app).get('/categories')).headers['cache-control']).toBe('no-store');
  });

  it('publishes an OpenAPI 3.1 document listing every route', async () => {
    const spec = t.app.swagger() as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe('3.1.0');
    for (const path of ['/api/v1/products', '/api/v1/cart/items', '/api/v1/auth/login', '/api/v1/account/addresses']) {
      expect(Object.keys(spec.paths)).toContain(path);
    }
  });
});
