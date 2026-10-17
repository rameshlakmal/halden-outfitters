import type { Metadata } from 'next';
import { ReturnWizard } from '@/components/returns/return-wizard';

export const metadata: Metadata = { title: 'Start a return' };

export default async function StartReturnPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReturnWizard orderId={(await params).id} />;
}
