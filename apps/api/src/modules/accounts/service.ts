// Account rules:
//   - Register: unique email, password policy (passwords.ts). Signed in straight away, but unverified: a
//     verification link (24 h, single use) is emailed. Checkout will need a verified email.
//   - Login: 5 wrong passwords in a row lock sign-in for 15 minutes (an email says so). While locked, even the
//     right password is refused. Unknown emails get the same answer as wrong passwords, in the same time.
//   - Password reset: always answers the same, whether or not the email has an account. The link works for 1 h,
//     once; using it sets the new password, verifies the email, ends every session and lifts any lock.
//   - Changing the password needs the current one and signs out every other device.
//   - Address book: at most 5 addresses; exactly one default whenever there are any.
import type { Address, AddressInput, Me } from '@halden/contracts';
import { MAX_ADDRESSES } from '@halden/contracts';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AppContext } from '../../core/context.js';
import { addSeconds } from '../../core/clock.js';
import { CART_COOKIE, createSession, type CurrentUser } from '../../core/auth.js';
import { burnPasswordCheck, hashPassword, newToken, tokenHash, verifyPassword } from '../../core/crypto.js';
import type { Queryable } from '../../core/db.js';
import { AppError, fieldError, notFound } from '../../core/errors.js';
import { queueEmail } from '../../core/outbox.js';
import { LIMITS } from '../../core/rate-limit.js';
import type { CartService } from '../cart/service.js';
import { passwordProblem } from './passwords.js';

export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const VERIFY_HOURS = 24;
export const RESET_MINUTES = 60;

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  role: Me['role'];
  password_hash: string;
  email_verified_at: Date | null;
  failed_logins: number;
  locked_until: Date | null;
  created_at: Date;
};

export const toMe = (c: Pick<CustomerRow, 'id' | 'name' | 'email' | 'role' | 'email_verified_at' | 'created_at'>): Me => ({
  id: c.id,
  name: c.name,
  email: c.email,
  role: c.role,
  emailVerified: c.email_verified_at !== null,
  createdAt: c.created_at.toISOString(),
});

export const userToMe = (u: CurrentUser): Me => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  emailVerified: u.emailVerified,
  createdAt: u.createdAt.toISOString(),
});

type AddressRow = {
  id: string;
  label: string | null;
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postcode: string;
  country_code: string;
  country_name: string;
  phone: string | null;
  is_default: boolean;
};

const toAddress = (r: AddressRow): Address => ({
  id: r.id,
  label: r.label,
  name: r.name,
  line1: r.line1,
  line2: r.line2,
  city: r.city,
  region: r.region,
  postcode: r.postcode,
  countryCode: r.country_code,
  countryName: r.country_name,
  phone: r.phone,
  isDefault: r.is_default,
});

const isUniqueViolation = (err: unknown) => (err as pg.DatabaseError | undefined)?.code === '23505';

export class AccountService {
  constructor(
    private readonly ctx: AppContext,
    private readonly carts: CartService,
  ) {}

  private link(path: string, token: string) {
    return `${this.ctx.config.APP_URL}${path}?token=${encodeURIComponent(token)}`;
  }

  private async issueToken(
    tx: Queryable,
    customerId: string,
    kind: 'verify_email' | 'reset_password',
    now: Date,
    seconds: number,
  ): Promise<string> {
    // A new link replaces any earlier unused one of the same kind.
    await tx.query('UPDATE auth_tokens SET used_at = $3 WHERE customer_id = $1 AND kind = $2 AND used_at IS NULL', [
      customerId,
      kind,
      now,
    ]);
    const token = newToken();
    await tx.query(
      'INSERT INTO auth_tokens (customer_id, kind, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [customerId, kind, tokenHash(token), now, addSeconds(now, seconds)],
    );
    return token;
  }

  /** Marks a link used and returns its customer, or throws `token_invalid` when it's unknown, used or expired. */
  private async consumeToken(tx: Queryable, token: string, kind: 'verify_email' | 'reset_password', now: Date) {
    const { rows } = await tx.query<{ id: string; customer_id: string; used_at: Date | null; expires_at: Date }>(
      'SELECT id, customer_id, used_at, expires_at FROM auth_tokens WHERE token_hash = $1 AND kind = $2 FOR UPDATE',
      [tokenHash(token), kind],
    );
    const row = rows[0];
    if (!row || row.used_at || row.expires_at <= now) {
      throw new AppError(
        'token_invalid',
        kind === 'verify_email'
          ? 'This confirmation link has expired or was already used. Ask for a new one from your account.'
          : 'This reset link has expired or was already used. Ask for a new one.',
      );
    }
    await tx.query('UPDATE auth_tokens SET used_at = $2 WHERE id = $1', [row.id, now]);
    return row.customer_id;
  }

  async register(req: FastifyRequest, input: { name: string; email: string; password: string }) {
    const { db, limiter } = this.ctx;
    await limiter.hit(LIMITS.registerPerIp, req.ip);
    const problem = passwordProblem(input.password, input.email, input.name);
    if (problem) throw fieldError('password', problem);
    const passwordHash = await hashPassword(input.password);
    const now = req.now;
    try {
      return await db.tx(async (tx) => {
        const { rows } = await tx.query<CustomerRow>(
          `INSERT INTO customers (email, name, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)
           RETURNING id, name, email, role, password_hash, email_verified_at, failed_logins, locked_until, created_at`,
          [input.email, input.name, passwordHash, now],
        );
        const customer = rows[0]!;
        const token = await this.issueToken(tx, customer.id, 'verify_email', now, VERIFY_HOURS * 3600);
        await queueEmail(tx, customer.email, 'verify_email', { name: customer.name, link: this.link('/verify-email', token) }, now);
        await this.carts.mergeGuestCart(tx, customer.id, req.cookies[CART_COOKIE]);
        const sessionToken = await createSession(tx, customer.id, req, now);
        return { me: toMe(customer), sessionToken };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('email_taken', 'There is already an account with this email.', {
          errors: [{ path: 'email', message: 'There is already an account with this email. Sign in instead.' }],
        });
      }
      throw err;
    }
  }

  async login(req: FastifyRequest, email: string, password: string) {
    const { db, limiter } = this.ctx;
    await limiter.hit(LIMITS.loginPerIp, req.ip);
    await limiter.hit(LIMITS.loginPerEmail, email);
    const now = req.now;
    const wrong = () => new AppError('invalid_credentials', 'That email and password do not match.');

    const customer = await db.one<CustomerRow>(
      `SELECT id, name, email, role, password_hash, email_verified_at, failed_logins, locked_until, created_at
         FROM customers WHERE email = $1`,
      [email],
    );
    if (!customer) {
      await burnPasswordCheck(password);
      throw wrong();
    }
    if (customer.locked_until && customer.locked_until > now) throw this.locked(customer.locked_until, now);

    if (!(await verifyPassword(customer.password_hash, password))) {
      const lockedUntil = await db.tx(async (tx) => {
        const { rows } = await tx.query<{ failed_logins: number }>(
          'UPDATE customers SET failed_logins = failed_logins + 1, updated_at = $2 WHERE id = $1 RETURNING failed_logins',
          [customer.id, now],
        );
        if ((rows[0]?.failed_logins ?? 0) < LOCK_AFTER_FAILURES) return null;
        const until = addSeconds(now, LOCK_MINUTES * 60);
        await tx.query('UPDATE customers SET failed_logins = 0, locked_until = $2 WHERE id = $1', [customer.id, until]);
        await queueEmail(
          tx,
          customer.email,
          'account_locked',
          { name: customer.name, minutes: LOCK_MINUTES, resetLink: `${this.ctx.config.APP_URL}/forgot-password` },
          now,
        );
        return until;
      });
      throw lockedUntil ? this.locked(lockedUntil, now) : wrong();
    }

    return db.tx(async (tx) => {
      await tx.query('UPDATE customers SET failed_logins = 0, locked_until = NULL, updated_at = $2 WHERE id = $1', [
        customer.id,
        now,
      ]);
      await this.carts.mergeGuestCart(tx, customer.id, req.cookies[CART_COOKIE]);
      const sessionToken = await createSession(tx, customer.id, req, now);
      return { me: toMe(customer), sessionToken };
    });
  }

  private locked(until: Date, now: Date) {
    const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
    return new AppError(
      'account_locked',
      `Too many wrong passwords. Sign-in is paused for ${Math.ceil(retryAfterSeconds / 60)} more minute(s), or reset your password.`,
      { retryAfterSeconds },
    );
  }

  async logout(sessionId: string, now: Date) {
    await this.ctx.db.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [sessionId, now]);
  }

  async verifyEmail(token: string, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const customerId = await this.consumeToken(tx, token, 'verify_email', now);
      await tx.query(
        'UPDATE customers SET email_verified_at = coalesce(email_verified_at, $2), updated_at = $2 WHERE id = $1',
        [customerId, now],
      );
    });
  }

  async resendVerification(user: CurrentUser, now: Date) {
    if (user.emailVerified) throw new AppError('conflict', 'Your email address is already confirmed.');
    await this.ctx.limiter.hit(LIMITS.verifyResend, user.id);
    await this.ctx.db.tx(async (tx) => {
      const token = await this.issueToken(tx, user.id, 'verify_email', now, VERIFY_HOURS * 3600);
      await queueEmail(tx, user.email, 'verify_email', { name: user.name, link: this.link('/verify-email', token) }, now);
    });
  }

  async forgotPassword(req: FastifyRequest, email: string) {
    await this.ctx.limiter.hit(LIMITS.resetPerIp, req.ip);
    await this.ctx.limiter.hit(LIMITS.resetPerEmail, email);
    const customer = await this.ctx.db.one<{ id: string; name: string }>('SELECT id, name FROM customers WHERE email = $1', [
      email,
    ]);
    if (!customer) return;
    await this.ctx.db.tx(async (tx) => {
      const token = await this.issueToken(tx, customer.id, 'reset_password', req.now, RESET_MINUTES * 60);
      await queueEmail(tx, email, 'password_reset', { name: customer.name, link: this.link('/reset-password', token) }, req.now);
    });
  }

  async resetPassword(token: string, password: string, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const customerId = await this.consumeToken(tx, token, 'reset_password', now);
      const { rows } = await tx.query<{ email: string; name: string }>('SELECT email, name FROM customers WHERE id = $1', [
        customerId,
      ]);
      const c = rows[0]!;
      const problem = passwordProblem(password, c.email, c.name);
      if (problem) throw fieldError('password', problem);
      await tx.query(
        `UPDATE customers
            SET password_hash = $2, failed_logins = 0, locked_until = NULL,
                email_verified_at = coalesce(email_verified_at, $3), updated_at = $3
          WHERE id = $1`,
        [customerId, await hashPassword(password), now],
      );
      await tx.query('UPDATE auth_tokens SET used_at = $2 WHERE customer_id = $1 AND kind = $3 AND used_at IS NULL', [
        customerId,
        now,
        'reset_password',
      ]);
      await tx.query('UPDATE sessions SET revoked_at = $2 WHERE customer_id = $1 AND revoked_at IS NULL', [customerId, now]);
      await queueEmail(tx, c.email, 'password_changed', { name: c.name }, now);
    });
  }

  async changePassword(user: CurrentUser, current: string, next: string, now: Date) {
    const row = await this.ctx.db.one<{ password_hash: string }>('SELECT password_hash FROM customers WHERE id = $1', [user.id]);
    if (!row || !(await verifyPassword(row.password_hash, current))) {
      throw fieldError('currentPassword', 'That is not your current password.');
    }
    if (current === next) throw fieldError('newPassword', 'Choose a password different from your current one.');
    const problem = passwordProblem(next, user.email, user.name);
    if (problem) throw fieldError('newPassword', problem);
    const hash = await hashPassword(next);
    await this.ctx.db.tx(async (tx) => {
      await tx.query('UPDATE customers SET password_hash = $2, updated_at = $3 WHERE id = $1', [user.id, hash, now]);
      await tx.query('UPDATE sessions SET revoked_at = $3 WHERE customer_id = $1 AND id <> $2 AND revoked_at IS NULL', [
        user.id,
        user.sessionId,
        now,
      ]);
      await queueEmail(tx, user.email, 'password_changed', { name: user.name }, now);
    });
  }

  async updateProfile(user: CurrentUser, name: string, now: Date): Promise<Me> {
    const row = await this.ctx.db.one<CustomerRow>(
      'UPDATE customers SET name = $2, updated_at = $3 WHERE id = $1 RETURNING id, name, email, role, email_verified_at, created_at',
      [user.id, name, now],
    );
    return toMe(row!);
  }

  // ---------- sessions ----------

  async sessions(user: CurrentUser, now: Date) {
    const rows = await this.ctx.db.query<{
      id: string;
      user_agent: string | null;
      ip: string | null;
      created_at: Date;
      last_seen_at: Date;
    }>(
      `SELECT id, user_agent, host(ip) AS ip, created_at, last_seen_at FROM sessions
        WHERE customer_id = $1 AND revoked_at IS NULL AND expires_at > $2
        ORDER BY last_seen_at DESC`,
      [user.id, now],
    );
    return rows.map((r) => ({
      id: r.id,
      current: r.id === user.sessionId,
      userAgent: r.user_agent,
      ip: r.ip,
      createdAt: r.created_at.toISOString(),
      lastSeenAt: r.last_seen_at.toISOString(),
    }));
  }

  async revokeSession(user: CurrentUser, sessionId: string, now: Date) {
    const rows = await this.ctx.db.query(
      'UPDATE sessions SET revoked_at = $3 WHERE id = $1 AND customer_id = $2 AND revoked_at IS NULL RETURNING id',
      [sessionId, user.id, now],
    );
    if (rows.length === 0) throw notFound('That session');
  }

  async revokeOtherSessions(user: CurrentUser, now: Date): Promise<number> {
    const rows = await this.ctx.db.query(
      'UPDATE sessions SET revoked_at = $3 WHERE customer_id = $1 AND id <> $2 AND revoked_at IS NULL RETURNING id',
      [user.id, user.sessionId, now],
    );
    return rows.length;
  }

  // ---------- addresses ----------

  private readonly ADDRESS_SELECT = `
    SELECT a.id, a.label, a.name, a.line1, a.line2, a.city, a.region, a.postcode, a.country_code, co.name AS country_name,
           a.phone, a.is_default
      FROM addresses a JOIN countries co ON co.code = a.country_code`;

  async addresses(customerId: string, client: Queryable = this.ctx.db.pool): Promise<Address[]> {
    const { rows } = await client.query<AddressRow>(
      `${this.ADDRESS_SELECT} WHERE a.customer_id = $1 ORDER BY a.is_default DESC, a.created_at, a.id`,
      [customerId],
    );
    return rows.map(toAddress);
  }

  private async checkCountry(tx: Queryable, code: string) {
    const { rows } = await tx.query('SELECT 1 FROM countries WHERE code = $1', [code]);
    if (rows.length === 0) throw fieldError('countryCode', 'Choose a country from the list.');
  }

  /** Locks the customer's address book, so two requests can't both add the fifth address or both be default. */
  private lockBook(tx: Queryable, customerId: string) {
    return tx.query('SELECT 1 FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
  }

  async addAddress(customerId: string, input: AddressInput, now: Date): Promise<Address[]> {
    return this.ctx.db.tx(async (tx) => {
      await this.lockBook(tx, customerId);
      await this.checkCountry(tx, input.countryCode);
      const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM addresses WHERE customer_id = $1', [
        customerId,
      ]);
      const count = rows[0]?.n ?? 0;
      if (count >= MAX_ADDRESSES) {
        throw new AppError('address_limit_reached', `You can keep up to ${MAX_ADDRESSES} addresses. Remove one first.`);
      }
      const makeDefault = input.isDefault || count === 0;
      if (makeDefault) await tx.query('UPDATE addresses SET is_default = false WHERE customer_id = $1 AND is_default', [customerId]);
      await tx.query(
        `INSERT INTO addresses (customer_id, label, name, line1, line2, city, region, postcode, country_code, phone, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [customerId, input.label, input.name, input.line1, input.line2, input.city, input.region, input.postcode, input.countryCode, input.phone, makeDefault, now],
      );
      return this.addresses(customerId, tx);
    });
  }

  async updateAddress(customerId: string, id: string, input: AddressInput, now: Date): Promise<Address[]> {
    return this.ctx.db.tx(async (tx) => {
      await this.lockBook(tx, customerId);
      await this.checkCountry(tx, input.countryCode);
      const { rows } = await tx.query<{ is_default: boolean }>('SELECT is_default FROM addresses WHERE id = $1 AND customer_id = $2', [
        id,
        customerId,
      ]);
      const existing = rows[0];
      if (!existing) throw notFound('That address');
      if (existing.is_default && !input.isDefault) {
        throw fieldError('isDefault', 'Choose another default address instead of switching this one off.');
      }
      if (input.isDefault && !existing.is_default) {
        await tx.query('UPDATE addresses SET is_default = false WHERE customer_id = $1 AND is_default', [customerId]);
      }
      await tx.query(
        `UPDATE addresses SET label = $3, name = $4, line1 = $5, line2 = $6, city = $7, region = $8, postcode = $9,
                country_code = $10, phone = $11, is_default = $12, updated_at = $13
          WHERE id = $1 AND customer_id = $2`,
        [id, customerId, input.label, input.name, input.line1, input.line2, input.city, input.region, input.postcode, input.countryCode, input.phone, input.isDefault, now],
      );
      return this.addresses(customerId, tx);
    });
  }

  async setDefaultAddress(customerId: string, id: string): Promise<Address[]> {
    return this.ctx.db.tx(async (tx) => {
      await this.lockBook(tx, customerId);
      const { rows } = await tx.query('SELECT 1 FROM addresses WHERE id = $1 AND customer_id = $2', [id, customerId]);
      if (rows.length === 0) throw notFound('That address');
      await tx.query('UPDATE addresses SET is_default = false WHERE customer_id = $1 AND is_default', [customerId]);
      await tx.query('UPDATE addresses SET is_default = true WHERE id = $1', [id]);
      return this.addresses(customerId, tx);
    });
  }

  /** Removes an address. When it was the default, the most recently added remaining address takes over. */
  async deleteAddress(customerId: string, id: string): Promise<Address[]> {
    return this.ctx.db.tx(async (tx) => {
      await this.lockBook(tx, customerId);
      const { rows } = await tx.query<{ is_default: boolean }>(
        'DELETE FROM addresses WHERE id = $1 AND customer_id = $2 RETURNING is_default',
        [id, customerId],
      );
      if (!rows[0]) throw notFound('That address');
      if (rows[0].is_default) {
        await tx.query(
          `UPDATE addresses SET is_default = true
            WHERE id = (SELECT id FROM addresses WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1)`,
          [customerId],
        );
      }
      return this.addresses(customerId, tx);
    });
  }

  countries() {
    return this.ctx.db.query<{ code: string; name: string }>('SELECT code, name FROM countries ORDER BY name');
  }
}
