import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/account/auth-shell';
import { VerifyEmail } from '@/components/account/token-pages';

export const metadata: Metadata = { title: 'Confirm your email' };

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Confirm your email"
      photo={{ src: '/images/products/ember-stove.jpg', alt: 'A camp stove by a lake' }}
    >
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </AuthShell>
  );
}
