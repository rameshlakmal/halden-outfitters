'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { type Me, UpdateProfile } from '@halden/contracts';
import { CheckCircle, SignOut, WarningCircle } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { patch, post } from '@/lib/api';
import { keys, useRefreshVisitor } from '@/lib/queries';
import { LatestOrders } from '../orders/order-list';
import { RewardsSummary } from './rewards';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert, Input } from '../ui/field';
import { useToast } from '../ui/toast';
import { applyApiError, errorMessage } from './forms';
import { Section } from './section';
import { ResendLink } from './token-pages';
import { useAccount } from './use-account';

export function AccountOverview() {
  const { me, loading } = useAccount();
  if (loading || !me) return <OverviewSkeleton />;
  return (
    <div className="grid gap-10">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Hi, {me.name.split(' ')[0]}</h1>
        <p className="text-ink-2">
          Member since {new Date(me.createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </p>
      </header>
      <EmailStatus me={me} />
      <ProfileForm me={me} />
      <LatestOrders />
      <RewardsSummary />
      <SignOutBlock />
    </div>
  );
}

function EmailStatus({ me }: { me: Me }) {
  if (me.emailVerified) {
    return (
      <div className="flex items-start gap-3 rounded-[2px] bg-brand-soft px-5 py-4 text-brand">
        <CheckCircle weight="fill" className="mt-0.5 size-5 shrink-0" />
        <p className="text-sm">
          <span className="font-medium">{me.email}</span> is confirmed.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 rounded-[2px] bg-warning-soft px-5 py-5">
      <div className="flex items-start gap-3">
        <WarningCircle weight="fill" className="mt-0.5 size-5 shrink-0 text-accent-ink" />
        <div className="grid gap-1 text-sm">
          <p className="font-medium text-ink">Please confirm {me.email}</p>
          <p className="text-ink-2">We sent you a link when you signed up. You need a confirmed email to check out.</p>
        </div>
      </div>
      <div className="pl-8">
        <ResendLink />
      </div>
    </div>
  );
}

function ProfileForm({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [alert, setAlert] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ resolver: zodResolver(UpdateProfile), defaultValues: { name: me.name } });

  const onSubmit = handleSubmit(async (values) => {
    setAlert(null);
    try {
      const updated = await patch<Me>('/account/profile', values);
      qc.setQueryData(keys.session, updated);
      reset({ name: updated.name });
      toast.show('Your name is saved');
    } catch (err) {
      const message = applyApiError(err, setError, ['name']);
      if (message) setAlert(message);
    }
  });

  return (
    <Section title="Profile" description="Your name appears on your orders and emails.">
      <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-5">
        {alert && <FormAlert>{alert}</FormAlert>}
        <Input label="Name" autoComplete="name" error={errors.name?.message} {...register('name')} />
        <Input label="Email" value={me.email} disabled readOnly hint="Changing your email is not available yet." />
        <Button type="submit" busy={isSubmitting} disabled={!isDirty} className="justify-self-start">
          Save changes
        </Button>
      </form>
    </Section>
  );
}

function SignOutBlock() {
  const router = useRouter();
  const refresh = useRefreshVisitor();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await post('/auth/logout');
      // Leave the account area first, so its "not signed in" redirect doesn't race this navigation.
      router.push('/');
      await refresh(null);
      router.refresh();
    } catch (err) {
      setBusy(false);
      toast.show(errorMessage(err), 'error');
    }
  };
  return (
    <Section title="Sign out" description="Signs out this device. To sign out everywhere, use Security.">
      <Button
        variant="outline"
        onClick={signOut}
        busy={busy}
        icon={<SignOut className="size-[18px]" />}
        className="justify-self-start"
      >
        Sign out
      </Button>
    </Section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Loading your account">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-16 w-full rounded-[2px]" />
      <div className="grid max-w-md gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
