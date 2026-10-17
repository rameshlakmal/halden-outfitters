import { z } from 'zod';

/** Money as a string with two decimals, e.g. "84.50". */
export const Amount = z
  .string()
  .regex(/^-?\d+\.\d{2}$/)
  .describe('Amount with two decimals, no currency symbol');

export const Id = z.string().regex(/^\d+$/).describe('Numeric id, as a string');

export const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const Timestamp = z.iso.datetime({ offset: true });

export const Ok = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' });

/** Strings from forms: trimmed, and an empty string counts as missing. */
export const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, min > 1 ? `At least ${min} characters.` : 'Required.')
    .max(max, `At most ${max} characters.`);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .transform((s) => (s === '' ? null : s))
    .nullish()
    .transform((s) => s ?? null);

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  // abort: zod would otherwise still run the regex on an over-long string. The domain labels exclude dots, so the
  // pattern can't backtrack (the old [^\s@]+\.[^\s@]+ took seconds on a domain made of 30,000 dots).
  .max(120, { message: 'At most 120 characters.', abort: true })
  .regex(/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/, 'Enter an email address like name@example.com.');

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().describe('Pass as `cursor` to get the next page; null on the last page'),
    total: z.number().int().describe('How many items match, across all pages'),
  });
