'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { type Me, PASSWORD_MIN, Register } from '@halden/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, post } from '@/lib/api';
import { useRefreshVisitor } from '@/lib/queries';
import { Button } from '../ui/button';
import { FormAlert, Input } from '../ui/field';
import { applyApiError, useNextParam } from './forms';
import { PasswordInput } from './password-input';

export function RegisterForm() {
  const router = useRouter();
  const next = useNextParam();
  const refresh = useRefreshVisitor();
  const [alert, setAlert] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(Register) });

  const onSubmit = handleSubmit(async (values) => {
    setAlert(null);
    setTaken(false);
    try {
      const { customer } = await post<{ customer: Me }>('/auth/register', values);
      await refresh(customer);
      router.push(next);
      router.refresh();
    } catch (err) {
      setTaken(err instanceof ApiError && err.code === 'email_taken');
      const message = applyApiError(err, setError, ['name', 'email', 'password']);
      if (message && !(err instanceof ApiError && err.code === 'email_taken')) setAlert(message);
    }
  });

  const query = next === '/account' ? '' : `?next=${encodeURIComponent(next)}`;
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {alert && <FormAlert>{alert}</FormAlert>}
      <Input label="Your name" autoComplete="name" error={errors.name?.message} {...register('name')} />
      <div className="grid gap-2">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...register('email')}
        />
        {taken && (
          <Link href={`/sign-in${query}`} className="text-sm font-medium text-brand hover:underline">
            Sign in to that account instead
          </Link>
        )}
      </div>
      <PasswordInput
        label="Password"
        autoComplete="new-password"
        error={errors.password?.message}
        hint={`At least ${PASSWORD_MIN} characters. A short sentence works well.`}
        {...register('password')}
      />
      <Button type="submit" size="lg" busy={isSubmitting} className="w-full">
        Create account
      </Button>
      <p className="text-[13px] leading-relaxed text-ink-3">
        We will email you a link to confirm your address. You need a confirmed email to check out.
      </p>
      <p className="text-sm text-ink-2">
        Already have an account?{' '}
        <Link href={`/sign-in${query}`} className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
