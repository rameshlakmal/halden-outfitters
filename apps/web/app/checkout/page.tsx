import type { Metadata } from 'next';
import { CheckoutPage } from '@/components/checkout/checkout-page';

export const metadata: Metadata = { title: 'Checkout' };

export default function Page() {
  return (
    <div className="mx-auto max-w-[1200px] px-[var(--gutter)] pt-10 md:pt-14">
      <CheckoutPage />
    </div>
  );
}
