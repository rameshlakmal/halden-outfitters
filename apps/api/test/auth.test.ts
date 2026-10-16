import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, json, lastEmail, PASSWORDS, startApp, tokenFrom, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const NEW = { name: 'Lena Moss', email: 'lena@example.com', password: 'a long walk in the woods' };

describe('register', () => {
  it('creates an unverified account, signs in and emails a confirmation link', async () => {
    const c = new Client(t.app);
    const res = await c.post('/auth/register', { ...NEW, email: '  Lena@Example.COM ' });
    expect(res.statusCode).toBe(201);
    expect(json(res).customer).toMatchObject({ email: 'lena@example.com', role: 'customer', emailVerified: false });
    const session = res.cookies.find((k) => k.name === 'halden_session') as { httpOnly?: boolean; sameSite?: string } | undefined;
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    expect(json(await c.get('/auth/session')).customer.email).toBe('lena@example.com');
    const mail = await lastEmail(t.db, 'lena@example.com', 'verify_email');
    expect(mail?.body_text).toContain('http://localhost:3000/verify-email?token=');
  });

  it('stores only an argon2id hash of the password', async () => {
    await new Client(t.app).post('/auth/register', NEW);
    const row = await t.db.one<{ password_hash: string }>('SELECT password_hash FROM customers WHERE email = $1', [NEW.email]);
    expect(row?.password_hash).toMatch(/^\$argon2id\$/);
    expect(row?.password_hash).not.toContain(NEW.password);
  });

  it('refuses a taken email, ignoring case', async () => {
    const res = await new Client(t.app).post('/auth/register', { ...NEW, email: 'MAYA@halden.test' });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'email_taken', errors: [{ path: 'email' }] });
  });

  it.each([
    ['too short', 'short1234', 'At least 10 characters.'],
    ['common', 'password123', 'This password is too common. Choose something harder to guess.'],
    ['the email', 'lena@example.com', 'Your password must not be your email address.'],
    ['repeated', 'aaaaaaaaaaaa', 'Your password must not be one character repeated.'],
  ])('refuses a password that is %s', async (_, password, message) => {
    const res = await new Client(t.app).post('/auth/register', { ...NEW, password });
    expect(res.statusCode).toBe(400);
    expect(json(res).errors).toEqual([{ path: 'password', message }]);
  });
});

describe('email confirmation', () => {
  it('works once, then the link is spent', async () => {
    const c = new Client(t.app);
    await c.post('/auth/register', NEW);
    const token = tokenFrom((await lastEmail(t.db, NEW.email))!.body_text);
    expect((await c.post('/auth/verify-email', { token })).statusCode).toBe(200);
    expect(json(await c.get('/auth/session')).customer.emailVerified).toBe(true);
    const again = await c.post('/auth/verify-email', { token });
    expect(again.statusCode).toBe(410);
    expect(json(again).code).toBe('token_invalid');
  });

  it('expires after 24 hours on the shop clock', async () => {
    const c = new Client(t.app);
    await c.post('/auth/register', NEW);
    const token = tokenFrom((await lastEmail(t.db, NEW.email))!.body_text);
    t.advance(24 * 3600 + 1);
    expect(json(await c.post('/auth/verify-email', { token })).code).toBe('token_invalid');
  });

  it('a new link replaces the old one', async () => {
    const c = new Client(t.app);
    await c.post('/auth/register', NEW);
    const first = tokenFrom((await lastEmail(t.db, NEW.email))!.body_text);
    expect((await c.post('/auth/verify-email/resend')).statusCode).toBe(200);
    const second = tokenFrom((await lastEmail(t.db, NEW.email))!.body_text);
    expect(second).not.toBe(first);
    expect(json(await c.post('/auth/verify-email', { token: first })).code).toBe('token_invalid');
    expect((await c.post('/auth/verify-email', { token: second })).statusCode).toBe(200);
    expect(json(await c.post('/auth/verify-email/resend')).code).toBe('conflict');
  });

  it('resending needs a session', async () => {
    expect(json(await new Client(t.app).post('/auth/verify-email/resend')).code).toBe('unauthenticated');
  });
});

describe('login', () => {
  it('signs in with the right password, any email case', async () => {
    const c = new Client(t.app);
    const res = await c.post('/auth/login', { email: 'Maya@Halden.test', password: PASSWORDS.shopper });
    expect(res.statusCode).toBe(200);
    expect(json(res).customer).toMatchObject({ name: 'Maya Okafor', emailVerified: true });
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await new Client(t.app).post('/auth/login', { email: 'maya@halden.test', password: 'not it at all' });
    const unknown = await new Client(t.app).post('/auth/login', { email: 'nobody@example.com', password: 'not it at all' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(json(wrong).detail).toBe(json(unknown).detail);
    expect(json(wrong).code).toBe('invalid_credentials');
  });

  it('locks sign-in for 15 minutes after 5 wrong passwords in a row, and emails the owner', async () => {
    const c = new Client(t.app);
    const tries = [];
    for (let i = 0; i < 5; i++) tries.push(await c.post('/auth/login', { email: 'jonas@halden.test', password: `wrong guess ${i}` }));
    expect(tries.slice(0, 4).every((r) => r.statusCode === 401)).toBe(true);
    expect(tries[4]!.statusCode).toBe(423);
    expect(tries[4]!.headers['retry-after']).toBe('900');

    const right = await c.post('/auth/login', { email: 'jonas@halden.test', password: PASSWORDS.shopper });
    expect(right.statusCode).toBe(423);
    expect(json(right).code).toBe('account_locked');
    expect((await lastEmail(t.db, 'jonas@halden.test'))?.template).toBe('account_locked');

    t.advance(15 * 60 + 1);
    expect((await c.post('/auth/login', { email: 'jonas@halden.test', password: PASSWORDS.shopper })).statusCode).toBe(200);
  });

  it('a successful sign-in resets the count of wrong passwords', async () => {
    const c = new Client(t.app);
    for (let i = 0; i < 4; i++) await c.post('/auth/login', { email: 'ari@halden.test', password: 'wrong wrong wrong' });
    await c.login('ari@halden.test', PASSWORDS.shopper);
    for (let i = 0; i < 4; i++) await c.post('/auth/login', { email: 'ari@halden.test', password: 'wrong wrong wrong' });
    expect((await c.post('/auth/login', { email: 'ari@halden.test', password: PASSWORDS.shopper })).statusCode).toBe(200);
  });
});

describe('sessions', () => {
  it('sign out ends the session on the server, not only the cookie', async () => {
    const c = new Client(t.app);
    await c.login('maya@halden.test', PASSWORDS.shopper);
    const stolen = c.cookies.get('halden_session')!;
    await c.post('/auth/logout');
    const thief = new Client(t.app);
    thief.cookies.set('halden_session', stolen);
    expect(json(await thief.get('/auth/session')).customer).toBeNull();
  });

  it('only a hash of the token is stored', async () => {
    const c = new Client(t.app);
    await c.login('maya@halden.test', PASSWORDS.shopper);
    const token = c.cookies.get('halden_session')!;
    const rows = await t.db.query("SELECT 1 FROM sessions WHERE encode(token_hash, 'escape') LIKE '%' || $1 || '%'", [token]);
    expect(rows).toHaveLength(0);
  });

  it('expire after 14 days without use', async () => {
    const c = new Client(t.app);
    await c.login('maya@halden.test', PASSWORDS.shopper);
    t.advance(14 * 86400 + 60);
    expect(json(await c.get('/auth/session')).customer).toBeNull();
  });

  it('slide forward while used', async () => {
    const c = new Client(t.app);
    await c.login('maya@halden.test', PASSWORDS.shopper);
    for (let i = 0; i < 3; i++) {
      t.advance(10 * 86400);
      expect(json(await c.get('/auth/session')).customer, `day ${(i + 1) * 10}`).not.toBeNull();
    }
  });
});

describe('password reset', () => {
  it('answers the same whether or not the account exists', async () => {
    const known = await new Client(t.app).post('/auth/forgot-password', { email: 'maya@halden.test' });
    const unknown = await new Client(t.app).post('/auth/forgot-password', { email: 'nobody@example.com' });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
    expect(await lastEmail(t.db, 'nobody@example.com')).toBeUndefined();
  });

  it('sets the new password, signs out everywhere and lifts a lock', async () => {
    const phone = new Client(t.app);
    await phone.login('maya@halden.test', PASSWORDS.shopper);
    for (let i = 0; i < 5; i++) await new Client(t.app).post('/auth/login', { email: 'maya@halden.test', password: 'wrong guess here' });

    await new Client(t.app).post('/auth/forgot-password', { email: 'maya@halden.test' });
    const token = tokenFrom((await lastEmail(t.db, 'maya@halden.test', 'password_reset'))!.body_text);
    const res = await new Client(t.app).post('/auth/reset-password', { token, password: 'new trail, new password' });
    expect(res.statusCode).toBe(200);

    expect(json(await phone.get('/auth/session')).customer).toBeNull();
    expect((await new Client(t.app).post('/auth/login', { email: 'maya@halden.test', password: PASSWORDS.shopper })).statusCode).toBe(401);
    await new Client(t.app).login('maya@halden.test', 'new trail, new password');
    expect((await lastEmail(t.db, 'maya@halden.test'))?.template).toBe('password_changed');
  });

  it('a reset link works once and for one hour', async () => {
    await new Client(t.app).post('/auth/forgot-password', { email: 'ari@halden.test' });
    const token = tokenFrom((await lastEmail(t.db, 'ari@halden.test', 'password_reset'))!.body_text);
    t.advance(3601);
    expect(json(await new Client(t.app).post('/auth/reset-password', { token, password: 'too late for this one' })).code).toBe('token_invalid');

    await new Client(t.app).post('/auth/forgot-password', { email: 'ari@halden.test' });
    const fresh = tokenFrom((await lastEmail(t.db, 'ari@halden.test', 'password_reset'))!.body_text);
    expect((await new Client(t.app).post('/auth/reset-password', { token: fresh, password: 'right on time today' })).statusCode).toBe(200);
    expect((await new Client(t.app).post('/auth/reset-password', { token: fresh, password: 'and once more again' })).statusCode).toBe(410);
  });

  it('checks the new password against the policy', async () => {
    await new Client(t.app).post('/auth/forgot-password', { email: 'ari@halden.test' });
    const token = tokenFrom((await lastEmail(t.db, 'ari@halden.test', 'password_reset'))!.body_text);
    const res = await new Client(t.app).post('/auth/reset-password', { token, password: 'qwertyuiop' });
    expect(json(res).errors[0].path).toBe('password');
    // The failed attempt did not spend the link.
    expect((await new Client(t.app).post('/auth/reset-password', { token, password: 'a much better password' })).statusCode).toBe(200);
  });
});

describe('rate limits', () => {
  it('slow down repeated sign-in attempts for one email', async () => {
    const limited = await startApp({ rateLimits: true });
    try {
      const statuses = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await new Client(limited.app).post('/auth/login', { email: 'nobody@example.com', password: 'guess guess' })).statusCode);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      const last = await new Client(limited.app).post('/auth/login', { email: 'nobody@example.com', password: 'guess guess' });
      expect(last.statusCode).toBe(429);
      expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.db.query('TRUNCATE rate_limits');
      await limited.close();
    }
  });
});
