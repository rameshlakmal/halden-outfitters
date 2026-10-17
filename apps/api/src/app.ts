import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifySwagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import type { Problem } from '@halden/contracts';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { loadSession, SESSION_COOKIE, sessionToken } from './core/auth.js';
import { Clock } from './core/clock.js';
import type { AppContext } from './core/context.js';
import { Db } from './core/db.js';
import { AppError, problemTitle } from './core/errors.js';
import { Bugs } from './core/bugs.js';
import { RateLimiter } from './core/rate-limit.js';
import { checkoutRoutes } from './modules/checkout/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import { HaldenPay } from './modules/payments/haldenpay.js';
import { deliverWebhooks, webhookRoutes } from './modules/payments/webhooks.js';
import { accountRoutes } from './modules/accounts/routes.js';
import { returnRoutes } from './modules/returns/routes.js';
import { reviewRoutes } from './modules/reviews/routes.js';
import { staffRoutes } from './modules/staff/routes.js';
import { requestContext } from './core/audit.js';
import { cartRoutes } from './modules/cart/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { qaRoutes } from './modules/qa-lab/routes.js';
import { systemRoutes } from './modules/system/routes.js';

export const API_PREFIX = '/api/v1';
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export type BuildOptions = {
  config: Config;
  db?: Db;
  clock?: Clock;
  rateLimits?: boolean;
};

export async function buildApp({
  config,
  db,
  clock,
  rateLimits = config.RATE_LIMITS,
}: BuildOptions): Promise<FastifyInstance> {
  const database = db ?? new Db(config.DATABASE_URL, config.DB_POOL_MAX);
  const ctx: AppContext = {
    config,
    db: database,
    clock: clock ?? new Clock(database),
    limiter: new RateLimiter(database, rateLimits),
    bugs: new Bugs(database),
    gateway: new HaldenPay(),
    deliverWebhooks: async () => 0, // replaced below, once the app exists
  };

  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
            ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
          },
    // Reuse a caller's request id (e.g. from the web app) so one id follows the request through every log.
    genReqId: (req) => {
      const given = req.headers['x-request-id'];
      return typeof given === 'string' && REQUEST_ID.test(given) ? given : randomUUID();
    },
    // Trust exactly TRUST_PROXY hops (see config.ts); 0 trusts none, so req.ip is the socket address.
    trustProxy: config.TRUST_PROXY > 0 ? (_address: string, hop: number) => hop < config.TRUST_PROXY : false,
    bodyLimit: 64 * 1024,
    routerOptions: { ignoreTrailingSlash: true },
  });

  app.decorate('ctx', ctx);
  app.decorateRequest('user', null);
  app.decorateRequest('now', null as unknown as Date);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Only JSON bodies. Plain-text bodies are what an HTML form on another site could send, so refuse them.
  app.removeContentTypeParser(['text/plain']);

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    // JSON responses need no CSP; the docs page loads its own script.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Halden Outfitters API',
        version: '2.0.0',
        description:
          'The API of Halden Outfitters, a demo outdoor-gear shop built as a QA test target. ' +
          'Sign in with POST /auth/login (the session is an HttpOnly cookie), or get a token from POST /auth/token ' +
          'and send it as `Authorization: Bearer <token>`. Every error is ' +
          'application/problem+json with a stable `code`.',
      },
      servers: [{ url: '/' }],
      tags: [
        { name: 'Catalog' },
        { name: 'Cart' },
        { name: 'Auth' },
        { name: 'Account' },
        { name: 'Checkout' },
        { name: 'Orders' },
        { name: 'Staff' },
        { name: 'QA lab' },
        { name: 'System' },
      ],
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
          bearer: { type: 'http', scheme: 'bearer', description: 'A token from POST /auth/token' },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(scalar, { routePrefix: `${API_PREFIX}/docs` });

  // Each request runs in its own async context carrying its id, which the audit log records.
  app.addHook('onRequest', (req, _reply, done) => requestContext.run({ requestId: req.id }, done));
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    if (!req.url.startsWith(`${API_PREFIX}/docs`)) reply.header('cache-control', 'no-store');
    // A browser always sends Origin on a cross-site POST. Only the shop's own pages may change things.
    // Requests without Origin (curl, Postman, server-to-server) carry no ambient cookies from another site.
    const origin = req.headers.origin;
    if (req.method !== 'GET' && req.method !== 'HEAD' && origin && !config.allowedOrigins.has(origin)) {
      throw new AppError('origin_not_allowed', 'Requests that change data must come from the shop itself.');
    }
  });

  // preValidation: before the body is validated, so routes that need a session answer 401 before 400.
  app.addHook('preValidation', async (req) => {
    req.now = await ctx.clock.now();
    req.user = await loadSession(ctx.db, sessionToken(req), req.now);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const problem = toProblem(err, req);
    if (problem.status >= 500) req.log.error({ err }, 'request failed');
    if (problem.retryAfterSeconds) reply.header('retry-after', String(problem.retryAfterSeconds));
    if (problem.code === 'unauthenticated') reply.header('www-authenticate', 'Bearer realm="halden"');
    return reply.status(problem.status).type('application/problem+json').send(problem);
  });

  app.setNotFoundHandler((req, reply) => {
    const problem = makeProblem(
      req,
      'route_not_found',
      404,
      `There is no API route for ${req.method} ${req.url.split('?')[0]}.`,
    );
    return reply.status(404).type('application/problem+json').send(problem);
  });

  await app.register(
    async (api) => {
      await api.register(systemRoutes);
      await api.register(catalogRoutes);
      await api.register(cartRoutes);
      await api.register(accountRoutes);
      await api.register(checkoutRoutes);
      await api.register(orderRoutes);
      await api.register(returnRoutes);
      await api.register(reviewRoutes);
      await api.register(staffRoutes);
      await api.register(webhookRoutes(ctx));
      await api.register(qaRoutes);
    },
    { prefix: API_PREFIX },
  );

  ctx.deliverWebhooks = () => deliverWebhooks(app, ctx);

  app.addHook('onClose', async () => {
    if (!db) await database.close();
  });

  return app;
}

function makeProblem(req: FastifyRequest, code: Problem['code'], status: number, detail: string): Problem {
  return {
    type: `https://halden-outfitters.vercel.app/problems/${code}`,
    title: problemTitle(code),
    status,
    detail,
    code,
    requestId: req.id,
  };
}

function toProblem(err: FastifyError, req: FastifyRequest): Problem {
  if (err instanceof AppError) {
    return { ...makeProblem(req, err.code, err.status, err.message), ...err.extra };
  }
  if (hasZodFastifySchemaValidationErrors(err)) {
    const errors = err.validation.map((v) => ({
      path: v.instancePath.replace(/^\//, '').replaceAll('/', '.') || err.validationContext || 'body',
      message: v.message ?? 'Invalid value.',
    }));
    return { ...makeProblem(req, 'validation_failed', 400, 'Please check the form.'), errors };
  }
  if (isResponseSerializationError(err)) {
    return makeProblem(req, 'internal_error', 500, 'Something went wrong on our side. Please try again.');
  }
  switch (err.code) {
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return makeProblem(
        req,
        'unsupported_media_type',
        415,
        'Send the request body as JSON (Content-Type: application/json).',
      );
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return makeProblem(req, 'payload_too_large', 413, 'That request is too large.');
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return makeProblem(req, 'invalid_json', 400, 'The request body is not valid JSON.');
  }
  if (err.statusCode === 400 && err.message.startsWith('Body is not valid JSON')) {
    return makeProblem(req, 'invalid_json', 400, 'The request body is not valid JSON.');
  }
  return makeProblem(req, 'internal_error', 500, 'Something went wrong on our side. Please try again.');
}
