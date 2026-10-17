import type { Metadata } from 'next';
import { ReturnQueue } from '@/components/staff/returns';

export const metadata: Metadata = { title: 'Returns' };

export default function Page() {
  return <ReturnQueue />;
}
