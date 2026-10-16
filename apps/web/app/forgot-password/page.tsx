import type { Metadata } from 'next';
import { AuthShell } from '@/components/account/auth-shell';
import { ForgotPasswordForm } from '@/components/account/token-pages';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      intro="Enter your email and we will send you a link to choose a new password."
      photo={{ src: '/images/products/headlamp-400.jpg', alt: 'A hiker wearing a lit headlamp at night' }}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
