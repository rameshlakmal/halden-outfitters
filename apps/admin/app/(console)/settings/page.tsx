import type { Metadata } from 'next';
import { Settings } from '@/components/staff/settings';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return <Settings />;
}
