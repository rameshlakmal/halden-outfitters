import type { Metadata } from 'next';
import { AccountOverview } from '@/components/account/overview';

export const metadata: Metadata = { title: 'Your account' };

export default function AccountPage() {
  return <AccountOverview />;
}
