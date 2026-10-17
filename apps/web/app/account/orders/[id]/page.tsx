import type { Metadata } from 'next';
import { OrderDetail } from '@/components/orders/order-detail';

export const metadata: Metadata = { title: 'Order' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return <OrderDetail id={(await params).id} />;
}
