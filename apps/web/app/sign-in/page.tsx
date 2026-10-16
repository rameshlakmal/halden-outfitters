import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/account/auth-shell';
import { SignInForm } from '@/components/account/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <AuthShell
      title="Welcome back"
      intro="Sign in to see your orders, addresses and saved cart."
      photo={{ src: '/images/banners/hero.jpg', alt: 'A lit tent under a starry sky' }}
    >
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
