import type { Metadata } from 'next';
import { Warehouse } from '@/components/staff/warehouse';

export const metadata: Metadata = { title: 'Warehouse' };

export default function Page() {
  return <Warehouse />;
}
