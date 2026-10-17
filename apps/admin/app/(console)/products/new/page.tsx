import type { Metadata } from 'next';
import { NewProduct } from '@/components/staff/new-product';

export const metadata: Metadata = { title: 'New product' };

export default function Page() {
  return <NewProduct />;
}
