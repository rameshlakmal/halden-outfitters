import type { Metadata } from 'next';
import { TestBank } from '@/components/checkout/bank';

export const metadata: Metadata = { title: 'Confirm your payment', robots: { index: false } };

export default function AuthenticatePage() {
  return (
    <div className="mx-auto max-w-[520px] px-[var(--gutter)] pt-10 md:pt-16">
      <TestBank />
    </div>
  );
}
