import type { Metadata } from 'next';
import { StoreCreditPage } from '@/components/account/rewards';

export const metadata: Metadata = { title: 'Store credit' };

export default function StoreCredit() {
  return <StoreCreditPage />;
}
