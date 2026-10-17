import type { Metadata } from 'next';
import { StaffReturnDetail } from '@/components/staff/returns';

export const metadata: Metadata = { title: 'Return' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StaffReturnDetail id={(await params).id} />;
}
