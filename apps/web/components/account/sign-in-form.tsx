'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Login, type Me } from '@halden/contracts';
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

export function SignInForm() {
  const router = useRouter();
  const next = useNextParam();
  const refresh = useRefreshVisitor();
  const [alert, setAlert] = useState<{ message: string; locked: boolean } | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(Login) });

  const onSubmit = handleSubmit(async (values) => {
    setAlert(null);
    try {
      const { customer } = await post<{ customer: Me }>('/auth/login', values);
      await refresh(customer);
      router.push(next);
      router.refresh();
    } catch (err) {
      const message = applyApiError(err, setError, ['email', 'password']);
      if (message) setAlert({ message, locked: err instanceof ApiError && err.code === 'account_locked' });
    }
  });

  const query = next === '/account' ? '' : `?next=${encodeURIComponent(next)}`;
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {alert && (
        <FormAlert>
          {alert.message}{' '}
          {alert.locked && (
            <Link href="/forgot-password" className="font-medium underline">
              Reset your password
            </Link>
          )}
        </FormAlert>
      )}
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <div className="grid gap-2">
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Link href="/forgot-password" className="justify-self-end text-sm text-forest hover:underline">
          Forgot your password?
        </Link>
      </div>
      <Button type="submit" size="lg" busy={isSubmitting} className="w-full">
        Sign in
      </Button>
      <p className="text-sm text-ink-2">
        New to Halden?{' '}
        <Link href={`/register${query}`} className="font-medium text-forest hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
