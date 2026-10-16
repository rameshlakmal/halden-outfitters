import { ERROR_CODES, type ErrorCode } from '@halden/contracts';

const TITLES: Record<ErrorCode, string> = {
  validation_failed: 'The request has invalid fields',
  invalid_json: 'The request body is not valid JSON',
  unauthenticated: 'Sign-in required',
  invalid_credentials: 'Email or password is wrong',
  forbidden: 'Not allowed',
  origin_not_allowed: 'Request from another site',
  email_not_verified: 'Email address not verified',
  not_found: 'Not found',
  route_not_found: 'No such API route',
  method_not_allowed: 'Method not allowed',
  conflict: 'Conflict with the current state',
  email_taken: 'Email already registered',
  out_of_stock: 'Out of stock',
  not_enough_stock: 'Not enough stock',
  product_unavailable: 'Product not available',
  address_limit_reached: 'Address book is full',
  token_invalid: 'Link expired or already used',
  payload_too_large: 'Request too large',
  unsupported_media_type: 'Send JSON',
  account_locked: 'Account temporarily locked',
  rate_limited: 'Too many requests',
  qa_lab_disabled: 'QA lab is switched off',
  internal_error: 'Something went wrong',
  service_unavailable: 'Service unavailable',
};

export type FieldError = { path: string; message: string };

/** An error the client is meant to see. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    detail: string,
    readonly extra: { errors?: FieldError[]; retryAfterSeconds?: number } = {},
  ) {
    super(detail);
    this.status = ERROR_CODES[code];
  }

  get title(): string {
    return TITLES[this.code];
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} could not be found.`);

export const fieldError = (path: string, message: string, detail = 'Please check the form.') =>
  new AppError('validation_failed', detail, { errors: [{ path, message }] });

export const problemTitle = (code: ErrorCode) => TITLES[code];
