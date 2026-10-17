import type { Metadata } from 'next';
import { StaffProductDetail } from '@/components/staff/products';

export const metadata: Metadata = { title: 'Product' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StaffProductDetail id={(await params).id} />;
}
