// @ts-check
// Small HTTP helpers shared by the API: errors with a status, JSON bodies, cookies.

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message  shown to the shopper
   * @param {Record<string, string>} [fields]  per-field messages for forms
   */
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

/**
 * @param {string} message
 * @param {Record<string, string>} [fields]
 */
export const badRequest = (message, fields) => new HttpError(400, message, fields);
export const notFound = (/** @type {string} */ what = 'That page') => new HttpError(404, `${what} could not be found.`);

const MAX_BODY = 64 * 1024;

/**
 * The parsed JSON body. Vercel parses it already (req.body); the local server leaves it to us.
 * @param {import('node:http').IncomingMessage & { body?: unknown }} req
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJson(req) {
  if (req.body !== undefined) return /** @type {Record<string, unknown>} */ (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {});
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'That request is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}

/** @param {string | undefined} header */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * A Set-Cookie value. HttpOnly and SameSite=Lax always; Secure when served over HTTPS.
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge?: number, secure?: boolean }} [opts]
 */
export function cookie(name, value, { maxAge, secure = false } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    ...(maxAge !== undefined ? [`Max-Age=${maxAge}`] : []),
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

// ---------- input checks ----------

/**
 * Runs every check and reports all failing fields at once, so a form shows every problem in one go.
 * @template {Record<string, () => unknown>} T
 * @param {T} checks
 * @returns {{ [K in keyof T]: ReturnType<T[K]> }}
 */
export function validate(checks) {
  /** @type {Record<string, unknown>} */
  const values = {};
  /** @type {Record<string, string>} */
  const fields = {};
  for (const [name, check] of Object.entries(checks)) {
    try {
      values[name] = check();
    } catch (err) {
      if (!(err instanceof HttpError) || !err.fields) throw err;
      Object.assign(fields, err.fields);
    }
  }
  if (Object.keys(fields).length) throw badRequest('Please check the form.', fields);
  return /** @type {any} */ (values);
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min?: number, max?: number, optional?: boolean }} [opts]
 * @returns {string}
 */
export function text(value, field, { min = 1, max = 200, optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return '';
  if (typeof value !== 'string' || value.trim().length < min) throw badRequest('Please check the form.', { [field]: min > 1 ? `At least ${min} characters.` : 'Required.' });
  if (value.trim().length > max) throw badRequest('Please check the form.', { [field]: `At most ${max} characters.` });
  return value.trim();
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min?: number, max?: number }} [opts]
 * @returns {number}
 */
export function int(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw badRequest('Please check the form.', { [field]: `A whole number${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}.` });
  }
  return n;
}
