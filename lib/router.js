// @ts-check
// The API router. Each route gets a context with the request, the signed-in customer and helpers.
import { SESSION_COOKIE, currentCustomer } from './auth.js';
import { HttpError, parseCookies, readJson } from './http.js';

/**
 * @typedef {import('./auth.js').Customer} Customer
 * @typedef {{
 *   req: import('node:http').IncomingMessage & { body?: unknown },
 *   params: string[],
 *   query: URLSearchParams,
 *   cookies: Record<string, string>,
 *   customer: Customer | null,
 *   secure: boolean,
 *   body: () => Promise<Record<string, unknown>>,
 *   setCookie: (value: string) => void,
 * }} Context
 * @typedef {(ctx: Context) => Promise<unknown>} Handler
 * @typedef {[method: string, pattern: RegExp, handler: Handler]} Route
 */

/**
 * @param {Route[]} routes
 * @returns {(req: Context['req'], res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createHandler(routes) {
  return async (req, res) => {
    /** @type {string[]} */
    const setCookies = [];
    const send = (/** @type {number} */ status, /** @type {unknown} */ data) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
      res.end(JSON.stringify(data));
    };

    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Vercel sends every /api/* call to this one function (see vercel.json) with the path in ?path=.
      const path = url.searchParams.get('path') !== null ? `/api/${url.searchParams.get('path')}` : url.pathname;
      const method = req.method ?? 'GET';

      // Changes must come as JSON: a plain HTML form on another site can't send that, which, with
      // SameSite cookies, keeps other sites from acting for a signed-in shopper.
      if (method !== 'GET' && method !== 'HEAD' && !(req.headers['content-type'] ?? '').includes('application/json')) {
        throw new HttpError(415, 'Send changes as JSON.');
      }

      const cookies = parseCookies(req.headers.cookie);
      const proto = String(req.headers['x-forwarded-proto'] ?? '');
      for (const [m, pattern, handler] of routes) {
        if (m !== method) continue;
        const match = pattern.exec(path);
        if (!match) continue;
        const ctx = /** @type {Context} */ ({
          req,
          params: match.slice(1).map((p) => decodeURIComponent(p)),
          query: url.searchParams,
          cookies,
          customer: await currentCustomer(cookies[SESSION_COOKIE]),
          secure: proto === 'https',
          body: () => readJson(req),
          setCookie: (value) => setCookies.push(value),
        });
        send(200, (await handler(ctx)) ?? { ok: true });
        return;
      }
      throw new HttpError(404, `No API route for ${method} ${path}.`);
    } catch (err) {
      if (err instanceof HttpError) {
        send(err.status, { error: { message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
        return;
      }
      console.error(err);
      send(500, { error: { message: 'Something went wrong on our side. Please try again.' } });
    }
  };
}
