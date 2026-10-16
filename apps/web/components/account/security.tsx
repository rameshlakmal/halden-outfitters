'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ActiveSession, ChangePassword, PASSWORD_MIN } from '@halden/contracts';
import { DeviceMobile, Desktop, SignOut } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { del, get, post } from '@/lib/api';
import { useRefreshVisitor } from '@/lib/queries';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { applyApiError, errorMessage } from './forms';
import { PasswordInput } from './password-input';
import { Section } from './section';
import { useAccount } from './use-account';

const KEY = ['sessions'] as const;

export function Security() {
  const { me } = useAccount();
  return (
    <div className="grid gap-10">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Security</h1>
        <p className="text-ink-2">Your password and the devices signed in to your account.</p>
      </header>
      {me ? (
        <>
          <PasswordForm />
          <Devices />
        </>
      ) : (
        <div className="grid max-w-md gap-3" aria-busy="true">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-40" />
        </div>
      )}
    </div>
  );
}

function PasswordForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const [alert, setAlert] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(ChangePassword) });

  const onSubmit = handleSubmit(async (values) => {
    setAlert(null);
    try {
      await post('/account/password', values);
      reset({ currentPassword: '', newPassword: '' });
      await qc.invalidateQueries({ queryKey: KEY });
      toast.show('Password changed. Other devices were signed out.');
    } catch (err) {
      const message = applyApiError(err, setError, ['currentPassword', 'newPassword']);
      if (message) setAlert(message);
    }
  });

  return (
    <Section title="Password" description="Changing it signs out every other device.">
      <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-5">
        {alert && <FormAlert>{alert}</FormAlert>}
        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <PasswordInput
          label="New password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <Button type="submit" busy={isSubmitting} className="justify-self-start">
          Change password
        </Button>
      </form>
    </Section>
  );
}

/** "Chrome on Windows" from a user agent string; good enough to recognise a device. */
function describe(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unknown device', mobile: false };
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const label = browser && os ? `${browser} on ${os}` : (browser ?? os ?? ua.slice(0, 40));
  return { label, mobile: /Mobile|iPhone|Android/.test(ua) };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function Devices() {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const refresh = useRefreshVisitor();
  const sessions = useQuery({ queryKey: KEY, queryFn: () => get<{ items: ActiveSession[] }>('/account/sessions') });
  const items = sessions.data?.items ?? [];

  const revoke = useMutation({
    mutationFn: (id: string) => del(`/account/sessions/${id}`),
    onSuccess: async (_, id) => {
      if (items.find((s) => s.id === id)?.current) {
        router.push('/sign-in');
        await refresh(null);
        return;
      }
      await qc.invalidateQueries({ queryKey: KEY });
      toast.show('That device is signed out');
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const revokeOthers = useMutation({
    mutationFn: () => post<{ revoked: number }>('/account/sessions/revoke-others'),
    onSuccess: async ({ revoked }) => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.show(
        revoked === 0
          ? 'No other devices were signed in'
          : `Signed out ${revoked} other device${revoked === 1 ? '' : 's'}`,
      );
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  return (
    <Section
      title="Devices"
      description="Where your account is signed in right now. Sign out anything you don't recognise, then change your password."
      action={
        items.length > 1 && (
          <Button variant="outline" size="sm" onClick={() => revokeOthers.mutate()} busy={revokeOthers.isPending}>
            Sign out all other devices
          </Button>
        )
      }
    >
      {sessions.isPending ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : sessions.isError ? (
        <FormAlert>
          {errorMessage(sessions.error)}{' '}
          <button type="button" className="link font-semibold" onClick={() => sessions.refetch()}>
            Try again
          </button>
        </FormAlert>
      ) : (
        <ul className="divide-y divide-line rounded-[2px] border border-line bg-surface">
          {items.map((s) => {
            const d = describe(s.userAgent);
            const Icon = d.mobile ? DeviceMobile : Desktop;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Icon className="size-6 shrink-0 text-ink-3" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    {d.label}
                    {s.current && (
                      <span className="rounded-[2px] bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                        This device
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-ink-3">
                    Last active {when(s.lastSeenAt)}
                    {s.ip && <> from {s.ip}</>}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke.mutate(s.id)}
                  disabled={revoke.isPending}
                  icon={<SignOut className="size-4" />}
                >
                  Sign out
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
