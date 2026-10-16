import type { Metadata } from 'next';
import { CheckoutGate } from '@/components/account/checkout-gate';

export const metadata: Metadata = { title: 'Checkout' };

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-12 sm:px-6 md:pt-20 lg:px-8">
      <CheckoutGate />
    </div>
  );
}
