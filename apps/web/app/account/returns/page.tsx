import type { Metadata } from 'next';
import { ReturnList } from '@/components/returns/return-list';

export const metadata: Metadata = { title: 'Returns' };

export default function ReturnsPage() {
  return <ReturnList />;
}
