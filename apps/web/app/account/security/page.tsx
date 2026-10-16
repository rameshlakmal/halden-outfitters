import type { Metadata } from 'next';
import { Security } from '@/components/account/security';

export const metadata: Metadata = { title: 'Security' };

export default function SecurityPage() {
  return <Security />;
}
