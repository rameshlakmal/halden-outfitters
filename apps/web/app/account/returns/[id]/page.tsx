import type { Metadata } from 'next';
import { ReturnDetail } from '@/components/returns/return-detail';

export const metadata: Metadata = { title: 'Return' };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReturnDetail id={(await params).id} />;
}
