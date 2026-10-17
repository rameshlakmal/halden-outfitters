'use client';
import { type FormEvent, useState } from 'react';
import { Logo } from '@/components/shell/sidebar';
import { Button } from '@/components/kit';
import { ApiError, post } from '@/lib/api';
import { safeNext } from '@/lib/next-param';

export default function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email: form.get('email'), password: form.get('password') });
      // A full page load, not a client-side navigation: pages prefetched while signed out (the logo's link to the
      // dashboard) were answered with "go to sign-in", and the router would replay that cached answer.
      location.assign(safeNext(new URLSearchParams(location.search).get('next')));
    } catch (err) {
      setError(
        err instanceof ApiError && (err.code === 'account_locked' || err.code === 'rate_limited')
          ? `${err.message}`
          : err instanceof ApiError && err.status === 401
            ? 'That email and password do not match.'
            : 'Something went wrong. Please try again.',
      );
      setBusy(false);
    }
  };

  const field =
    'h-11 w-full rounded-[var(--radius-field)] border border-line bg-surface px-3.5 text-[15px] outline-none focus:border-accent';
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <form onSubmit={submit} className="grid w-full max-w-sm gap-5" noValidate>
        <Logo />
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold">Sign in to the admin</h1>
          <p className="text-sm text-ink-3">For support, warehouse and admin accounts.</p>
        </div>
        <label className="grid gap-2 text-sm font-medium">
          Email
          <input name="email" type="email" autoComplete="username" required className={field} />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Password
          <input name="password" type="password" autoComplete="current-password" required className={field} />
        </label>
        {error && (
          <p role="alert" className="rounded-[var(--radius-field)] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
