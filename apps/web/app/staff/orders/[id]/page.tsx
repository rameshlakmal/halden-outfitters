import type { Metadata } from 'next';
import { StaffOrderDetail } from '@/components/staff/orders';

export const metadata: Metadata = { title: 'Order' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StaffOrderDetail id={(await params).id} />;
}
