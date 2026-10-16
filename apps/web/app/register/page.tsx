import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/account/auth-shell';
import { RegisterForm } from '@/components/account/register-form';

export const metadata: Metadata = { title: 'Create an account' };

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      intro="Keep your cart across devices, save addresses and track orders."
      photo={{ src: '/images/products/summit-45l-pack.jpg', alt: 'A hiker carrying a large pack on a mountain trail' }}
    >
      <Suspense>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
