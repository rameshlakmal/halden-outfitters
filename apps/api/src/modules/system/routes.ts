import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppError } from '../../core/errors.js';

export const systemRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Liveness and database check',
        response: { 200: z.object({ status: z.literal('ok'), database: z.literal('ok') }) },
      },
    },
    async () => {
      try {
        await app.ctx.db.query('SELECT 1');
      } catch {
        throw new AppError('service_unavailable', 'The database is not reachable.');
      }
      return { status: 'ok' as const, database: 'ok' as const };
    },
  );

  app.get(
    '/version',
    {
      schema: {
        tags: ['System'],
        summary: 'Which build is running',
        response: { 200: z.object({ version: z.string(), commit: z.string() }) },
      },
    },
    async () => ({ version: '2.0.0-dev', commit: app.ctx.config.GIT_SHA }),
  );
};
