import type { Metadata } from 'next';
import { Confirmation } from '@/components/checkout/confirmation';

export const metadata: Metadata = { title: 'Order placed' };

export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto max-w-[880px] px-[var(--gutter)] pt-10 md:pt-16">
      <Confirmation id={(await params).id} />
    </div>
  );
}
