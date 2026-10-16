import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/account/auth-shell';
import { ResetPasswordForm } from '@/components/account/token-pages';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      intro="Saving it signs out every device, so only you are signed in afterwards."
      photo={{ src: '/images/products/headlamp-400.jpg', alt: 'A hiker wearing a lit headlamp at night' }}
    >
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
