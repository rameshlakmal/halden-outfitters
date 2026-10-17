// Server-side sessions: the cookie holds a random token, the database holds its hash. Sessions slide: each use
// pushes the expiry out again (written at most once an hour), up to SESSION_MAX_DAYS after sign-in, and they can be
// revoked one by one or all at once.
import type { Role } from '@halden/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db, Queryable } from './db.js';
import { addSeconds } from './clock.js';
import { newToken, tokenHash } from './crypto.js';
import { AppError } from './errors.js';

export const SESSION_COOKIE = 'halden_session';
export const CART_COOKIE = 'halden_cart';
export const SESSION_DAYS = 14;
/** However often it's used, a session ends this long after sign-in, so a stolen cookie can't live forever. */
export const SESSION_MAX_DAYS = 90;

export type CurrentUser = {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  createdAt: Date;
};

type SessionRow = {
  session_id: string;
  last_seen_at: Date;
  id: string;
  name: string;
  email: string;
  role: Role;
  email_verified_at: Date | null;
  created_at: Date;
};

/**
 * The session token a request carries: `Authorization: Bearer <token>` (from POST /auth/token) or else the cookie.
 * A request that sends an Authorization header is judged by it alone, so a bad token never falls back to a cookie.
 */
export function sessionToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined) return req.cookies[SESSION_COOKIE];
  const match = /^Bearer +([A-Za-z0-9_-]+)$/i.exec(header.trim());
  return match?.[1];
}

/** The signed-in user for a session token, or null when it's missing, unknown, revoked or expired. */
export async function loadSession(db: Db, token: string | undefined, now: Date): Promise<CurrentUser | null> {
  if (!token || token.length > 100) return null;
  const row = await db.one<SessionRow>(
    `SELECT s.id AS session_id, s.last_seen_at, c.id, c.name, c.email, c.role, c.email_verified_at, c.created_at
       FROM sessions s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
        AND s.created_at > $2::timestamptz - make_interval(days => $3)`,
    [tokenHash(token), now, SESSION_MAX_DAYS],
  );
  if (!row) return null;
  if (now.getTime() - row.last_seen_at.getTime() > 3600_000) {
    await db.query('UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE id = $1', [
      row.session_id,
      now,
      addSeconds(now, SESSION_DAYS * 86400),
    ]);
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    email: row.email,
    role: row.role,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at,
  };
}

/** Starts a session for `customerId` and returns the cookie token. */
export async function createSession(
  client: Queryable,
  customerId: string,
  req: FastifyRequest,
  now: Date,
): Promise<string> {
  const token = newToken();
  await client.query(
    `INSERT INTO sessions (customer_id, token_hash, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6)`,
    [
      customerId,
      tokenHash(token),
      String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
      req.ip || null,
      now,
      addSeconds(now, SESSION_DAYS * 86400),
    ],
  );
  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_DAYS * 86400,
  });
}

export function clearCookie(reply: FastifyReply, name: string, secure: boolean): void {
  reply.clearCookie(name, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

/** Route option: refuse requests without a session before the body is even validated. */
export async function needsUser(req: FastifyRequest): Promise<void> {
  requireUser(req);
}

export function requireUser(req: FastifyRequest): CurrentUser {
  if (!req.user) throw new AppError('unauthenticated', 'Please sign in first.');
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): CurrentUser {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw new AppError('forbidden', 'Your account is not allowed to do that.');
  return user;
}
