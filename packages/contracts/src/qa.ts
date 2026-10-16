import { z } from 'zod';
import { Id, Timestamp } from './common.ts';

export const InboxEmail = z
  .object({
    id: Id,
    to: z.string(),
    template: z.string(),
    subject: z.string(),
    body: z.string(),
    links: z.array(z.string()).describe('Every link in the email, for tests to follow'),
    createdAt: Timestamp,
  })
  .meta({ id: 'InboxEmail' });
export type InboxEmail = z.infer<typeof InboxEmail>;

export const Clock = z
  .object({
    now: Timestamp.describe('The shop clock: real time plus the offset'),
    offsetSeconds: z.number().int(),
  })
  .meta({ id: 'Clock' });
export type Clock = z.infer<typeof Clock>;

export const SetClock = z.object({
  offsetSeconds: z
    .number()
    .int()
    .min(0, 'The shop clock can only move forward.')
    .max(400 * 86400),
});
