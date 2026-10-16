import type { Metadata } from 'next';
import { CheckoutGate } from '@/components/account/checkout-gate';

export const metadata: Metadata = { title: 'Checkout' };

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-[var(--gutter)] pt-12 md:pt-20">
      <CheckoutGate />
    </div>
  );
}
