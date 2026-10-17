import type { Metadata } from 'next';
import { OrderQueue } from '@/components/staff/orders';

export const metadata: Metadata = { title: 'Orders' };

export default function Page() {
  return <OrderQueue />;
}
