// Runs the API as one Vercel function (api/index.js re-exports this from the build). vercel.json sends every
// /api/v1/* request here with the path in ?path=, so the original URL is put back before Fastify routes it.
// The app is built on the first request and reused while the function instance lives.
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { API_PREFIX, buildApp } from './app.js';
import { loadConfig } from './config.js';

let ready: Promise<FastifyInstance> | undefined;

/** "/api?path=orders/12&x=1" (as the rewrite delivers it) → "/api/v1/orders/12?x=1". Other URLs pass through. */
export function originalUrl(url: string): string {
  const u = new URL(url, 'http://localhost');
  const path = u.searchParams.get('path');
  if (path === null) return url;
  u.searchParams.delete('path');
  const query = u.searchParams.toString();
  return `${API_PREFIX}/${path.replace(/^\/+/, '')}${query ? `?${query}` : ''}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  ready ??= buildApp({ config: loadConfig() }).then(async (app) => {
    await app.ready();
    return app;
  });
  const app = await ready;
  req.url = originalUrl(req.url ?? '/');
  app.server.emit('request', req, res);
}
