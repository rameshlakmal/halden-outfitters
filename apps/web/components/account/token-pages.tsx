'use client';
// The pages a link in an email opens: confirm the email address, choose a new password.
import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPassword, PASSWORD_MIN, Password } from '@halden/contracts';
import { CheckCircle, EnvelopeSimple, WarningCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, post } from '@/lib/api';
import { useRefreshVisitor, useSession } from '@/lib/queries';
import { Button, buttonClass, Spinner } from '../ui/button';
import { FormAlert, Input } from '../ui/field';
import { applyApiError, errorMessage } from './forms';
import { PasswordInput } from './password-input';

function Outcome({ tone, title, children }: { tone: 'success' | 'danger'; title: string; children: React.ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle : WarningCircle;
  return (
    <div className="grid gap-4" role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon weight="fill" className={`size-10 ${tone === 'success' ? 'text-brand' : 'text-danger'}`} />
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="grid gap-4 leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

export function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const refresh = useRefreshVisitor();
  const { data: me } = useSession();
  const [state, setState] = useState<{ status: 'working' | 'done' | 'failed'; message?: string }>({
    status: 'working',
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (token.length < 20) {
      setState({
        status: 'failed',
        message: 'This link is incomplete. Open it again from the email, or ask for a new one.',
      });
      return;
    }
    post('/auth/verify-email', { token })
      .then(async () => {
        setState({ status: 'done' });
        await refresh();
      })
      .catch((err) => setState({ status: 'failed', message: errorMessage(err) }));
  }, [token, refresh]);

  if (state.status === 'working') {
    return (
      <p className="flex items-center gap-3 text-ink-2" role="status">
        <Spinner className="size-5" /> Confirming your email address...
      </p>
    );
  }
  if (state.status === 'done') {
    return (
      <Outcome tone="success" title="Your email is confirmed">
        <p>Thanks. You can now check out with this account.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/shop" className={buttonClass('primary')}>
            Keep shopping
          </Link>
          <Link href="/account" className={buttonClass('outline')}>
            Your account
          </Link>
        </div>
      </Outcome>
    );
  }
  return (
    <Outcome tone="danger" title="That link did not work">
      <p>{state.message}</p>
      {me ? (
        <ResendLink />
      ) : (
        <p>
          <Link href="/sign-in?next=/account" className="font-medium link">
            Sign in
          </Link>{' '}
          and ask for a new link from your account page.
        </p>
      )}
    </Outcome>
  );
}

/** Sends a fresh confirmation link to the signed-in customer. */
export function ResendLink({ variant = 'outline' }: { variant?: 'outline' | 'primary' }) {
  const [state, setState] = useState<{ busy: boolean; sent: boolean; error?: string }>({ busy: false, sent: false });
  const send = async () => {
    setState({ busy: true, sent: false });
    try {
      await post('/auth/verify-email/resend');
      setState({ busy: false, sent: true });
    } catch (err) {
      setState({ busy: false, sent: false, error: errorMessage(err) });
    }
  };
  return (
    <div className="grid justify-items-start gap-2">
      <Button variant={variant} onClick={send} busy={state.busy} icon={<EnvelopeSimple className="size-[18px]" />}>
        {state.sent ? 'Send another link' : 'Send a new link'}
      </Button>
      {state.sent && (
        <p className="text-sm text-brand" role="status">
          Sent. Check your inbox (or the{' '}
          <Link href="/qa/inbox" className="link font-semibold">
            fake inbox
          </Link>{' '}
          on this demo).
        </p>
      )}
      {state.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(ForgotPassword) });

  const onSubmit = handleSubmit(async (values) => {
    setAlert(null);
    try {
      await post('/auth/forgot-password', values);
      setSentTo(values.email);
    } catch (err) {
      const message = applyApiError(err, setError, ['email']);
      if (message) setAlert(message);
    }
  });

  if (sentTo) {
    return (
      <Outcome tone="success" title="Check your email">
        <p>
          If <strong className="text-ink">{sentTo}</strong> has an account, a reset link is on its way. It works for one
          hour, once.
        </p>
        <p className="text-sm">
          Testing this demo? Open the{' '}
          <Link href={`/qa/inbox?email=${encodeURIComponent(sentTo)}`} className="font-medium link">
            fake inbox
          </Link>
          .
        </p>
      </Outcome>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {alert && <FormAlert>{alert}</FormAlert>}
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <Button type="submit" size="lg" busy={isSubmitting} className="w-full">
        Send reset link
      </Button>
      <p className="text-sm text-ink-2">
        Remembered it?{' '}
        <Link href="/sign-in" className="font-medium link">
          Sign in
        </Link>
      </p>
    </form>
  );
}

const NewPassword = z
  .object({ password: Password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'The two passwords are not the same.' });

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState<string | null>(
    token.length < 20 ? 'This link is incomplete. Open it again from the email.' : null,
  );
  const [alert, setAlert] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(NewPassword) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setAlert(null);
    try {
      await post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'token_invalid') return setExpired(err.message);
      const message = applyApiError(err, setError, ['password']);
      if (message) setAlert(message);
    }
  });

  if (done) {
    return (
      <Outcome tone="success" title="Your password is changed">
        <p>For your safety, every device was signed out. Sign in with your new password.</p>
        <Link href="/sign-in" className={`${buttonClass('primary')} justify-self-start`}>
          Sign in
        </Link>
      </Outcome>
    );
  }
  if (expired) {
    return (
      <Outcome tone="danger" title="That link did not work">
        <p>{expired}</p>
        <Link href="/forgot-password" className={`${buttonClass('primary')} justify-self-start`}>
          Get a new link
        </Link>
      </Outcome>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {alert && <FormAlert>{alert}</FormAlert>}
      <PasswordInput
        label="New password"
        autoComplete="new-password"
        error={errors.password?.message}
        hint={`At least ${PASSWORD_MIN} characters.`}
        {...register('password')}
      />
      <PasswordInput
        label="Type it again"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...register('confirm')}
      />
      <Button type="submit" size="lg" busy={isSubmitting} className="w-full">
        Save new password
      </Button>
    </form>
  );
}
