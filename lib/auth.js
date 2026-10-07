// @ts-check
// Passwords are hashed with scrypt. A session is a signed cookie: "<customer id>.<expiry>.<signature>",
// so no session table is needed and serverless instances don't have to share memory.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';
import { HttpError } from './http.js';

const scrypt = /** @type {(password: string, salt: Buffer, keylen: number) => Promise<Buffer>} */ (promisify(scryptCb));

export const SESSION_COOKIE = 'halden_session';
export const SESSION_DAYS = 14;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 random characters.');
  return s;
}

/** @param {string} password */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * @param {string} password
 * @param {string} stored
 */
export async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** @param {string} payload */
function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** @param {number | string} customerId */
export function createSession(customerId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `${customerId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * The customer id in a valid, unexpired session token, or null.
 * @param {string | undefined} token
 */
export function readSession(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, expires, signature] = /** @type {[string, string, string]} */ (parts);
  const expected = Buffer.from(sign(`${id}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) < Date.now() / 1000) return null;
  return /^\d+$/.test(id) ? id : null;
}

/**
 * @typedef {{ id: string, name: string, email: string, isAdmin: boolean }} Customer
 */

/**
 * The signed-in customer, or null.
 * @param {string | undefined} token
 * @returns {Promise<Customer | null>}
 */
export async function currentCustomer(token) {
  const id = readSession(token);
  if (!id) return null;
  const [row] = await query('SELECT id::text, name, email, is_admin AS "isAdmin" FROM customers WHERE id = $1', [id]);
  return /** @type {Customer | undefined} */ (row) ?? null;
}

/**
 * @param {Customer | null} customer
 * @returns {Customer}
 */
export function requireCustomer(customer) {
  if (!customer) throw new HttpError(401, 'Please sign in first.');
  return customer;
}

/**
 * @param {Customer | null} customer
 * @returns {Customer}
 */
export function requireAdmin(customer) {
  if (!requireCustomer(customer).isAdmin) throw new HttpError(403, 'Only shop staff can do that.');
  return /** @type {Customer} */ (customer);
}
