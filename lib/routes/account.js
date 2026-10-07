// @ts-check
// Signing up, in and out.
import { createSession, hashPassword, SESSION_COOKIE, SESSION_DAYS, verifyPassword } from '../auth.js';
import { query } from '../db.js';
import { badRequest, cookie, HttpError, text, validate } from '../http.js';
import { CART_COOKIE, mergeGuestCart } from './cart.js';

/**
 * @param {unknown} value
 */
function email(value) {
  const e = text(value, 'email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw badRequest('Please check the form.', { email: 'Enter an email address like name@example.com.' });
  return e;
}

/**
 * @param {import('../router.js').Context} ctx
 * @param {{ id: string, name: string, email: string, is_admin: boolean }} row
 */
async function signIn(ctx, row) {
  await mergeGuestCart(row.id, ctx.cookies[CART_COOKIE]);
  ctx.setCookie(cookie(SESSION_COOKIE, createSession(row.id), { maxAge: SESSION_DAYS * 86400, secure: ctx.secure }));
  ctx.setCookie(cookie(CART_COOKIE, '', { maxAge: 0, secure: ctx.secure }));
  return { id: row.id, name: row.name, email: row.email, isAdmin: row.is_admin };
}

/** @type {import('../router.js').Route[]} */
export const accountRoutes = [
  ['GET', /^\/api\/me$/, async ({ customer }) => ({ customer })],

  ['POST', /^\/api\/auth\/register$/, async (ctx) => {
    const body = await ctx.body();
    const { name, address, password } = validate({
      name: () => text(body.name, 'name', { max: 80 }),
      address: () => email(body.email),
      password: () => text(body.password, 'password', { min: 8, max: 200 }),
    });
    const [existing] = await query('SELECT 1 FROM customers WHERE email = $1', [address]);
    if (existing) throw badRequest('Please check the form.', { email: 'There is already an account with this email. Sign in instead.' });
    const [row] = await query(
      'INSERT INTO customers (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id::text, name, email, is_admin',
      [address, name, await hashPassword(password)]);
    return { customer: await signIn(ctx, /** @type {any} */ (row)) };
  }],

  ['POST', /^\/api\/auth\/login$/, async (ctx) => {
    const body = await ctx.body();
    const address = email(body.email);
    const password = text(body.password, 'password', { max: 200 });
    const [row] = await query('SELECT id::text, name, email, is_admin, password_hash FROM customers WHERE email = $1', [address]);
    // The same message whether the email or the password is wrong, so the form doesn't reveal who has an account.
    if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(401, 'That email and password do not match.');
    return { customer: await signIn(ctx, /** @type {any} */ (row)) };
  }],

  ['POST', /^\/api\/auth\/logout$/, async (ctx) => {
    ctx.setCookie(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: ctx.secure }));
    return { ok: true };
  }],
];
