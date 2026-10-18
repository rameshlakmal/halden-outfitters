import { z } from 'zod';

/**
 * Every error the API can return has one of these codes. Clients branch on `code`, never on the message.
 * The HTTP status for each is fixed, so tests can check both.
 */
export const ERROR_CODES = {
  validation_failed: 400,
  invalid_json: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  origin_not_allowed: 403,
  email_not_verified: 403,
  not_found: 404,
  route_not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  email_taken: 409,
  out_of_stock: 409,
  not_enough_stock: 409,
  product_unavailable: 409,
  address_limit_reached: 409,
  invalid_transition: 409,
  cart_has_problems: 409,
  cart_empty: 409,
  coupon_invalid: 409,
  shipping_unavailable: 409,
  return_not_allowed: 409,
  refund_limit_exceeded: 409,
  review_not_allowed: 403,
  already_reviewed: 409,
  precondition_failed: 412,
  precondition_required: 428,
  idempotency_key_missing: 400,
  idempotency_key_reused: 422,
  idempotency_in_progress: 409,
  payment_declined: 402,
  payment_failed: 402,
  webhook_signature_invalid: 401,
  token_invalid: 410,
  payload_too_large: 413,
  unsupported_media_type: 415,
  account_locked: 423,
  rate_limited: 429,
  qa_lab_disabled: 404,
  simulated_error: 500,
  internal_error: 500,
  service_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** RFC 9457 problem details, with the shop's `code`, field errors and the request id for support. */
export const Problem = z
  .object({
    type: z.string().describe('A URL naming the problem type'),
    title: z.string().describe('A short summary of the problem type'),
    status: z.number().int(),
    detail: z.string().describe('What went wrong this time, safe to show to the user'),
    code: z.enum(Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe('One entry per invalid field, for forms'),
    retryAfterSeconds: z.number().int().optional(),
    requestId: z.string(),
  })
  .meta({ id: 'Problem' });
export type Problem = z.infer<typeof Problem>;
