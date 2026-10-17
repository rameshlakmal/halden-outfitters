import type { Metadata } from 'next';
import { Coupons } from '@/components/staff/coupons';

export const metadata: Metadata = { title: 'Coupons' };

export default function Page() {
  return <Coupons />;
}
